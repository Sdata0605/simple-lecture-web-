import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Course prices (courses.price_inr) are the FINAL GST-inclusive amount.
 * The server is the source of truth for the amount charged:
 *   - it reads each course price from the database (client amounts are ignored)
 *   - it applies the promo code ONCE to the inclusive total
 *   - it derives base = round(total / 1.18) and GST = total - base
 * Mirrors src/lib/gst.ts on the web client.
 */
const GST_DIVISOR = 1.18;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { courses, customerInfo, promoCode, userId } = await req.json();

    console.log('Payment order request:', { courses, customerInfo, promoCode, userId });

    if (!userId || !Array.isArray(courses) || courses.length === 0) {
      return json({ error: 'Missing required fields' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Load course prices from the database (never trust client amounts)
    const courseIds: string[] = courses.map((c: any) => c.id).filter(Boolean);
    const { data: dbCourses, error: coursesError } = await supabase
      .from('courses')
      .select('id, name, price_inr, is_active, is_coming_soon')
      .in('id', courseIds);

    if (coursesError) throw coursesError;
    if (!dbCourses || dbCourses.length !== new Set(courseIds).size) {
      return json({ error: 'One or more courses were not found' }, 400);
    }
    for (const c of dbCourses) {
      if (!c.is_active || c.is_coming_soon) {
        return json({ error: `Course "${c.name}" is not open for enrollment` }, 400);
      }
    }

    const subtotal = dbCourses.reduce((sum, c) => sum + Math.max(0, Math.round(Number(c.price_inr) || 0)), 0);

    // 2. Promo code: applied once, to the GST-inclusive subtotal
    let discountAmount = 0;
    let promoCodeId: string | null = null;

    if (promoCode) {
      const { data: discount } = await supabase
        .from('discount_codes')
        .select('*')
        .eq('code', String(promoCode).toUpperCase())
        .single();

      const expired = discount?.valid_until ? new Date(discount.valid_until).getTime() < Date.now() : false;
      const exhausted = discount?.max_uses ? (discount.times_used || 0) >= discount.max_uses : false;
      const courseMismatch = discount?.course_id ? !courseIds.includes(discount.course_id) : false;

      if (discount && discount.is_active && !expired && !exhausted && !courseMismatch) {
        promoCodeId = discount.id;
        if (discount.discount_percent) {
          discountAmount = Math.round((subtotal * discount.discount_percent) / 100);
        } else if (discount.discount_amount) {
          discountAmount = discount.discount_amount;
        }
        discountAmount = Math.min(discountAmount, subtotal);
      }
    }

    // 3. Final inclusive total and GST split
    const finalAmount = Math.max(0, subtotal - discountAmount);
    if (finalAmount <= 0) {
      return json({ error: 'Amount must be greater than zero for paid checkout' }, 400);
    }
    const baseAmount = Math.round(finalAmount / GST_DIVISOR);
    const gstAmount = finalAmount - baseAmount;

    // Generate order ID
    const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create Razorpay order
    const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID');
    const razorpaySecret = Deno.env.get('RAZORPAY_KEY_SECRET');

    let razorpayOrderId: string | null = null;

    if (razorpayKeyId && razorpaySecret) {
      try {
        const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + btoa(`${razorpayKeyId}:${razorpaySecret}`)
          },
          body: JSON.stringify({
            amount: finalAmount * 100, // Razorpay expects amount in paise
            currency: 'INR',
            receipt: orderId,
            notes: {
              customer_name: customerInfo?.fullName || '',
              customer_email: customerInfo?.email || '',
              customer_phone: customerInfo?.phone || ''
            }
          })
        });

        if (razorpayResponse.ok) {
          const razorpayOrder = await razorpayResponse.json();
          razorpayOrderId = razorpayOrder.id;
          console.log('Razorpay order created:', razorpayOrderId);
        } else {
          const errorText = await razorpayResponse.text();
          console.error('Razorpay order creation failed:', errorText);
        }
      } catch (razorpayError) {
        console.error('Razorpay API error:', razorpayError);
      }
    }

    // Create payment record with pending status
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        order_id: orderId,
        user_id: userId,
        amount_inr: subtotal,
        discount_amount: discountAmount,
        final_amount: finalAmount,
        status: 'pending',
        payment_gateway: 'razorpay',
        gateway_order_id: razorpayOrderId,
        metadata: {
          customerInfo,
          promoCode: promoCode || null,
          gst_inclusive: true,
          base_amount: baseAmount,
          gst_amount: gstAmount,
          gst_rate: 0.18,
        }
      })
      .select()
      .single();

    if (paymentError) {
      console.error('Error creating payment:', paymentError);
      throw paymentError;
    }

    console.log('Payment record created:', payment.id);

    // Create order items (per-course inclusive price from the database)
    const orderItems = dbCourses.map((course) => ({
      payment_id: payment.id,
      course_id: course.id,
      price_inr: Math.max(0, Math.round(Number(course.price_inr) || 0)),
    }));

    const { error: orderItemsError } = await supabase
      .from('order_items')
      .insert(orderItems);

    if (orderItemsError) {
      console.error('Error creating order items:', orderItemsError);
      throw orderItemsError;
    }

    console.log('Order items created');

    // Increment promo code usage
    if (promoCodeId) {
      const { data: currentCode } = await supabase
        .from('discount_codes')
        .select('times_used')
        .eq('id', promoCodeId)
        .single();

      if (currentCode) {
        await supabase
          .from('discount_codes')
          .update({ times_used: (currentCode.times_used || 0) + 1 })
          .eq('id', promoCodeId);
      }

      console.log('Promo code usage incremented');
    }

    return json({
      orderId,
      amount: finalAmount,
      baseAmount,
      gstAmount,
      discountAmount,
      status: 'created',
      paymentId: payment.id,
      razorpayOrderId,
      razorpayKeyId,
    });
  } catch (error) {
    console.error('Payment order error:', error);
    return json({ error: error instanceof Error ? error.message : 'An error occurred' }, 500);
  }
});
