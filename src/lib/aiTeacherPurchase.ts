/**
 * Pure purchase flow for AI Teacher Plus (Rs 500).
 *
 * Everything with side effects (order creation, Razorpay checkout, server
 * verification, plan activation) is injected through `PurchaseDeps`, so the
 * flow can be unit-tested without React, Supabase or the Razorpay SDK.
 *
 * Invariant: the plan is granted only after Razorpay's success callback has
 * fired, and never after an order, checkout or verification error. The one
 * exception is a verification that never answered (network failure twice),
 * where Razorpay's success callback is trusted.
 */

/** Same course id the web app uses for AI Teacher orders. */
export const AI_TEACHER_ORDER_COURSE_ID = '9403f48c-2f2f-49a0-bcf6-46c232480ff9';

const PLUS_PLAN_NAME = 'AI Teacher Plus';
const ORDER_TIMEOUT_MS = 15000;
const VERIFY_ATTEMPTS = 2;

const MSG_NOT_LOGGED_IN = 'Please log in to buy AI Teacher Plus.';
const MSG_NAME = 'Please enter your name.';
const MSG_PHONE = 'Please enter your 10-digit mobile number.';
const MSG_ORDER_FAILED = 'We could not start the payment. Please try again in a minute.';
const MSG_CANCELLED = 'Payment cancelled. You have not been charged.';
const MSG_NOT_CHARGED = 'You have not been charged.';

/** Rejects with `message` if `promise` does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export interface PurchasePlusInput {
  userId: string;
  name: string;
  email: string;
  phone: string;
  amountRupees: number;
}

export interface CheckoutOptions {
  razorpayKeyId: string;
  razorpayOrderId: string;
  amountInPaise: number;
  currency: string;
  name: string;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

export interface CheckoutSuccessData {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface CheckoutResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
  data?: CheckoutSuccessData;
}

export interface VerifyArgs {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
  /** The server's internal order id (not the Razorpay order id). */
  orderId: string;
  userId: string;
  courses: [];
}

export interface VerifyResult {
  verified: boolean;
  networkError?: boolean;
}

export interface GrantDetails {
  name: string;
  email: string;
  phone: string;
  orderId: string;
  paymentId: string;
}

export interface CreateOrderResult {
  orderId?: string;
  razorpayOrderId?: string | null;
  razorpayKeyId?: string;
  error?: string;
}

export interface PurchaseDeps {
  createOrder: (
    userId: string,
    amount: number,
    courses: { id: string; name: string; price: number }[],
    customer: { fullName: string; email: string; phone: string },
  ) => Promise<CreateOrderResult>;
  openCheckout: (opts: CheckoutOptions) => Promise<CheckoutResult>;
  verify: (args: VerifyArgs) => Promise<VerifyResult>;
  grant: (details: GrantDetails) => Promise<void>;
  /** Optional: true for the pre-registered testing account, which gets the plan without paying. */
  isPermanentTestingAccount?: (email: string) => boolean;
}

export type PurchasePlusResult =
  | { status: 'success' }
  | { status: 'cancelled'; message: string }
  | { status: 'error'; message: string };

export async function purchasePlus(
  input: PurchasePlusInput,
  deps: PurchaseDeps,
): Promise<PurchasePlusResult> {
  const name = input.name.trim();
  const email = input.email.trim();
  const phone = input.phone.trim();

  if (!input.userId) {
    return { status: 'error', message: MSG_NOT_LOGGED_IN };
  }

  // Silent activation for the pre-registered testing account (no order, no charge).
  if (deps.isPermanentTestingAccount?.(email.toLowerCase())) {
    const orderId = `SL-AIT-PRO-${Date.now().toString(36).toUpperCase()}`;
    const paymentId = `pay_${Date.now()}`;
    try {
      await deps.grant({
        name: name || 'Student',
        email: email.toLowerCase(),
        phone,
        orderId,
        paymentId,
      });
      return { status: 'success' };
    } catch (err) {
      console.warn('[AITeacherPlus] silent activation failed:', err);
      return {
        status: 'error',
        message: `We could not activate your plan. Please contact support with payment ID ${paymentId}.`,
      };
    }
  }

  if (!name) {
    return { status: 'error', message: MSG_NAME };
  }
  if (!/^\d{10}$/.test(phone)) {
    return { status: 'error', message: MSG_PHONE };
  }

  // 1. Create the order on the server (15 s limit).
  let order: CreateOrderResult;
  try {
    order = await withTimeout(
      deps.createOrder(
        input.userId,
        input.amountRupees,
        [{ id: AI_TEACHER_ORDER_COURSE_ID, name: PLUS_PLAN_NAME, price: input.amountRupees }],
        { fullName: name, email, phone },
      ),
      ORDER_TIMEOUT_MS,
      'order timed out',
    );
  } catch (err: any) {
    console.warn('[AITeacherPlus] order failed:', err?.message ?? err);
    return { status: 'error', message: MSG_ORDER_FAILED };
  }

  if (!order || order.error || !order.razorpayOrderId || !order.razorpayKeyId || !order.orderId) {
    const reason = order?.error ?? 'missing razorpayOrderId, razorpayKeyId or orderId';
    console.warn('[AITeacherPlus] order failed:', reason);
    return { status: 'error', message: MSG_ORDER_FAILED };
  }

  const internalOrderId = order.orderId;
  const razorpayOrderId = order.razorpayOrderId;

  // 2. Open Razorpay checkout.
  const checkout = await deps.openCheckout({
    razorpayKeyId: order.razorpayKeyId,
    razorpayOrderId,
    amountInPaise: Math.round(input.amountRupees * 100),
    currency: 'INR',
    name: 'SimpleLecture',
    description: `${PLUS_PLAN_NAME} - 1-to-1 AI Teacher`,
    customerName: name,
    customerEmail: email,
    customerPhone: phone,
  });

  if (!checkout.success || !checkout.data) {
    if (checkout.cancelled) {
      return { status: 'cancelled', message: MSG_CANCELLED };
    }
    return {
      status: 'error',
      message: `${checkout.error || 'Payment could not be completed.'} ${MSG_NOT_CHARGED}`,
    };
  }

  const paymentId = checkout.data.razorpay_payment_id;
  const paymentData = {
    razorpay_payment_id: paymentId,
    razorpay_order_id: checkout.data.razorpay_order_id || razorpayOrderId,
    razorpay_signature: checkout.data.razorpay_signature,
  };

  // 3. Verify on the server. Only verified:true (or a verification that never
  //    answered, after one retry) lets the plan be granted.
  let verified: boolean | null = null; // null = verification never answered
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS && verified === null; attempt++) {
    try {
      const res = await deps.verify({
        ...paymentData,
        orderId: internalOrderId,
        userId: input.userId,
        courses: [],
      });
      if (res.networkError) {
        console.warn(`[AITeacherPlus] verify network error (attempt ${attempt})`);
        continue;
      }
      verified = res.verified === true;
    } catch (err) {
      console.warn(`[AITeacherPlus] verify threw (attempt ${attempt}):`, err);
    }
  }

  if (verified === false) {
    return {
      status: 'error',
      message: `We could not confirm your payment. If money was deducted, contact support with payment ID ${paymentId}.`,
    };
  }

  // 4. Grant the plan (once).
  try {
    await deps.grant({
      name,
      email,
      phone,
      orderId: razorpayOrderId,
      paymentId,
    });
    return { status: 'success' };
  } catch (err) {
    console.warn('[AITeacherPlus] grant failed:', err);
    return {
      status: 'error',
      message: `Payment went through but activation failed. Contact support with payment ID ${paymentId}.`,
    };
  }
}
