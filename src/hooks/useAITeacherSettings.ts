import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const SETTING_KEY = "ai_teacher_1to1_config";

export interface AITeacherKeyItem {
  id: string;
  key: string;
  label?: string;
  status: "active" | "rate_limited" | "invalid" | "untested";
  lastTestedAt?: string;
  lastErrorMessage?: string;
  addedAt: string;
}

export interface AITeacherPlanPricing {
  byok_price: number;
  admin_price: number;
}

export interface AITeacherSettings {
  enabled: boolean;
  google_api_key: string;
  key_pool: AITeacherKeyItem[];
  live_model: string;
  chat_model: string;
  voice_name: string;
  teacher_name: string;
  personality_preset?: string;
  custom_instructions?: string;
  reply_language?: string;
  plan_pricing: AITeacherPlanPricing;
}

export const DEFAULT_AI_TEACHER_SETTINGS: AITeacherSettings = {
  enabled: false,
  google_api_key: "",
  key_pool: [],
  live_model: "gemini-3.8-live",
  chat_model: "gemini-3.1-flash-lite",
  voice_name: "Kore",
  teacher_name: "AI Teacher",
  personality_preset: "friendly",
  custom_instructions: "",
  reply_language: "auto",
  plan_pricing: {
    byok_price: 500,
    admin_price: 1000,
  },
};

export const AI_TEACHER_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];

export const AI_TEACHER_PERSONALITIES = [
  { id: "friendly", label: "Friendly Guide", emoji: "😊", desc: "Warm, supportive, and patient" },
  { id: "socratic", label: "Socratic Questioner", emoji: "🤔", desc: "Asks guiding questions to help you discover answers" },
  { id: "coach", label: "Strict Exam Coach", emoji: "🎯", desc: "Direct, focused on marks, formulas, and board accuracy" },
  { id: "cheerful", label: "Cheerful & Enthusiastic", emoji: "🌟", desc: "High energy, celebrates every step of your progress" },
];

export const AI_TEACHER_LANGUAGES = [
  { id: "auto", label: "Same language as student (Auto)" },
  { id: "en", label: "English only" },
  { id: "kn", label: "Kannada only" },
  { id: "kn-latn", label: "Kanglish (Kannada in English script)" },
  { id: "hi", label: "Hindi" },
];

/** Fast client-side test for an individual Gemini key */
export async function testGeminiKey(apiKey: string): Promise<{
  ok: boolean;
  status: "active" | "rate_limited" | "invalid";
  message: string;
}> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { ok: false, status: "invalid", message: "Key is empty" };
  }
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite`,
      {
        headers: { "x-goog-api-key": cleanKey },
        signal: AbortSignal.timeout(12_000),
      }
    );
    if (r.ok) {
      return { ok: true, status: "active", message: "Key verified & active" };
    }
    const b = await r.json().catch(() => ({}));
    if (r.status === 429) {
      return { ok: false, status: "rate_limited", message: "Rate limit / quota exhausted (429)" };
    }
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      return {
        ok: false,
        status: "invalid",
        message: b?.error?.message ? String(b.error.message).slice(0, 120) : "Invalid API key or forbidden (400/403)",
      };
    }
    return {
      ok: false,
      status: "invalid",
      message: `Google responded with HTTP ${r.status}`,
    };
  } catch (e: any) {
    return { ok: false, status: "invalid", message: e?.message || "Connection timeout" };
  }
}

export const useAITeacherSettings = () =>
  useQuery({
    queryKey: ["ai-teacher-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_settings")
        .select("setting_value")
        .eq("setting_key", SETTING_KEY)
        .maybeSingle();
      if (error) throw error;
      const val = (data?.setting_value as unknown as Partial<AITeacherSettings>) ?? {};
      const keyPool = Array.isArray(val.key_pool) ? val.key_pool : [];
      
      // If key_pool is empty but google_api_key exists, seed pool with primary key
      if (keyPool.length === 0 && val.google_api_key) {
        keyPool.push({
          id: "primary-key",
          key: val.google_api_key,
          label: "Primary Key",
          status: "active",
          addedAt: new Date().toISOString(),
        });
      }

      return {
        ...DEFAULT_AI_TEACHER_SETTINGS,
        ...val,
        key_pool: keyPool,
        plan_pricing: {
          ...DEFAULT_AI_TEACHER_SETTINGS.plan_pricing,
          ...(val.plan_pricing ?? {}),
        },
      } as AITeacherSettings;
    },
  });

export const useUpdateAITeacherSettings = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (settings: AITeacherSettings) => {
      // Ensure key pool has at most 100 keys
      const pool = (settings.key_pool || []).slice(0, 100).map((k) => ({
        ...k,
        key: k.key.trim(),
      }));

      // Pick primary key: either explicitly set or first active key in pool
      let primaryKey = settings.google_api_key.trim();
      if (!primaryKey && pool.length > 0) {
        const firstActive = pool.find((k) => k.status === "active") || pool[0];
        primaryKey = firstActive.key;
      }

      const cleaned: AITeacherSettings = {
        ...settings,
        google_api_key: primaryKey,
        key_pool: pool,
        live_model: settings.live_model.trim() || DEFAULT_AI_TEACHER_SETTINGS.live_model,
        chat_model: settings.chat_model.trim() || DEFAULT_AI_TEACHER_SETTINGS.chat_model,
        teacher_name: settings.teacher_name.trim() || DEFAULT_AI_TEACHER_SETTINGS.teacher_name,
        plan_pricing: {
          byok_price: Math.max(0, Number(settings.plan_pricing?.byok_price) || 500),
          admin_price: Math.max(0, Number(settings.plan_pricing?.admin_price) || 1000),
        },
      };

      // Sync pricing to localStorage & dispatch event so student pages update immediately
      try {
        localStorage.setItem("aiteacher.pricing.v1", JSON.stringify(cleaned.plan_pricing));
        window.dispatchEvent(
          new CustomEvent("aiteacher-pricing-changed", { detail: cleaned.plan_pricing })
        );
      } catch {
        // ignore storage errors
      }

      const { data: existing } = await supabase
        .from("ai_settings")
        .select("id")
        .eq("setting_key", SETTING_KEY)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("ai_settings")
          .update({ setting_value: cleaned as any, updated_at: new Date().toISOString() })
          .eq("setting_key", SETTING_KEY);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("ai_settings").insert([
          {
            setting_key: SETTING_KEY,
            setting_value: cleaned as any,
            description: "AI Teacher 1-to-1 (public /aiteacher page) Gemini settings & 100-key pool",
          },
        ]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-teacher-settings"] });
      toast({ title: "Settings Saved", description: "AI Teacher settings, key pool & pricing updated successfully." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
};

export interface AITeacherTestResult {
  chatModel: { model: string; ok: boolean; message?: string };
  liveModel: { model: string; ok: boolean; message?: string };
  token: { ok: boolean; skipped?: boolean; message?: string; lockLevel?: string; apiVersion?: string };
}

/** Admin-only server-side check of the key, both models, and ephemeral-token creation. */
export const useTestAITeacher = () =>
  useMutation({
    mutationFn: async (s: Pick<AITeacherSettings, "google_api_key" | "live_model" | "chat_model">) => {
      const { data, error } = await supabase.functions.invoke("ai-teacher", {
        body: { action: "test", apiKey: s.google_api_key, liveModel: s.live_model, chatModel: s.chat_model },
      });
      if (error) {
        // Surface the function's JSON error message when there is one
        let msg = error.message;
        try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep default */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      return data as AITeacherTestResult;
    },
  });
