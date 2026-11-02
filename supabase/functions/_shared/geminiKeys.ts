// Gemini API keys for server-side reminder voice generation.
//
// Order: optional secret REMINDER_GEMINI_API_KEY first, then the AI Teacher config row
// public.ai_settings (setting_key 'ai_teacher_1to1_config'): google_api_key, then
// key_pool[].key where status !== 'invalid'. Trimmed, de-duplicated, cached 60 s.
// Keys are never logged or returned; callers must not print them either.
// Read with the service role client only (the table is admin-only under RLS).

// deno-lint-ignore no-explicit-any
type SbLike = any;

const CACHE_MS = 60_000;
const CONFIG_ROW = "ai_teacher_1to1_config";

let cache: { keys: string[]; at: number } | null = null;

export async function loadGeminiKeys(sb: SbLike): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.keys;

  const keys: string[] = [];
  const override = (Deno.env.get("REMINDER_GEMINI_API_KEY") ?? "").trim();
  if (override) keys.push(override);

  let loadedOk = true;
  try {
    const { data, error } = await sb
      .from("ai_settings")
      .select("setting_value")
      .eq("setting_key", CONFIG_ROW)
      .maybeSingle();
    if (error) {
      loadedOk = false;
      console.error("gemini key config load failed");
    }
    const v = (data?.setting_value ?? {}) as Record<string, unknown>;
    if (typeof v.google_api_key === "string" && v.google_api_key.trim()) {
      keys.push(v.google_api_key.trim());
    }
    if (Array.isArray(v.key_pool)) {
      for (const item of v.key_pool) {
        const isObj = typeof item === "object" && item !== null;
        const k = typeof item === "string" ? item : isObj ? (item as { key?: unknown }).key : undefined;
        const status = isObj ? (item as { status?: unknown }).status : undefined;
        if (typeof k === "string" && k.trim() && status !== "invalid") keys.push(k.trim());
      }
    }
  } catch {
    loadedOk = false;
    console.error("gemini key config load threw");
  }

  const unique = [...new Set(keys)];
  if (loadedOk) cache = { keys: unique, at: Date.now() };
  return unique;
}
