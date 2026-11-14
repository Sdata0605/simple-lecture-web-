import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { splitInclusiveGST } from '@/lib/gst';

/**
 * Loads a payment row for the logged-in user and keeps re-checking while it is
 * still pending. The result screens decide what to show ONLY from this row,
 * never from the URL or navigation state.
 */

export const PAYMENT_POLL_INTERVAL_MS = 3000;
export const PAYMENT_POLL_TIMEOUT_MS = 60000;

export interface ReceiptCourse {
  id: string;
  name: string;
  slug: string | null;
  price: number;
}

export interface PaymentReceipt {
  orderId: string;
  status: string;
  completedAt: string | null;
  createdAt: string | null;
  gatewayPaymentId: string | null;
  studentName: string | null;
  studentEmail: string | null;
  courses: ReceiptCourse[];
  /** GST-inclusive price before discount */
  subtotal: number;
  discount: number;
  /** Amount actually paid (GST-inclusive) */
  total: number;
  baseAmount: number;
  gstAmount: number;
  promoCode: string | null;
  errorMessage: string | null;
}

export type PaymentOrderState =
  | { kind: 'loading' }
  | { kind: 'no-order' }
  | { kind: 'not-found'; orderId: string }
  | { kind: 'error'; orderId: string }
  | { kind: 'pending'; orderId: string; courses: ReceiptCourse[] }
  | { kind: 'timeout'; orderId: string; courses: ReceiptCourse[] }
  | { kind: 'success'; receipt: PaymentReceipt }
  | { kind: 'failed'; receipt: PaymentReceipt };

type Json = Record<string, unknown>;

const asObject = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;
const asNumber = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};

/** Order id from the query string, falling back to navigation state. */
export function usePaymentOrderId(): string | null {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const state = asObject(location.state);
  return asString(searchParams.get('orderId')) ?? asString(state.orderId);
}

async function loadReceipt(orderId: string, userId: string): Promise<PaymentOrderState> {
  const { data: payment, error } = await supabase
    .from('payments')
    .select(
      'id, order_id, user_id, status, amount_inr, discount_amount, final_amount, gateway_payment_id, completed_at, created_at, metadata, error_message'
    )
    .eq('order_id', orderId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[usePaymentOrder] payment lookup failed', error.message);
    return { kind: 'error', orderId };
  }
  // Missing, or not this user's order (RLS + user_id filter): neutral "not found".
  if (!payment || payment.user_id !== userId) return { kind: 'not-found', orderId };

  const { data: items } = await supabase
    .from('order_items')
    .select('course_id, price_inr, courses(id, name, slug)')
    .eq('payment_id', payment.id);

  const courses: ReceiptCourse[] = (items ?? []).map((item: any) => ({
    id: item.courses?.id ?? item.course_id ?? '',
    name: item.courses?.name ?? 'Course',
    slug: item.courses?.slug ?? null,
    price: Number(item.price_inr) || 0,
  }));

  const status = (payment.status ?? 'pending').toLowerCase();
  if (status !== 'success' && status !== 'failed') {
    return { kind: 'pending', orderId: payment.order_id, courses };
  }

  const metadata = asObject(payment.metadata);
  const customer = asObject(metadata.customerInfo);
  let studentName = asString(customer.fullName) ?? asString(customer.name);
  let studentEmail = asString(customer.email);

  if (status === 'success' && (!studentName || !studentEmail)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', userId)
      .maybeSingle();
    studentName = studentName ?? asString(profile?.full_name);
    studentEmail = studentEmail ?? asString(profile?.email);
  }

  const total = Number(payment.final_amount) || 0;
  const split = splitInclusiveGST(total);
  const baseAmount = asNumber(metadata.base_amount) ?? split.base;
  const gstAmount = asNumber(metadata.gst_amount) ?? split.gst;

  const receipt: PaymentReceipt = {
    orderId: payment.order_id,
    status,
    completedAt: payment.completed_at,
    createdAt: payment.created_at,
    gatewayPaymentId: payment.gateway_payment_id,
    studentName,
    studentEmail,
    courses,
    subtotal: Number(payment.amount_inr) || total,
    discount: Number(payment.discount_amount) || 0,
    total,
    baseAmount,
    gstAmount,
    promoCode: asString(metadata.promoCode),
    errorMessage: asString(payment.error_message),
  };

  return status === 'success' ? { kind: 'success', receipt } : { kind: 'failed', receipt };
}

export function usePaymentOrder(orderId: string | null): PaymentOrderState {
  const [state, setState] = useState<PaymentOrderState>({ kind: 'loading' });
  const startedAt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (!orderId) {
      setState({ kind: 'no-order' });
      return;
    }

    setState({ kind: 'loading' });
    startedAt.current = Date.now();

    // One request at a time: the next check is scheduled only after the
    // previous one finishes (no setInterval stacking up slow requests).
    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setState({ kind: 'not-found', orderId });
        return;
      }

      let next: PaymentOrderState;
      try {
        next = await loadReceipt(orderId, user.id);
      } catch (err) {
        console.error('[usePaymentOrder] check failed', err);
        next = { kind: 'error', orderId };
      }
      if (cancelled) return;

      if (next.kind === 'pending') {
        if (Date.now() - startedAt.current >= PAYMENT_POLL_TIMEOUT_MS) {
          setState({ kind: 'timeout', orderId: next.orderId, courses: next.courses });
          return;
        }
        setState(next);
        timer = setTimeout(check, PAYMENT_POLL_INTERVAL_MS);
        return;
      }
      setState(next);
    };

    check();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId]);

  return state;
}

export const formatRupees = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);

/**
 * The database stores times in UTC but some values come back without a zone marker
 * ("2026-11-14 13:13:02.539"). Read those as UTC, not as the device's local time.
 */
const parseDbTimestamp = (raw: string): Date => {
  let s = raw.trim().replace(' ', 'T');
  s = s.replace(/([+-]\d{2})$/, '$1:00'); // "+00" -> "+00:00"
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(s)) s += 'Z';
  return new Date(s);
};

export const formatReceiptDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = parseDbTimestamp(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', // receipts always show India time, whatever the device clock is set to
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
