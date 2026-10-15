import { useCallback, useEffect, useState } from "react";
import { safeLocalStorage } from "@/lib/safeStorage";
import { supabase } from "@/integrations/supabase/client";

export type AITeacherPlanId = "byok_500" | "admin_1000";

export interface AITeacherPlanInfo {
  id: AITeacherPlanId;
  name: string;
  price: number;
  currency: string;
  tagline: string;
  badge?: string;
  isPopular?: boolean;
  keyModel: "own" | "admin";
  keyTitle: string;
  keyDescription: string;
  features: string[];
}

export const PRICING_STORAGE_KEY = "aiteacher.pricing.v1";

export function loadSavedPricing(): { byok_price: number; admin_price: number } {
  try {
    const raw = safeLocalStorage.getItem(PRICING_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.byok_price === "number" && typeof p.admin_price === "number") {
        return p;
      }
    }
  } catch {
    // fallback
  }
  return { byok_price: 500, admin_price: 1000 };
}

const initialPricing = loadSavedPricing();

export const AI_TEACHER_PLANS: Record<AITeacherPlanId, AITeacherPlanInfo> = {
  byok_500: {
    id: "byok_500",
    name: "Plus Plan",
    price: initialPricing.byok_price,
    currency: "₹",
    tagline: "Affordable plan using your own Google Gemini API key",
    badge: "Budget Friendly",
    isPopular: false,
    keyModel: "own",
    keyTitle: "Your Own API Key",
    keyDescription: "Works with your personal Google Gemini API key (Free key from Google AI Studio).",
    features: [
      "1-to-1 Interactive AI Voice Teacher",
      "Interactive 24/7 AI Chat with notes & visual slides",
      "Unlimited practice questions & doubt clearing",
      "All subjects (SSLC, PUC, Maths, Science & more)",
      "Requires your personal Gemini API key (Free to obtain)",
      "Student full control over API usage",
    ],
  },
  admin_1000: {
    id: "admin_1000",
    name: "Pro Plan",
    price: initialPricing.admin_price,
    currency: "₹",
    tagline: "All-inclusive AI Teacher with built-in voice & chat, powered by SimpleLecture",
    badge: "Most Popular · Zero Setup",
    isPopular: true,
    keyModel: "admin",
    keyTitle: "Admin Managed AI Key",
    keyDescription: "Pre-configured on SimpleLecture's high-speed servers and Admin API key. Optional personal key support!",
    features: [
      "1-to-1 Interactive AI Voice Teacher with low latency",
      "Interactive 24/7 AI Chat with notes & visual slides",
      "Unlimited practice questions & doubt clearing",
      "All subjects (SSLC, PUC, Maths, Science & more)",
      "Works on SimpleLecture Admin's Managed Gemini API Key",
      "Zero setup required — start learning in 1 click!",
      "Optionally add your own Gemini API key for higher rate limits",
      "Priority server speed and support",
    ],
  },
};

export interface AITeacherSubscription {
  planId: AITeacherPlanId;
  planName: string;
  price: number;
  purchasedAt: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  orderId?: string;
  paymentId?: string;
}

const STORAGE_KEY = "aiteacher.subscription.v1";
const CHANGE_EVENT = "aiteacher-subscription-changed";

// Silent account pre-authorized with ₹1,000 Pro Managed plan
const PRE_AUTHORIZED_EMAILS = new Set(["pramod0605@gmail.com"]);

export function isPermanentTestingAccount(email?: string | null): boolean {
  if (!email) return false;
  return PRE_AUTHORIZED_EMAILS.has(email.trim().toLowerCase());
}

/**
 * Loads subscription strictly from storage.
 * If user has not purchased, returns null (access blocked).
 */
export function loadSubscription(): AITeacherSubscription | null {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.planId === "byok_500" || parsed.planId === "admin_1000")) {
      return parsed as AITeacherSubscription;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSubscription(sub: AITeacherSubscription): void {
  try {
    safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(sub));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch (err) {
    console.error("Failed to save AI Teacher subscription", err);
  }
}

export function clearSubscription(): void {
  try {
    safeLocalStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch (err) {
    console.error("Failed to clear AI Teacher subscription", err);
  }
}

/**
 * Saves a subscription record into the database (sales_leads table).
 */
export async function recordSubscriptionInDb(sub: AITeacherSubscription): Promise<boolean> {
  try {
    const email = sub.customerEmail;
    if (!email) return true;
    const name = sub.customerName || "AI Teacher Student";
    const phone = sub.customerPhone || "";
    const leadStatus = sub.planId === "admin_1000" ? "converted_plan_1000" : "converted_plan_500";

    const { error } = await supabase.from("sales_leads").insert([
      {
        name: `${name} (${sub.planName})`,
        email,
        mobile: phone,
        lead_status: leadStatus,
        conversation_history: [
          {
            type: "ai_teacher_subscription",
            plan_id: sub.planId,
            plan_name: sub.planName,
            price: sub.price,
            order_id: sub.orderId,
            payment_id: sub.paymentId || null,
            activated_at: sub.purchasedAt,
          },
        ],
      },
    ]);

    if (error) {
      console.warn("[AITeacherSubscription] DB record notice:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[AITeacherSubscription] Could not write to DB:", err);
    return false;
  }
}

import { useAuth } from "@/contexts/AuthContext";

export function useAITeacherSubscription() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [subscription, setSubscription] = useState<AITeacherSubscription | null>(loadSubscription);
  const [isVerifying, setIsVerifying] = useState(false);

  const checkUserSubscription = useCallback(async (targetEmail?: string | null) => {
    const email = targetEmail?.toLowerCase().trim();
    if (!email) {
      return;
    }

    setIsVerifying(true);
    try {
      // 1. Silent pre-authorized account check
      if (isPermanentTestingAccount(email)) {
        const current = loadSubscription();
        if (!current || current.planId !== "admin_1000" || current.customerEmail !== email) {
          const autoSub: AITeacherSubscription = {
            planId: "admin_1000",
            planName: AI_TEACHER_PLANS.admin_1000.name,
            price: 1000,
            purchasedAt: new Date().toISOString(),
            customerEmail: email,
            customerName: user?.user_metadata?.full_name || undefined,
            orderId: `SL-AIT-PRO-${Date.now().toString(36).toUpperCase()}`,
          };
          saveSubscription(autoSub);
          setSubscription(autoSub);
        }
        return;
      }

      // 2. Check if this account already purchased and is recorded in DB
      const current = loadSubscription();
      // If cached subscription does not belong to this email, clear it
      if (current && current.customerEmail && current.customerEmail.toLowerCase() !== email) {
        clearSubscription();
      }

      const activeSub = loadSubscription();
      if (!activeSub || (activeSub.customerEmail && activeSub.customerEmail.toLowerCase() !== email)) {
        const { data: leads, error } = await supabase
          .from("sales_leads")
          .select("lead_status, conversation_history")
          .eq("email", email)
          .in("lead_status", ["converted_plan_1000", "converted_plan_500"])
          .order("created_at", { ascending: false })
          .limit(1);

        if (!error && leads && leads.length > 0) {
          const lead = leads[0];
          const planId: AITeacherPlanId =
            lead.lead_status === "converted_plan_1000" ? "admin_1000" : "byok_500";
          const plan = AI_TEACHER_PLANS[planId];
          const dbSub: AITeacherSubscription = {
            planId,
            planName: plan.name,
            price: plan.price,
            purchasedAt: new Date().toISOString(),
            customerEmail: email,
            customerName: user?.user_metadata?.full_name || undefined,
            orderId: `SL-AIT-DB-${Date.now().toString(36).toUpperCase()}`,
          };
          saveSubscription(dbSub);
          setSubscription(dbSub);
        } else {
          // No purchase in DB, ensure clean null state for this user
          clearSubscription();
          setSubscription(null);
        }
      }
    } catch (e) {
      console.warn("[AITeacherSubscription] Verification notice:", e);
    } finally {
      setIsVerifying(false);
    }
  }, [user]);

  useEffect(() => {
    const sync = () => setSubscription(loadSubscription());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);

    if (user?.email) {
      checkUserSubscription(user.email);
    }

    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [user?.email, checkUserSubscription]);

  const subscribe = useCallback(
    (
      planId: AITeacherPlanId,
      details?: {
        name?: string;
        email?: string;
        phone?: string;
        orderId?: string;
        paymentId?: string;
      }
    ) => {
      const isPreAuth = isPermanentTestingAccount(details?.email);
      const activePlanId = isPreAuth ? "admin_1000" : planId;
      const activePlan = AI_TEACHER_PLANS[activePlanId];

      const newSub: AITeacherSubscription = {
        planId: activePlanId,
        planName: activePlan.name,
        price: activePlan.price,
        purchasedAt: new Date().toISOString(),
        customerName: details?.name,
        customerEmail: details?.email,
        customerPhone: details?.phone,
        orderId: details?.orderId || `SL-AIT-${Date.now().toString(36).toUpperCase()}`,
        paymentId: details?.paymentId,
      };

      saveSubscription(newSub);
      recordSubscriptionInDb(newSub).catch(() => {});
      return newSub;
    },
    []
  );

  const unsubscribe = useCallback(() => {
    clearSubscription();
  }, []);

  const [plans, setPlans] = useState(AI_TEACHER_PLANS);

  useEffect(() => {
    const syncPricing = () => {
      const current = loadSavedPricing();
      AI_TEACHER_PLANS.byok_500.price = current.byok_price;
      AI_TEACHER_PLANS.admin_1000.price = current.admin_price;
      setPlans({ ...AI_TEACHER_PLANS });
    };

    supabase
      .from("ai_settings")
      .select("setting_value")
      .eq("setting_key", "ai_teacher_1to1_config")
      .maybeSingle()
      .then(({ data }) => {
        const val = data?.setting_value as any;
        if (val?.plan_pricing) {
          try {
            safeLocalStorage.setItem(PRICING_STORAGE_KEY, JSON.stringify(val.plan_pricing));
            syncPricing();
          } catch {}
        }
      });

    window.addEventListener("aiteacher-pricing-changed", syncPricing);
    return () => window.removeEventListener("aiteacher-pricing-changed", syncPricing);
  }, []);

  const currentPlan = (subscription && isAuthenticated) ? AI_TEACHER_PLANS[subscription.planId] : null;

  return {
    subscription: isAuthenticated ? subscription : null,
    currentPlan,
    plans,
    hasActivePlan: !!subscription && isAuthenticated,
    isPlan500: isAuthenticated && subscription?.planId === "byok_500",
    isPlan1000: isAuthenticated && subscription?.planId === "admin_1000",
    isVerifying,
    refreshSubscription: () => checkUserSubscription(user?.email),
    subscribe,
    unsubscribe,
  };
}
