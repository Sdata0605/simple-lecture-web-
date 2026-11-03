// AI Teacher: each signed-in student keeps their own Gemini API keys here (up to 10).
//
// POST /functions/v1/ai-teacher-keys   Authorization: Bearer <user access token>
// body: { action, ... }
//   get                    -> Settings
//   savePrefs  { prefs }   -> Settings
//   addKey     { label, apiKey }       (tests the key with Google first)
//   updateKey  { id, label?, apiKey? } (a new apiKey is tested first)
//   deleteKey  { id }
//   reorder    { ids }     every saved key id, in the new order
//   setActive  { id }
//   testKey    { id }      re-tests a saved key and stores its status
//   reportFailure { id, error }  the app saw a Gemini error for this key; classify, mark, fail over
//
// Settings: { prefs:{teacherName,preset,custom,voice,language},
//             keys:[{id,label,masked,position,status,lastError,lastErrorAt,lastUsedAt}],
//             activeKeyId, maxKeys: 10, plan:{active: boolean, planName: 'plus' | null} }
// Plus plan (Rs 500, or Pro Rs 1000) is required to add, update, test, or activate keys: otherwise
// those actions return 402 PLAN_REQUIRED. get, deleteKey, savePrefs, reorder, reportFailure stay open.
// Errors: { error, code }. Codes: UNAUTHORIZED 401, BAD_REQUEST 400, INVALID_KEY 400, KEY_LIMIT 400,
//         DUPLICATE_KEY 409, NOT_FOUND 404, PLAN_REQUIRED 402, INTERNAL 500.
// Keys are encrypted at rest (_shared/studentKeys.ts). A full key is never returned or logged;
// the masked form is 'AIza…' + the last 4 characters.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyGeminiError,
  decryptKey,
  encryptKey,
  isUsableKey,
  markKey,
  maskKey,
  setActiveKey,
  sha256Hex,
} from "../_shared/studentKeys.ts";
import { hasPlusPlan } from "../_shared/plusPlan.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const MAX_KEYS = 10;
const TEST_TIMEOUT_MS = 10_000;
const DEFAULT_TEACHER_NAME = "AI Teacher";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Must match the lists in ai-teacher/index.ts (PRESETS, LANGUAGES, VOICES).
const PRESETS = ["friendly", "strict", "fun", "calm", "storyteller", "coach"];
const LANGUAGES = ["auto", "en", "hi", "kn", "mr"];
const VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];

const KEY_COLUMNS = "id, label, key_last4, position, status, last_error, last_error_at, last_used_at";
const PREF_COLUMNS = "teacher_name, preset, custom, voice, language, active_key_id";

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
const fail = (status: number, code: string, message: string) => new ApiError(status, code, message);

function dbCheck(error: any) {
  if (error) throw new Error(`db: ${error.message}`);
}
const isUniqueViolation = (error: any) => error?.code === "23505";

async function requireUser(req: Request): Promise<string> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw fail(401, "UNAUTHORIZED", "Sign in to manage your AI Teacher keys.");
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw fail(401, "UNAUTHORIZED", "Sign in to manage your AI Teacher keys.");
  return data.user.id;
}

async function readBody(req: Request): Promise<Record<string, any>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw fail(400, "BAD_REQUEST", "Request body must be JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw fail(400, "BAD_REQUEST", "Request body must be an object.");
  }
  return body as Record<string, any>;
}

function cleanText(v: unknown, max: number): string {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanApiKey(v: unknown): string {
  const k = typeof v === "string" ? v.trim() : "";
  if (!/^[\x21-\x7e]{20,200}$/.test(k)) throw fail(400, "BAD_REQUEST", "Paste the full Gemini API key.");
  return k;
}

function requireId(v: unknown): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw fail(400, "BAD_REQUEST", "A valid key id is required.");
  return v;
}

// ---------------------------------------------------------------- settings
const toPublicKey = (r: any) => ({
  id: r.id,
  label: r.label ?? "",
  masked: maskKey(r.key_last4),
  position: r.position,
  status: r.status,
  lastError: r.last_error ?? null,
  lastErrorAt: r.last_error_at ?? null,
  lastUsedAt: r.last_used_at ?? null,
});

/** Throws 402 PLAN_REQUIRED unless the user has the Plus plan (or Pro, which counts as Plus). */
async function requirePlus(userId: string): Promise<void> {
  if (!(await hasPlusPlan(sb, userId))) {
    throw fail(402, "PLAN_REQUIRED", "Buy the Plus plan (Rs 500) to add your keys.");
  }
}

async function settingsFor(userId: string) {
  const [keysRes, prefRes, plus] = await Promise.all([
    sb.from("ai_teacher_user_keys").select(KEY_COLUMNS).eq("user_id", userId).order("position", { ascending: true }),
    sb.from("ai_teacher_user_prefs").select(PREF_COLUMNS).eq("user_id", userId).maybeSingle(),
    hasPlusPlan(sb, userId),
  ]);
  dbCheck(keysRes.error);
  dbCheck(prefRes.error);
  const p: any = prefRes.data ?? {};
  return {
    plan: { active: plus, planName: plus ? "plus" : null },
    prefs: {
      teacherName: p.teacher_name || DEFAULT_TEACHER_NAME,
      preset: p.preset || "friendly",
      custom: p.custom ?? "",
      voice: p.voice ?? "Kore",
      language: p.language || "auto",
    },
    keys: (keysRes.data ?? []).map(toPublicKey),
    activeKeyId: p.active_key_id ?? null,
    maxKeys: MAX_KEYS,
  };
}

// ---------------------------------------------------------------- row helpers
async function keyRows(userId: string): Promise<any[]> {
  const { data, error } = await sb.from("ai_teacher_user_keys")
    .select("id, key_hash, position, status, last_error_at")
    .eq("user_id", userId)
    .order("position", { ascending: true });
  dbCheck(error);
  return data ?? [];
}

async function ownKey(userId: string, id: string): Promise<any> {
  const { data, error } = await sb.from("ai_teacher_user_keys").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  dbCheck(error);
  if (!data) throw fail(404, "NOT_FOUND", "That key was not found.");
  return data;
}

async function activeKeyIdOf(userId: string): Promise<string | null> {
  const { data, error } = await sb.from("ai_teacher_user_prefs").select("active_key_id").eq("user_id", userId).maybeSingle();
  dbCheck(error);
  return data?.active_key_id ?? null;
}

async function nextUsableKeyId(userId: string, excludeId: string): Promise<string | null> {
  const now = Date.now();
  const row = (await keyRows(userId)).find((r) => r.id !== excludeId && isUsableKey(r.status, r.last_error_at, now));
  return row?.id ?? null;
}

// ---------------------------------------------------------------- Google check
type TestOutcome = { status: "active" | "rate_limited" | "invalid" | "untested"; error: string | null };

/** Lists models with the key. The response body is never read or logged. */
async function testApiKey(apiKey: string): Promise<TestOutcome> {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(TEST_TIMEOUT_MS) },
    );
    if (r.ok) return { status: "active", error: null };
    await r.body?.cancel();
    if (r.status === 429) {
      return { status: "rate_limited", error: "Google is rate-limiting this key right now. It will be retried later." };
    }
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      return { status: "invalid", error: `Google rejected this key (HTTP ${r.status}).` };
    }
    return { status: "untested", error: `Google did not confirm this key (HTTP ${r.status}).` };
  } catch {
    return { status: "untested", error: "Could not reach Google to check this key." };
  }
}

// ---------------------------------------------------------------- actions
async function savePrefs(userId: string, body: any) {
  const p = body.prefs;
  if (!p || typeof p !== "object") throw fail(400, "BAD_REQUEST", "prefs is required.");
  if (!PRESETS.includes(p.preset)) throw fail(400, "BAD_REQUEST", "Unknown teaching style.");
  if (!LANGUAGES.includes(p.language)) throw fail(400, "BAD_REQUEST", "Unknown language.");
  if (p.voice !== undefined && p.voice !== null && !VOICES.includes(p.voice)) throw fail(400, "BAD_REQUEST", "Unknown voice.");
  const teacherName = cleanText(p.teacherName, 30).replace(/[^\p{L}\p{N} .'-]/gu, "").trim() || DEFAULT_TEACHER_NAME;
  const { error } = await sb.from("ai_teacher_user_prefs").upsert(
    {
      user_id: userId,
      teacher_name: teacherName,
      preset: p.preset,
      custom: cleanText(p.custom, 300),
      voice: p.voice ?? null,
      language: p.language,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  dbCheck(error);
}

async function addKey(userId: string, body: any) {
  await requirePlus(userId);
  const apiKey = cleanApiKey(body.apiKey);
  const rows = await keyRows(userId);
  if (rows.length >= MAX_KEYS) throw fail(400, "KEY_LIMIT", `You can save up to ${MAX_KEYS} keys. Delete one to add another.`);
  const hash = await sha256Hex(apiKey);
  if (rows.some((r) => r.key_hash === hash)) throw fail(409, "DUPLICATE_KEY", "This key is already saved.");

  const test = await testApiKey(apiKey);
  if (test.status === "invalid") throw fail(400, "INVALID_KEY", "Google rejected this key. Copy it again from Google AI Studio.");

  const { cipher, iv } = await encryptKey(apiKey);
  const now = new Date().toISOString();
  const { data, error } = await sb.from("ai_teacher_user_keys").insert({
    user_id: userId,
    label: cleanText(body.label, 40) || `Key ${rows.length + 1}`,
    key_ciphertext: cipher,
    key_iv: iv,
    key_last4: apiKey.slice(-4),
    key_hash: hash,
    position: rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0,
    status: test.status,
    last_error: test.error,
    last_error_at: test.status === "rate_limited" ? now : null,
    created_at: now,
    updated_at: now,
  }).select("id").single();
  if (isUniqueViolation(error)) throw fail(409, "DUPLICATE_KEY", "This key is already saved.");
  dbCheck(error);

  // The first key (or any key when none is active) becomes the active one.
  if (!(await activeKeyIdOf(userId))) await setActiveKey(sb, userId, data.id);
}

async function updateKey(userId: string, body: any) {
  const id = requireId(body.id);
  await ownKey(userId, id);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };

  if (body.label !== undefined) {
    const label = cleanText(body.label, 40);
    if (label) patch.label = label;
  }

  if (body.apiKey !== undefined && body.apiKey !== null && body.apiKey !== "") {
    await requirePlus(userId);
    const apiKey = cleanApiKey(body.apiKey);
    const hash = await sha256Hex(apiKey);
    const { data: dup, error: dErr } = await sb.from("ai_teacher_user_keys")
      .select("id").eq("user_id", userId).eq("key_hash", hash).neq("id", id).maybeSingle();
    dbCheck(dErr);
    if (dup) throw fail(409, "DUPLICATE_KEY", "This key is already saved.");

    const test = await testApiKey(apiKey);
    if (test.status === "invalid") throw fail(400, "INVALID_KEY", "Google rejected this key. Copy it again from Google AI Studio.");

    const { cipher, iv } = await encryptKey(apiKey);
    Object.assign(patch, {
      key_ciphertext: cipher,
      key_iv: iv,
      key_last4: apiKey.slice(-4),
      key_hash: hash,
      status: test.status,
      last_error: test.error,
      last_error_at: test.status === "rate_limited" ? now : null,
    });
  }

  const { error } = await sb.from("ai_teacher_user_keys").update(patch).eq("id", id).eq("user_id", userId);
  if (isUniqueViolation(error)) throw fail(409, "DUPLICATE_KEY", "This key is already saved.");
  dbCheck(error);
}

async function deleteKey(userId: string, body: any) {
  const id = requireId(body.id);
  await ownKey(userId, id);
  const { error } = await sb.from("ai_teacher_user_keys").delete().eq("id", id).eq("user_id", userId);
  dbCheck(error);
  if ((await activeKeyIdOf(userId)) === id) {
    await setActiveKey(sb, userId, await nextUsableKeyId(userId, id));
  }
}

async function reorder(userId: string, body: any) {
  if (!Array.isArray(body.ids)) throw fail(400, "BAD_REQUEST", "ids must be a list.");
  const ids: string[] = body.ids.map((v: unknown) => requireId(v));
  const rows = await keyRows(userId);
  const have = new Set(rows.map((r) => r.id));
  if (ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some((id) => !have.has(id))) {
    throw fail(400, "BAD_REQUEST", "ids must list every saved key exactly once.");
  }
  const results = await Promise.all(
    ids.map((id, position) => sb.from("ai_teacher_user_keys").update({ position }).eq("id", id).eq("user_id", userId)),
  );
  for (const r of results) dbCheck(r.error);
}

async function setActive(userId: string, body: any) {
  await requirePlus(userId);
  const id = requireId(body.id);
  await ownKey(userId, id);
  await setActiveKey(sb, userId, id);
}

async function testKey(userId: string, body: any) {
  await requirePlus(userId);
  const id = requireId(body.id);
  const row = await ownKey(userId, id);
  const apiKey = await decryptKey(row.key_ciphertext, row.key_iv);
  const test = await testApiKey(apiKey);
  await markKey(sb, id, test.status, test.error);
}

async function reportFailure(userId: string, body: any) {
  const id = requireId(body.id);
  await ownKey(userId, id);
  const message = cleanText(body.error, 300);
  const m = message.match(/\b(400|401|403|429)\b/);
  const kind = classifyGeminiError(m ? Number(m[1]) : 0, message);
  if (!kind) return; // not a key problem (model, network, server): nothing to change
  await markKey(sb, id, kind, message || `Google reported a ${kind} error.`);
  if ((await activeKeyIdOf(userId)) === id) {
    await setActiveKey(sb, userId, await nextUsableKeyId(userId, id));
  }
}

// ---------------------------------------------------------------- entry
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only.", code: "BAD_REQUEST" }, 405);
  try {
    const userId = await requireUser(req);
    const body = await readBody(req);
    switch (String(body.action ?? "")) {
      case "get": break;
      case "savePrefs": await savePrefs(userId, body); break;
      case "addKey": await addKey(userId, body); break;
      case "updateKey": await updateKey(userId, body); break;
      case "deleteKey": await deleteKey(userId, body); break;
      case "reorder": await reorder(userId, body); break;
      case "setActive": await setActive(userId, body); break;
      case "testKey": await testKey(userId, body); break;
      case "reportFailure": await reportFailure(userId, body); break;
      default: throw fail(400, "BAD_REQUEST", "Unknown action.");
    }
    return json(await settingsFor(userId));
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message, code: e.code }, e.status);
    console.error("[ai-teacher-keys] unhandled", String((e as any)?.message ?? e).slice(0, 200));
    return json({ error: "Something went wrong. Please try again.", code: "INTERNAL" }, 500);
  }
});
