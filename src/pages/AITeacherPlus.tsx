import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  GraduationCap,
  Loader2,
  Lock,
  LogIn,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { supabase } from "@/integrations/supabase/client";
import { openCheckoutAsPromise } from "@/lib/razorpay";
import { TEACHER_SETTINGS_KEY, usePlanState } from "@/lib/aiTeacherKeys";
import { isPermanentTestingAccount, useAITeacherSubscription } from "@/lib/aiTeacherSubscription";
import {
  AI_TEACHER_ORDER_COURSE_ID,
  purchasePlus,
  type CheckoutOptions,
  type CheckoutResult,
  type CreateOrderResult,
  type GrantDetails,
  type PurchaseDeps,
  type VerifyArgs,
  type VerifyResult,
} from "@/lib/aiTeacherPurchase";

const PLUS_PRICE_RUPEES = 500;

const BENEFITS = [
  "Voice and chat classes, 24/7",
  "Up to 10 of your own free Gemini keys",
  "Switches to the next key automatically",
  "Choose voice, language, personality and teacher name",
];

const STEPS = ["Pay Rs 500", "Add your free Gemini key", "Start learning"];

interface ReturnState {
  returnTo?: string;
  reopenAskAI?: { subjectName?: string };
}

export default function AITeacherPlus() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: profileUser } = useCurrentUser();
  const { state: planState, retry: retryPlan } = usePlanState();
  const { subscribe } = useAITeacherSubscription();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnState = (location.state as ReturnState | null) ?? null;
  const email = user?.email ?? "";
  const profileName = profileUser?.profile?.full_name ?? "";
  const profilePhone = profileUser?.profile?.phone_number ?? "";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => { document.title = "AI Teacher Plus | SimpleLecture"; }, []);

  // The plan is already active on the server: this page has nothing to sell, go to settings.
  useEffect(() => {
    if (planState === "active") navigate("/aiteacher/settings", { replace: true });
  }, [planState, navigate]);

  // Prefill from the profile without overwriting anything the student has typed.
  useEffect(() => {
    if (profileName) setName((prev) => prev || profileName);
  }, [profileName]);

  useEffect(() => {
    if (profilePhone) setPhone((prev) => prev || profilePhone);
  }, [profilePhone]);

  const goBack = () => {
    if (returnState?.returnTo) {
      navigate(returnState.returnTo, {
        replace: true,
        state: { askAI: { subjectName: returnState.reopenAskAI?.subjectName } },
      });
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  const handlePay = async () => {
    if (!user?.id || busy) return;
    setBusy(true);
    setError(null);

    const deps: PurchaseDeps = {
      isPermanentTestingAccount,

      createOrder: async (userId, amount, courses, customer): Promise<CreateOrderResult> => {
        const { data, error: invokeError } = await supabase.functions.invoke("create-payment-order", {
          body: {
            amount,
            courses,
            customerInfo: customer,
            promoCode: null,
            userId,
          },
        });
        const order = data as {
          orderId?: string;
          razorpayOrderId?: string;
          razorpayKeyId?: string;
          error?: string;
        } | null;
        if (invokeError) return { error: invokeError.message || "Order request failed" };
        if (!order?.razorpayOrderId || !order?.razorpayKeyId) {
          return { error: order?.error || "Missing razorpayOrderId or razorpayKeyId" };
        }
        return {
          orderId: order.orderId,
          razorpayOrderId: order.razorpayOrderId,
          razorpayKeyId: order.razorpayKeyId,
        };
      },

      openCheckout: async (opts: CheckoutOptions): Promise<CheckoutResult> => {
        const result = await openCheckoutAsPromise({
          key: opts.razorpayKeyId,
          amount: opts.amountInPaise,
          currency: opts.currency,
          name: opts.name,
          description: opts.description,
          order_id: opts.razorpayOrderId,
          prefill: {
            name: opts.customerName,
            email: opts.customerEmail,
            contact: opts.customerPhone,
          },
          theme: { color: "#047857" },
        });
        return {
          success: result.success,
          cancelled: result.cancelled,
          error: result.error,
          data: result.data
            ? {
                razorpay_payment_id: result.data.razorpay_payment_id,
                razorpay_order_id: result.data.razorpay_order_id ?? opts.razorpayOrderId,
                razorpay_signature: result.data.razorpay_signature ?? "",
              }
            : undefined,
        };
      },

      verify: async (args: VerifyArgs): Promise<VerifyResult> => {
        try {
          const { data, error: invokeError } = await supabase.functions.invoke("verify-payment", {
            body: {
              razorpay_payment_id: args.razorpay_payment_id,
              razorpay_order_id: args.razorpay_order_id,
              razorpay_signature: args.razorpay_signature,
              orderId: args.orderId,
              userId: args.userId,
              courses: args.courses,
            },
          });
          if (invokeError) {
            return {
              verified: false,
              networkError: (invokeError as { name?: string }).name === "FunctionsFetchError",
            };
          }
          return { verified: (data as { verified?: boolean } | null)?.verified === true };
        } catch {
          return { verified: false, networkError: true };
        }
      },

      grant: async (details: GrantDetails) => {
        // The existing subscribe() saves the plan locally and already records the
        // sales_leads row via recordSubscriptionInDb, so calling it again would duplicate the row.
        subscribe("byok_500", {
          name: details.name,
          email: details.email,
          phone: details.phone,
          orderId: details.orderId,
          paymentId: details.paymentId,
        });
      },
    };

    try {
      const result = await purchasePlus(
        { userId: user.id, name, email, phone, amountRupees: PLUS_PRICE_RUPEES },
        deps,
      );
      if (!mounted.current) return;
      if (result.status === "success") {
        queryClient.invalidateQueries({ queryKey: TEACHER_SETTINGS_KEY });
        navigate("/aiteacher/settings", { replace: true, state: { paymentSuccess: true } });
        return;
      }
      setError(result.message);
    } catch (err) {
      console.warn("[AITeacherPlus] unexpected purchase error:", err);
      if (mounted.current) setError("Something went wrong. You have not been charged.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Loader2 className="h-8 w-8 text-emerald-700 animate-spin mb-2" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/70 via-background to-background flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl border bg-card p-6 sm:p-8 text-center space-y-5 shadow-lg">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-700">
            <Lock className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold">Login Required</h1>
            <p className="text-xs text-muted-foreground">Please log in to buy AI Teacher Plus.</p>
          </div>
          <Button asChild className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold">
            <Link to="/auth?tab=login&redirect=/aiteacher/plus">
              <LogIn className="h-4 w-4 mr-2" /> Log In to SimpleLecture
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to="/">Back to Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  const header = (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        <Button type="button" variant="outline" size="sm" onClick={goBack} className="gap-1.5 rounded-full">
          <ArrowLeft className="h-4 w-4" />Back
        </Button>
        <h1 className="text-base font-semibold">AI Teacher Plus</h1>
      </div>
    </header>
  );

  // Never show the Pay form until the server has said the plan is not active.
  if (planState === "loading" || planState === "active") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Loader2 className="h-8 w-8 text-emerald-700 animate-spin mb-2" />
        <p className="text-sm text-muted-foreground">{planState === "active" ? "Opening your settings..." : "Checking your plan..."}</p>
      </div>
    );
  }

  if (planState === "unknown") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/70 via-background to-background">
        {header}
        <main className="mx-auto max-w-2xl px-4 py-4 pb-16">
          <div className="rounded-2xl border bg-card p-6 text-center space-y-4 shadow-sm">
            <h2 className="text-lg font-bold">Could not check your plan.</h2>
            <p className="text-sm text-muted-foreground">Please check your internet connection and try again.</p>
            <Button type="button" onClick={retryPlan} className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-semibold">
              Retry
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/70 via-background to-background">
      {header}

      <div className="mx-auto max-w-2xl px-4 py-4 pb-16 space-y-4">
        {/* Hero */}
        <section className="rounded-2xl p-6 text-white bg-gradient-to-br from-emerald-700 via-emerald-600 to-amber-500 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
              <GraduationCap className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-extrabold">Your personal 1-to-1 AI Teacher</h2>
          </div>
          <div className="mt-5 flex items-baseline gap-2">
            <span className="text-4xl font-extrabold">Rs {PLUS_PRICE_RUPEES}</span>
            <span className="text-sm text-white/80">one-time</span>
          </div>
          <span className="mt-3 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
            Pay once, no monthly fee
          </span>
        </section>

        {/* Benefits */}
        <section className="rounded-2xl border bg-card p-4 sm:p-5 shadow-sm">
          <ul className="space-y-2.5">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-start gap-2.5 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* How it works */}
        <section className="grid gap-3 md:grid-cols-3">
          {STEPS.map((label, index) => (
            <div key={label} className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">
                {index + 1}
              </span>
              <span className="text-sm font-semibold">{label}</span>
            </div>
          ))}
        </section>

        {/* Student details */}
        <section className="rounded-2xl border bg-card p-4 sm:p-5 shadow-sm space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="plus-name" className="text-xs">Full name</Label>
            <Input
              id="plus-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11"
              autoComplete="name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plus-phone" className="text-xs">Mobile number</Label>
            <Input
              id="plus-phone"
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              className="h-11"
              autoComplete="tel"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plus-email" className="text-xs">Email</Label>
            <Input id="plus-email" value={email} disabled className="h-11" />
            <p className="text-xs text-muted-foreground">Plan is linked to this login email</p>
          </div>
        </section>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Pay */}
        <div className="space-y-2">
          <Button
            type="button"
            onClick={handlePay}
            disabled={busy}
            className="w-full h-12 text-base font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl shadow-lg"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />Opening Razorpay…
              </>
            ) : (
              `Pay Rs ${PLUS_PRICE_RUPEES}`
            )}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />Secured by Razorpay · UPI, cards, net banking
          </p>
        </div>
      </div>
    </div>
  );
}
