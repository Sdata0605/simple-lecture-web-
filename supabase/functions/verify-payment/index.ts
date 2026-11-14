import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// SECURITY: the request body is only used to identify the order and prove the
// Razorpay signature. The course list, the user and the amount are all taken from
// the database and from Razorpay, never from the browser.

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Constant-time string comparison (avoids leaking the signature through timing).
const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = await req.json();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderId) {
      return jsonResponse({ error: 'Missing payment details', verified: false }, 400);
    }

    const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID');
    const razorpaySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    if (!razorpayKeyId || !razorpaySecret) {
      throw new Error('Razorpay keys not configured');
    }

    // 1. Signature check (HMAC-SHA256 of "order_id|payment_id").
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(razorpaySecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${razorpay_order_id}|${razorpay_payment_id}`));
    const expectedSignature = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (!safeEqual(expectedSignature, String(razorpay_signature))) {
      console.error('Signature verification failed for order', orderId);
      return jsonResponse({ error: 'Payment verification failed', verified: false }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 2. The payment row must match BOTH our order id and this Razorpay order.
    const { data: payment, error: fetchError } = await supabase
      .from('payments')
      .select('id, user_id, status, final_amount, gateway_order_id')
      .eq('order_id', orderId)
      .single();

    if (fetchError || !payment || payment.gateway_order_id !== razorpay_order_id) {
      console.error('Order mismatch for', orderId, fetchError);
      return jsonResponse({ error: 'Order not found', verified: false }, 400);
    }

    // Already completed (e.g. the webhook got there first): report success, do not repeat.
    if (payment.status === 'success') {
      return jsonResponse({ verified: true, alreadyProcessed: true, message: 'Payment already verified' });
    }
    if (payment.status !== 'pending') {
      return jsonResponse({ error: `Payment is ${payment.status}`, verified: false }, 400);
    }

    // 3. Ask Razorpay for the real payment: it must be captured, for this order, in INR,
    //    and for exactly the amount we stored (in paise).
    const rpRes = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpay_payment_id)}`, {
      headers: { 'Authorization': 'Basic ' + btoa(`${razorpayKeyId}:${razorpaySecret}`) },
    });
    if (!rpRes.ok) {
      console.error('Razorpay payment lookup failed', rpRes.status);
      return jsonResponse({ error: 'Could not confirm payment with Razorpay', verified: false }, 502);
    }
    const rp = await rpRes.json();
    const expectedPaise = Math.round(Number(payment.final_amount) * 100);

    if (rp.order_id !== razorpay_order_id || rp.status !== 'captured' || rp.currency !== 'INR' || Number(rp.amount) !== expectedPaise) {
      console.error('Payment mismatch', { order: rp.order_id, status: rp.status, amount: rp.amount, expectedPaise });
      return jsonResponse({ error: 'Payment amount or status does not match the order', verified: false }, 400);
    }

    // 4. Mark success only if it is still pending (prevents double processing).
    const { data: updated, error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'success',
        gateway_payment_id: razorpay_payment_id,
        completed_at: new Date().toISOString(),
      })
      .eq('id', payment.id)
      .eq('status', 'pending')
      .select('id');

    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      return jsonResponse({ verified: true, alreadyProcessed: true, message: 'Payment already verified' });
    }

    // 5. Enroll the user in the courses stored on this order (not the request body).
    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('course_id')
      .eq('payment_id', payment.id);
    if (itemsError) throw itemsError;

    if (orderItems && orderItems.length > 0) {
      const { error: enrollmentError } = await supabase
        .from('enrollments')
        .upsert(
          orderItems.map((item: any) => ({
            student_id: payment.user_id,
            course_id: item.course_id,
            is_active: true,
            expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          })),
          { onConflict: 'student_id,course_id' },
        );
      if (enrollmentError) throw enrollmentError;
    }

    return jsonResponse({
      verified: true,
      message: 'Payment verified and enrollment created',
      courses: (orderItems || []).map((i: any) => i.course_id),
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'An error occurred', verified: false },
      500,
    );
  }
});
