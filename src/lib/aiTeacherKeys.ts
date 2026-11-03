import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TeacherApiError } from "./aiTeacherApi";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type TeacherPrefs } from "./aiTeacherPrefs";
import { readPlanCache, resolvePlanState, writePlanCache, type PlanState } from "./aiTeacherPlan";
import { useAuth } from "@/contexts/AuthContext";

export interface TeacherKey {
  id: string;
  label: string;
  masked: string;
  position: number;
  status: string;
  lastError: string | null;
  lastErrorAt: string | null;
  lastUsedAt: string | null;
}

export interface TeacherPlan {
  active: boolean;
  planName: "plus" | null;
}

export interface TeacherSettings {
  prefs: TeacherPrefs;
  keys: TeacherKey[];
  activeKeyId: string | null;
  maxKeys: number;
  plan: TeacherPlan;
}

export const TEACHER_SETTINGS_KEY = ["ai-teacher", "settings"] as const;

const NO_PLAN: TeacherPlan = { active: false, planName: null };

/** Only the prefs are cached in the browser; keys are masked and always come from the server. */
function cachedSettings(): TeacherSettings {
  return { prefs: loadPrefs(), keys: [], activeKeyId: null, maxKeys: 10, plan: NO_PLAN };
}

/**
 * Calls the `ai-teacher-keys` edge function. Throws a TeacherApiError whose `code` is the server code
 * (INVALID_KEY, KEY_LIMIT, DUPLICATE_KEY, NOT_FOUND, BAD_REQUEST, UNAUTHORIZED, NO_KEYS, ALL_KEYS_FAILED).
 */
export async function keysApi(action: string, body: Record<string, unknown> = {}): Promise<TeacherSettings> {
  const { data, error } = await supabase.functions.invoke("ai-teacher-keys", { body: { action, ...body } });
  if (!error) {
    if (data?.error) throw new TeacherApiError(String(data.error), undefined, data.code ? String(data.code) : undefined);
    return data as TeacherSettings;
  }
  let message = "";
  let code: string | undefined;
  let status: number | undefined;
  const res = (error as any).context as Response | undefined;
  if (res && typeof res.json === "function") {
    status = res.status;
    try {
      const j = await res.json();
      if (j?.error) message = String(j.error);
      if (j?.code) code = String(j.code);
    } catch { /* not JSON */ }
  }
  throw new TeacherApiError(
    message || "Connection problem. Please check your internet and try again.",
    status,
    code,
  );
}

export function useTeacherSettings() {
  return useQuery<TeacherSettings>({
    queryKey: TEACHER_SETTINGS_KEY,
    queryFn: async () => {
      const settings = await keysApi("get");
      // Remember the server's plan answer for this user so a later failed check can fall back to it.
      const active = settings?.plan?.active;
      if (typeof active === "boolean") {
        try {
          const { data } = await supabase.auth.getSession();
          const uid = data.session?.user?.id;
          if (uid) writePlanCache(uid, active);
        } catch {
          // The cache is optional.
        }
      }
      return settings;
    },
    // The cache shows at once; initialDataUpdatedAt 0 makes it count as stale so the server answer follows.
    initialData: cachedSettings,
    initialDataUpdatedAt: 0,
  });
}

/**
 * The plan state the UI should act on. 'active' and 'inactive' come only from a real server answer (or the
 * cached answer when the check fails). 'loading' and 'unknown' must never show the purchase offer.
 */
export function usePlanState(): { state: PlanState; retry: () => void } {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const query = useTeacherSettings();
  // dataUpdatedAt stays 0 until the server has answered, so the seeded cache data is never read as a server answer.
  const answered = query.dataUpdatedAt > 0 && !query.isError;
  const plan = query.data?.plan;
  const serverActive = answered && plan && typeof plan.active === "boolean" ? plan.active : undefined;
  const state = resolvePlanState({
    serverActive,
    error: query.isError,
    cached: userId ? readPlanCache(userId) : null,
    loading: !query.isError && query.dataUpdatedAt === 0,
  });
  return { state, retry: () => { void query.refetch(); } };
}

function useSettingsMutation<TVars>(action: string, pick?: (vars: TVars) => Record<string, unknown>) {
  const qc = useQueryClient();
  return useMutation<TeacherSettings, Error, TVars>({
    mutationFn: (vars) => keysApi(action, pick ? pick(vars) : (vars as Record<string, unknown>)),
    onSuccess: (data) => {
      if (data?.prefs) savePrefs({ ...DEFAULT_PREFS, ...data.prefs });
      qc.invalidateQueries({ queryKey: TEACHER_SETTINGS_KEY });
    },
  });
}

export function useAddKey() {
  return useSettingsMutation<{ label: string; apiKey: string }>("addKey");
}

export function useUpdateKey() {
  return useSettingsMutation<{ id: string; label?: string; apiKey?: string }>("updateKey");
}

export function useDeleteKey() {
  return useSettingsMutation<{ id: string }>("deleteKey");
}

export function useReorderKeys() {
  return useSettingsMutation<{ ids: string[] }>("reorder");
}

export function useSetActiveKey() {
  return useSettingsMutation<{ id: string }>("setActive");
}

export function useTestKey() {
  return useSettingsMutation<{ id: string }>("testKey");
}

export function useSavePrefs() {
  return useSettingsMutation<{ prefs: TeacherPrefs }>("savePrefs");
}
