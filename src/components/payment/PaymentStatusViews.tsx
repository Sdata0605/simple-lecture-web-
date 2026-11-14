import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Loader2, SearchX, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SEOHead } from '@/components/SEO';
import { SmartHeader } from '@/components/SmartHeader';
import { Footer } from '@/components/Footer';
import { BottomNav } from '@/components/mobile/BottomNav';

/** Page frame shared by the payment result screens. Chrome is hidden when printing. */
export const PaymentPageShell = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <>
    <SEOHead title={title} description={description} />
    <div className="print:hidden">
      <SmartHeader />
    </div>
    <div className="min-h-screen bg-background flex items-center justify-center p-4 pb-20 md:pb-4 print:min-h-0 print:block print:p-0">
      {children}
    </div>
    <div className="print:hidden">
      <Footer />
      <BottomNav />
    </div>
  </>
);

const OrderIdLine = ({ orderId }: { orderId: string }) => (
  <div className="bg-muted rounded-lg p-3 my-4">
    <p className="text-xs text-muted-foreground">Order ID</p>
    <p className="font-mono font-semibold break-all">{orderId}</p>
  </div>
);

export const PaymentLoadingCard = ({ text = 'Loading your order details...' }: { text?: string }) => (
  <div className="text-center space-y-4">
    <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
    <p className="text-lg">{text}</p>
  </div>
);

export const PaymentPendingCard = ({ orderId }: { orderId: string }) => (
  <Card className="max-w-md w-full p-6 md:p-8 text-center">
    <Loader2 className="h-14 w-14 animate-spin mx-auto mb-4 text-primary" />
    <h1 className="text-2xl font-bold mb-2">Confirming your payment...</h1>
    <p className="text-sm text-muted-foreground">
      This usually takes a few seconds. Please don't close or refresh this page.
    </p>
    <OrderIdLine orderId={orderId} />
  </Card>
);

export const PaymentTimeoutCard = ({
  orderId,
  children,
}: {
  orderId: string;
  children?: ReactNode;
}) => (
  <Card className="max-w-md w-full p-6 md:p-8 text-center">
    <Clock className="h-14 w-14 mx-auto mb-4 text-amber-500" />
    <h1 className="text-2xl font-bold mb-2">We're still confirming your payment</h1>
    <p className="text-sm text-muted-foreground">
      We haven't received a confirmation for this order yet. If money was deducted, it is
      usually confirmed within a few minutes and your course will appear in My Courses.
    </p>
    <OrderIdLine orderId={orderId} />
    <p className="text-sm text-muted-foreground mb-6">
      Please <Link to="/support" className="text-primary underline">contact support</Link> with
      this order ID if you were charged.
    </p>
    <div className="space-y-3">
      <Button asChild className="w-full" size="lg">
        <Link to="/my-courses">Go to My Courses</Link>
      </Button>
      {children}
    </div>
  </Card>
);

export const OrderNotFoundCard = ({ orderId }: { orderId?: string | null }) => (
  <Card className="max-w-md w-full p-6 md:p-8 text-center">
    <SearchX className="h-14 w-14 mx-auto mb-4 text-muted-foreground" />
    <h1 className="text-2xl font-bold mb-2">Order not found</h1>
    <p className="text-sm text-muted-foreground mb-6">
      We couldn't find this order on your account. Make sure you're logged in with the account
      you used to pay.
    </p>
    <div className="space-y-3">
      <Button asChild className="w-full" size="lg">
        <Link to="/my-courses">Go to My Courses</Link>
      </Button>
      <Button asChild variant="outline" className="w-full">
        <Link to="/support">Contact support</Link>
      </Button>
    </div>
    {orderId ? <p className="text-xs text-muted-foreground mt-4 break-all">Reference: {orderId}</p> : null}
  </Card>
);

export const PaymentLookupErrorCard = ({ orderId }: { orderId: string }) => (
  <Card className="max-w-md w-full p-6 md:p-8 text-center">
    <AlertTriangle className="h-14 w-14 mx-auto mb-4 text-amber-500" />
    <h1 className="text-2xl font-bold mb-2">Couldn't load your order</h1>
    <p className="text-sm text-muted-foreground">
      Please check your connection and reload this page.
    </p>
    <OrderIdLine orderId={orderId} />
    <div className="space-y-3">
      <Button className="w-full" size="lg" onClick={() => window.location.reload()}>
        Reload
      </Button>
      <Button asChild variant="outline" className="w-full">
        <Link to="/support">Contact support</Link>
      </Button>
    </div>
  </Card>
);
