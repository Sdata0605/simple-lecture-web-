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
export function ensureRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if ((window as any).Razorpay) return resolve(true);

    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
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

  const rzp = new window.Razorpay({
    key: options.key || "rzp_test_simplelecture",
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
