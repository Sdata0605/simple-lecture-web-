import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePaymentOrder, usePaymentOrderId, type ReceiptCourse } from '@/hooks/usePaymentOrder';
import {
  OrderNotFoundCard,
  PaymentLoadingCard,
  PaymentLookupErrorCard,
  PaymentPageShell,
  PaymentPendingCard,
  PaymentTimeoutCard,
} from '@/components/payment/PaymentStatusViews';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const retryPath = (stateSlug: string | null, courses: ReceiptCourse[] = []) => {
  const slug = stateSlug ?? courses.find((c) => c.slug)?.slug ?? null;
  return slug ? `/enroll/${encodeURIComponent(slug)}` : '/programs';
};

const FailedCard = ({
  orderId,
  reason,
  tryAgainTo,
}: {
  orderId: string | null;
  reason: string | null;
  tryAgainTo: string;
}) => (
  <Card className="max-w-md w-full p-6 md:p-8 text-center">
    <XCircle className="h-16 w-16 md:h-20 md:w-20 text-destructive mx-auto mb-4" />
    <h1 className="text-2xl md:text-3xl font-bold mb-2">Payment not completed</h1>
    <p className="text-sm md:text-base text-muted-foreground">
      Your payment didn't go through, so you have not been enrolled. If any money was deducted,
      it is usually refunded to your account automatically by your bank.
    </p>
    {reason && (
      <p className="text-sm mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        Reason: {reason}
      </p>
    )}
    {orderId && (
      <div className="bg-muted rounded-lg p-3 my-4">
        <p className="text-xs text-muted-foreground">Order ID</p>
        <p className="font-mono font-semibold break-all">{orderId}</p>
      </div>
    )}
    <div className="space-y-3 mt-6">
      <Button asChild className="w-full" size="lg">
        <Link to={tryAgainTo}>Try again</Link>
      </Button>
      <Button asChild variant="outline" className="w-full">
        <Link to="/support">Contact support</Link>
      </Button>
    </div>
  </Card>
);

const PaymentFailed = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state ?? {}) as Record<string, unknown>;
  const stateSlug = str(navState.courseSlug);
  const stateReason = str(navState.reason);

  const orderId = usePaymentOrderId();
  const state = usePaymentOrder(orderId);

  // The row is the source of truth: a paid order is never shown as failed.
  useEffect(() => {
    if (state.kind === 'success') {
      navigate(`/payment-success?orderId=${encodeURIComponent(state.receipt.orderId)}`, { replace: true });
    }
  }, [state, navigate]);

  let content;
  switch (state.kind) {
    case 'loading':
    case 'success':
      content = <PaymentLoadingCard />;
      break;
    case 'pending':
      content = <PaymentPendingCard orderId={state.orderId} />;
      break;
    case 'timeout':
      content = (
        <PaymentTimeoutCard orderId={state.orderId}>
          <Button asChild variant="outline" className="w-full">
            <Link to={retryPath(stateSlug, state.courses)}>Try again</Link>
          </Button>
        </PaymentTimeoutCard>
      );
      break;
    case 'error':
      content = <PaymentLookupErrorCard orderId={state.orderId} />;
      break;
    case 'not-found':
      content = <OrderNotFoundCard orderId={state.orderId} />;
      break;
    case 'no-order':
      content = <FailedCard orderId={null} reason={stateReason} tryAgainTo={retryPath(stateSlug)} />;
      break;
    case 'failed':
      content = (
        <FailedCard
          orderId={state.receipt.orderId}
          reason={stateReason ?? state.receipt.errorMessage}
          tryAgainTo={retryPath(stateSlug, state.receipt.courses)}
        />
      );
      break;
  }

  return (
    <PaymentPageShell title="Payment Not Completed | SimpleLecture" description="Your payment was not completed">
      {content}
    </PaymentPageShell>
  );
};

export default PaymentFailed;
