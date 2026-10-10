import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const SETTING_KEY = "ai_teacher_1to1_config";

export interface AITeacherSettings {
  enabled: boolean;
  google_api_key: string;
  live_model: string;
  chat_model: string;
  voice_name: string;
  teacher_name: string;
}

export const DEFAULT_AI_TEACHER_SETTINGS: AITeacherSettings = {
  enabled: false,
  google_api_key: "",
  live_model: "gemini-3.8-live",
  chat_model: "gemini-flash-latest",
  voice_name: "Kore",
  teacher_name: "AI Teacher",
};

export const AI_TEACHER_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];

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
      return { ...DEFAULT_AI_TEACHER_SETTINGS, ...((data?.setting_value as unknown as Partial<AITeacherSettings>) ?? {}) };
    },
  });

export const useUpdateAITeacherSettings = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (settings: AITeacherSettings) => {
      const cleaned = {
        ...settings,
        google_api_key: settings.google_api_key.trim(),
        live_model: settings.live_model.trim() || DEFAULT_AI_TEACHER_SETTINGS.live_model,
        chat_model: settings.chat_model.trim() || DEFAULT_AI_TEACHER_SETTINGS.chat_model,
        teacher_name: settings.teacher_name.trim() || DEFAULT_AI_TEACHER_SETTINGS.teacher_name,
      };
      const { data: existing } = await supabase.from("ai_settings").select("id").eq("setting_key", SETTING_KEY).maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from("ai_settings")
          .update({ setting_value: cleaned as any, updated_at: new Date().toISOString() })
          .eq("setting_key", SETTING_KEY);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("ai_settings").insert([
          { setting_key: SETTING_KEY, setting_value: cleaned as any, description: "AI Teacher 1-to-1 (public /aiteacher page) Gemini settings" },
        ]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-teacher-settings"] });
      toast({ title: "Saved", description: "AI Teacher 1-to-1 settings updated" });
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
