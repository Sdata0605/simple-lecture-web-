import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Razorpay sends the customer back here (form POST) after a bank or card page.
// This function verifies the payment on the server, enrolls the student only if
// everything matches, and then redirects the browser to the app's result page.
//
// SECURITY: course, user and amount are taken from the stored order and from Razorpay,
// never from the form fields. Only origins in ALLOWED_RETURN_ORIGINS are used for redirects.

const ALLOWED_RETURN_ORIGINS = [
  'https://simplelecture.com',
  'https://www.simplelecture.com',
  'http://localhost:8080',
];

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const pickOrigin = (value: string | null) => {
  if (value && ALLOWED_RETURN_ORIGINS.includes(value)) return value;
  return 'https://simplelecture.com';
};

const redirect = (location: string) =>
  new Response(null, { status: 303, headers: { Location: location } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const origin = pickOrigin(url.searchParams.get('return'));

  // Collect fields from the form POST (Razorpay) or the query string (manual GET).
  let fields: Record<string, string> = {};
  if (req.method === 'POST') {
    const text = await req.text();
    const params = new URLSearchParams(text);
    params.forEach((v, k) => { fields[k] = v; });
  }
  for (const [k, v] of url.searchParams.entries()) if (!(k in fields)) fields[k] = v;

  // A failed bank attempt sends nested error fields, e.g. error[metadata] = {"order_id":"order_...","payment_id":"pay_..."}.
  let errorMeta: Record<string, string> = {};
  try {
    errorMeta = JSON.parse(fields['error[metadata]'] || '{}');
  } catch {
    errorMeta = {};
  }

  const razorpayOrderId = fields['razorpay_order_id'] || errorMeta['order_id'] || '';
  const razorpayPaymentId = fields['razorpay_payment_id'] || '';
  const razorpaySignature = fields['razorpay_signature'] || '';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Find the stored order for this Razorpay order (if any).
  let payment: any = null;
  if (razorpayOrderId) {
    const { data } = await supabase
      .from('payments')
      .select('id, order_id, user_id, status, final_amount, gateway_order_id')
      .eq('gateway_order_id', razorpayOrderId)
      .maybeSingle();
    payment = data;
  }
  const orderParam = payment?.order_id ? `?orderId=${encodeURIComponent(payment.order_id)}` : '';

  try {
    // Successful-looking callback: verify everything before enrolling.
    if (razorpayPaymentId && razorpayOrderId && razorpaySignature) {
      const keyId = Deno.env.get('RAZORPAY_KEY_ID');
      const secret = Deno.env.get('RAZORPAY_KEY_SECRET');
      if (!keyId || !secret || !payment) {
        console.error('Callback: missing keys or unknown order', razorpayOrderId);
        return redirect(`${origin}/payment-failed${orderParam}`);
      }

      // 1. Signature
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      );
      const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${razorpayOrderId}|${razorpayPaymentId}`));
      const expected = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
      if (!safeEqual(expected, razorpaySignature)) {
        console.error('Callback: bad signature for', razorpayOrderId);
        return redirect(`${origin}/payment-failed${orderParam}`);
      }

      // 2. Already processed (e.g. the webhook or a retry got there first)
      if (payment.status === 'success') return redirect(`${origin}/payment-success${orderParam}`);
      if (payment.status !== 'pending') return redirect(`${origin}/payment-failed${orderParam}`);

      // 3. Razorpay must confirm: captured, same order, INR, exact stored amount
      const rp = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpayPaymentId)}`, {
        headers: { Authorization: 'Basic ' + btoa(`${keyId}:${secret}`) },
      });
      if (!rp.ok) {
        console.error('Callback: Razorpay lookup failed', rp.status);
        return redirect(`${origin}/payment-failed${orderParam}`);
      }
      const rpPayment = await rp.json();
      const expectedPaise = Math.round(Number(payment.final_amount) * 100);
      if (
        rpPayment.order_id !== razorpayOrderId ||
        rpPayment.status !== 'captured' ||
        rpPayment.currency !== 'INR' ||
        Number(rpPayment.amount) !== expectedPaise
      ) {
        console.error('Callback: payment does not match order', razorpayOrderId);
        return redirect(`${origin}/payment-failed${orderParam}`);
      }

      // 4. Mark success once (only from pending), then enroll from the stored order items
      const { data: updated, error: updErr } = await supabase
        .from('payments')
        .update({ status: 'success', gateway_payment_id: razorpayPaymentId, completed_at: new Date().toISOString() })
        .eq('id', payment.id)
        .eq('status', 'pending')
        .select('id');
      if (updErr) throw updErr;

      if (updated && updated.length > 0) {
        const { data: items, error: itemsErr } = await supabase
          .from('order_items')
          .select('course_id')
          .eq('payment_id', payment.id);
        if (itemsErr) throw itemsErr;
        if (items && items.length > 0) {
          const { error: enrollErr } = await supabase.from('enrollments').upsert(
            items.map((i: any) => ({
              student_id: payment.user_id,
              course_id: i.course_id,
              is_active: true,
              expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            })),
            { onConflict: 'student_id,course_id' },
          );
          if (enrollErr) throw enrollErr;
        }
      }
      return redirect(`${origin}/payment-success${orderParam}`);
    }

    // Anything else (for example a failed bank attempt): record the failure if the order is still pending.
    if (payment && payment.status === 'pending') {
      const reason = fields['error[description]'] || fields['error[reason]'] || 'Payment was not completed';
      await supabase
        .from('payments')
        .update({ status: 'failed', error_message: reason })
        .eq('id', payment.id)
        .eq('status', 'pending');
    }
    return redirect(`${origin}/payment-failed${orderParam}`);
  } catch (err) {
    console.error('Callback error:', err);
    return redirect(`${origin}/payment-failed${orderParam}`);
  }
});
