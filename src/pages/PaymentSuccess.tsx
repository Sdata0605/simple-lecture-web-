import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle, Download, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import confetti from 'canvas-confetti';
import { downloadReceipt } from '@/lib/receiptDownload';
import { onceKey, trackEvent } from '@/lib/analytics';
import {
  formatReceiptDate,
  formatRupees,
  usePaymentOrder,
  usePaymentOrderId,
  type PaymentReceipt,
} from '@/hooks/usePaymentOrder';
import {
  OrderNotFoundCard,
  PaymentLoadingCard,
  PaymentLookupErrorCard,
  PaymentPageShell,
  PaymentPendingCard,
  PaymentTimeoutCard,
} from '@/components/payment/PaymentStatusViews';

// Print only the receipt card, on a plain white page.
const PRINT_CSS = `
@media print {
  @page { margin: 12mm; }
  body * { visibility: hidden !important; }
  #payment-receipt, #payment-receipt * { visibility: visible !important; }
  #payment-receipt {
    position: absolute; left: 0; top: 0; width: 100%;
    box-shadow: none !important; border: none !important;
    background: #fff !important; color: #000 !important;
  }
  #payment-receipt .receipt-muted { background: #fff !important; border: 1px solid #ddd !important; }
}
`;

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className="flex justify-between gap-4 py-1.5">
    <span className={strong ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
    <span className={strong ? 'font-bold text-lg' : 'font-medium text-right'}>{value}</span>
  </div>
);

const Receipt = ({ receipt }: { receipt: PaymentReceipt }) => {
  const firstSlug = receipt.courses.find((c) => c.slug)?.slug;

  // Purchase: only for a server-confirmed 'success' receipt, once per order per session.
  // eventID = orderId so a future server-side (CAPI) Purchase can be deduplicated against it.
  useEffect(() => {
    if (receipt.status !== 'success' || !receipt.orderId) return;
    if (!onceKey(`purchase_${receipt.orderId}`)) return;
    const contentIds = receipt.courses.map((c) => c.slug || c.id);
    trackEvent({
      ga4: 'purchase',
      meta: 'Purchase',
      eventId: receipt.orderId,
      params: {
        transaction_id: receipt.orderId,
        value: receipt.total,
        currency: 'INR',
        items: receipt.courses.map((c) => ({ item_id: c.slug || c.id, item_name: c.name, price: c.price })),
      },
      metaParams: {
        value: receipt.total,
        currency: 'INR',
        content_ids: contentIds,
        content_type: 'product',
        num_items: receipt.courses.length,
      },
    });
  }, [receipt]);

  return (
    <Card id="payment-receipt" className="max-w-2xl w-full p-4 md:p-8">
      <style>{PRINT_CSS}</style>
      <div className="text-center mb-6 md:mb-8">
        <CheckCircle className="h-16 w-16 md:h-20 md:w-20 text-green-500 mx-auto mb-4 print:h-10 print:w-10" />
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Payment successful</h1>
        <p className="text-sm md:text-base text-muted-foreground">
          You're enrolled. This is your payment receipt.
        </p>
      </div>

      <div className="receipt-muted bg-muted p-4 md:p-6 rounded-lg mb-4 md:mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Receipt number</p>
            <p className="font-mono font-semibold break-all">{receipt.orderId}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Date</p>
            <p className="font-semibold">{formatReceiptDate(receipt.completedAt ?? receipt.createdAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Payment ID</p>
            <p className="font-mono font-semibold break-all">{receipt.gatewayPaymentId ?? '—'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Student</p>
            <p className="font-semibold">{receipt.studentName ?? '—'}</p>
            {receipt.studentEmail && (
              <p className="text-muted-foreground break-all">{receipt.studentEmail}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mb-4 md:mb-6">
        <p className="text-sm text-muted-foreground mb-2">
          {receipt.courses.length > 1 ? 'Courses' : 'Course'}
        </p>
        {receipt.courses.length > 0 ? (
          <ul className="space-y-2">
            {receipt.courses.map((course) => (
              <li key={course.id || course.name} className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                <span className="font-medium">{course.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">—</p>
        )}
      </div>

      <div className="border-t border-b py-3 mb-6 text-sm">
        {receipt.discount > 0 && (
          <>
            <Row label="Course price (incl. GST)" value={formatRupees(receipt.subtotal)} />
            <Row
              label={receipt.promoCode ? `Discount (${receipt.promoCode})` : 'Discount'}
              value={`− ${formatRupees(receipt.discount)}`}
            />
          </>
        )}
        <Row label="Base amount" value={formatRupees(receipt.baseAmount)} />
        <Row label="GST 18% (included)" value={formatRupees(receipt.gstAmount)} />
        <div className="border-t mt-2 pt-2">
          <Row label="Total paid" value={formatRupees(receipt.total)} strong />
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center mb-6">
        SimpleLecture · Keep this receipt for your records. Need help?{' '}
        <Link to="/support" className="text-primary underline print:no-underline">Contact support</Link>
      </p>

      <div className="flex flex-col sm:flex-row gap-3 md:gap-4 print:hidden">
        <Button asChild className="flex-1" size="lg">
          <Link to="/my-courses">
            Go to My Courses
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
        <Button variant="outline" size="lg" className="sm:flex-none" onClick={() => downloadReceipt(receipt)}>
          <Download className="mr-2 h-4 w-4" />
          Download receipt
        </Button>
      </div>
      {firstSlug && (
        <p className="text-center text-sm mt-4 print:hidden">
          <Link to={`/learning/${firstSlug}`} className="text-primary underline">
            Start learning now
          </Link>
        </p>
      )}
    </Card>
  );
};

const PaymentSuccess = () => {
  const navigate = useNavigate();
  const orderId = usePaymentOrderId();
  const state = usePaymentOrder(orderId);
  const celebrated = useRef(false);

  useEffect(() => {
    if (state.kind === 'success' && !celebrated.current) {
      celebrated.current = true;
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    }
    if (state.kind === 'failed') {
      navigate(`/payment-failed?orderId=${encodeURIComponent(state.receipt.orderId)}`, { replace: true });
    }
  }, [state, navigate]);

  let content;
  switch (state.kind) {
    case 'loading':
    case 'failed':
      content = <PaymentLoadingCard />;
      break;
    case 'pending':
      content = <PaymentPendingCard orderId={state.orderId} />;
      break;
    case 'timeout':
      content = <PaymentTimeoutCard orderId={state.orderId} />;
      break;
    case 'error':
      content = <PaymentLookupErrorCard orderId={state.orderId} />;
      break;
    case 'success':
      content = <Receipt receipt={state.receipt} />;
      break;
    case 'no-order':
      content = <OrderNotFoundCard />;
      break;
    case 'not-found':
      content = <OrderNotFoundCard orderId={state.orderId} />;
      break;
  }

  return (
    <PaymentPageShell
      title={state.kind === 'success' ? 'Payment Successful | SimpleLecture' : 'Payment | SimpleLecture'}
      description="Your SimpleLecture payment receipt"
    >
      {content}
    </PaymentPageShell>
  );
};

export default PaymentSuccess;
