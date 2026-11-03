/**
 * Razorpay Checkout SDK Helper
 * Loads checkout.js on-demand and manages standard checkout modal lifecycle.
 */

declare global {
  interface Window {
    Razorpay: any;
  }
}

export interface RazorpaySuccessPayload {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
}

export interface RazorpayCheckoutOptions {
  key?: string;
  amount: number; // in paise (e.g. 50000 for ₹500, 100000 for ₹1000)
  currency?: string;
  name?: string;
  description?: string;
  order_id?: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
  theme?: {
    color?: string;
  };
  modal?: {
    ondismiss?: () => void;
    confirm_close?: boolean;
  };
  handler?: (response: RazorpaySuccessPayload) => void | Promise<void>;
}

/**
 * Loads Razorpay checkout script on demand if not already loaded.
 */
const LOAD_FAILED_MESSAGE = "Could not load Razorpay. Check your internet.";
const LOAD_TIMEOUT_MS = 10000;

export function ensureRazorpay(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve(false);
    if ((window as any).Razorpay) return resolve(true);

    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay="true"]');
    if (existing) {
      // A script from an earlier call is already in flight (or finished without
      // exposing window.Razorpay). Wait for it, but never hang forever.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        if (timer !== undefined) clearTimeout(timer);
        existing.removeEventListener("load", onLoad);
        existing.removeEventListener("error", onError);
      };
      const onLoad = () => {
        done();
        if ((window as any).Razorpay) resolve(true);
        else reject(new Error(LOAD_FAILED_MESSAGE));
      };
      const onError = () => {
        done();
        reject(new Error(LOAD_FAILED_MESSAGE));
      };
      existing.addEventListener("load", onLoad);
      existing.addEventListener("error", onError);
      timer = setTimeout(() => {
        done();
        reject(new Error(LOAD_FAILED_MESSAGE));
      }, LOAD_TIMEOUT_MS);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpay = "true";
    script.onload = () => resolve(true);
    script.onerror = () => {
      console.warn("[Razorpay] Failed to load checkout.js");
      resolve(false);
    };
    document.body.appendChild(script);
  });
}

/**
 * Opens the Razorpay modal with provided options.
 */
export async function openRazorpayCheckout(
  options: RazorpayCheckoutOptions,
  onFailed?: (error: any) => void
): Promise<any> {
  const isLoaded = await ensureRazorpay();
  if (!isLoaded || !window.Razorpay) {
    throw new Error("Razorpay SDK could not be loaded. Please check your internet connection.");
  }

  if (!options.key) {
    throw new Error("Razorpay key is missing. Payment cannot be started.");
  }

  const rzp = new window.Razorpay({
    key: options.key,
    amount: options.amount,
    currency: options.currency || "INR",
    name: options.name || "SimpleLecture",
    description: options.description || "Course / Service Payment",
    order_id: options.order_id || undefined,
    prefill: options.prefill || {},
    notes: options.notes || {},
    theme: options.theme || { color: "#f59e0b" },
    handler: options.handler,
    modal: {
      ondismiss: () => {
        if (options.modal?.ondismiss) {
          options.modal.ondismiss();
        }
      },
    },
  });

  if (onFailed) {
    rzp.on("payment.failed", (res: any) => {
      onFailed(res.error || res);
    });
  }

  rzp.open();
  return rzp;
}

export interface RazorpayPromiseResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
  data?: RazorpaySuccessPayload;
}

/**
 * Promise wrapper around the Razorpay modal. Resolves exactly once:
 * - success: the handler fired (payment captured by Razorpay)
 * - cancelled: the user dismissed the modal
 * - error: payment.failed or the SDK could not be opened
 */
export function openCheckoutAsPromise(
  options: Omit<RazorpayCheckoutOptions, "handler" | "modal">
): Promise<RazorpayPromiseResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: RazorpayPromiseResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    openRazorpayCheckout(
      {
        ...options,
        handler: (response) => finish({ success: true, data: response }),
        modal: {
          ondismiss: () => finish({ success: false, cancelled: true }),
        },
      },
      (error) => {
        const message =
          error?.description || error?.reason || error?.message || "Payment failed. Please try again.";
        finish({ success: false, error: String(message) });
      }
    ).catch((err: any) => {
      finish({ success: false, error: err?.message || "Payment could not be started." });
    });
  });
}
