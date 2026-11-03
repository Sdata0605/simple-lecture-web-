// Per-student Gemini API keys for the AI Teacher (bring-your-own-key, stored server-side).
//
// Tables (service role only, written by ai-teacher-keys and read by ai-teacher):
//   public.ai_teacher_user_keys   one row per key (ciphertext, iv, last 4 chars, hash, status)
//   public.ai_teacher_user_prefs  active_key_id and persona settings, one row per user
//
// Keys are stored in plain text in key_ciphertext (the column name is kept to avoid a migration).
// Row-level security keeps each student's rows private; only the service role reads full keys.
// Plain keys are used only on the server. Never log or return a full key.

// deno-lint-ignore-file no-explicit-any
type SbLike = any;

export type KeyStatus = "active" | "untested" | "rate_limited" | "invalid";

/** A key ready to use. `key` is the plain text: pass it to Gemini only, never to the browser. */
export interface StudentKey {
  id: string;
  label: string;
  key: string;
  last4: string;
  position: number;
  status: string;
  lastError: string | null;
  lastErrorAt: string | null;
  lastUsedAt: string | null;
}

const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;
/** Stores a plain key (no encryption). The iv field is kept empty for the existing schema. */
export async function encryptKey(plain: string): Promise<{ cipher: string; iv: string }> {
  return { cipher: plain, iv: "" };
}

/** Returns the stored plain key. */
export async function decryptKey(cipher: string, _iv: string): Promise<string> {
  return cipher;
}

/** Display form only: 'AIza…' + the last 4 characters. */
export function maskKey(last4: string): string {
  return `AIza…${last4}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A key is usable unless invalid, or rate-limited within the last 60 minutes. */
export function isUsableKey(status: string, lastErrorAt: string | null, now = Date.now()): boolean {
  if (status === "invalid") return false;
  if (status === "rate_limited") return !!lastErrorAt && now - Date.parse(lastErrorAt) >= RATE_LIMIT_COOLDOWN_MS;
  return true;
}

/**
 * Loads a student's usable keys with plain text, the active key first, then by position.
 * Skips 'invalid' keys and keys rate-limited in the last 60 minutes.
 */
export async function loadStudentKeys(sb: SbLike, userId: string): Promise<StudentKey[]> {
  const [keysRes, prefRes] = await Promise.all([
    sb.from("ai_teacher_user_keys")
      .select("id, label, key_ciphertext, key_iv, key_last4, position, status, last_error, last_error_at, last_used_at")
      .eq("user_id", userId)
      .order("position", { ascending: true }),
    sb.from("ai_teacher_user_prefs").select("active_key_id").eq("user_id", userId).maybeSingle(),
  ]);
  if (keysRes.error) throw new Error("could not load AI Teacher keys");
  if (prefRes.error) throw new Error("could not load AI Teacher prefs");

  const activeId: string | null = prefRes.data?.active_key_id ?? null;
  const now = Date.now();
  const rows: any[] = (keysRes.data ?? []).filter((r: any) => isUsableKey(r.status, r.last_error_at, now));
  const rank = (r: any) => (r.id === activeId ? 0 : 1);
  rows.sort((a, b) => rank(a) - rank(b) || a.position - b.position);

  const out: StudentKey[] = [];
  for (const r of rows) {
    out.push({
      id: r.id,
      label: r.label ?? "",
      key: await decryptKey(r.key_ciphertext, r.key_iv),
      last4: r.key_last4,
      position: r.position,
      status: r.status,
      lastError: r.last_error ?? null,
      lastErrorAt: r.last_error_at ?? null,
      lastUsedAt: r.last_used_at ?? null,
    });
  }
  return out;
}

/** Stores a key's status. Failures (rate_limited, invalid) also stamp last_error_at. */
export async function markKey(sb: SbLike, id: string, status: KeyStatus, err: string | null): Promise<void> {
  const now = new Date().toISOString();
  const failed = status === "rate_limited" || status === "invalid";
  // Never store anything that looks like a key.
  const message = err ? err.replace(/AIza[\w-]{6,}/g, "AIza…").slice(0, 300) : null;
  const { error } = await sb.from("ai_teacher_user_keys")
    .update({ status, last_error: message, last_error_at: failed ? now : null, updated_at: now })
    .eq("id", id);
  if (error) console.error("[ai-teacher] could not update key status");
}

/** Records that a key was used successfully. */
export async function touchKey(sb: SbLike, id: string): Promise<void> {
  const { error } = await sb.from("ai_teacher_user_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[ai-teacher] could not update key use time");
}

/** Sets (or clears) the user's active key. Creates the prefs row if it does not exist yet. */
export async function setActiveKey(sb: SbLike, userId: string, keyId: string | null): Promise<void> {
  const { error } = await sb.from("ai_teacher_user_prefs").upsert(
    { user_id: userId, active_key_id: keyId, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw new Error("could not save the active key");
}

/**
 * Classifies a failed Gemini call.
 * 'rate_limited' for HTTP 429 or RESOURCE_EXHAUSTED; 'invalid' for HTTP 401, HTTP 403 (PERMISSION_DENIED),
 * or 400 with API_KEY_INVALID; null for anything else (retry rules stay with the caller).
 */
export function classifyGeminiError(httpStatus: number, bodyText: string): "rate_limited" | "invalid" | null {
  const text = String(bodyText ?? "");
  if (httpStatus === 429 || text.includes("RESOURCE_EXHAUSTED")) return "rate_limited";
  if (httpStatus === 401 || httpStatus === 403 || text.includes("PERMISSION_DENIED")) return "invalid";
  if (httpStatus === 400 && text.includes("API_KEY_INVALID")) return "invalid";
  return null;
}
