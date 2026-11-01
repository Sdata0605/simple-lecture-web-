// Study "Call reminder" audio generator.
//
// POST { text, voice?, language?, reminderId?, preview? }
//   -> 200 { audioPath, hash, signedUrl, cached, voice, language, model }
//
// Generates a Sarvam Bulbul v3 mp3 for a reminder message, caches it in the private
// Storage bucket `reminder-audio` under `<user_id>/<hash>.mp3`, and returns a 1-hour
// signed URL. Deployed with verify_jwt = true (see supabase/config.toml).
// The Sarvam key is read from the SARVAM_API_KEY secret and never logged or returned.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MODEL = "bulbul:v3";
const PACE = 0.9;
const SAMPLE_RATE = 24000;
const SARVAM_URL = "https://api.sarvam.ai/text-to-speech";
const SARVAM_TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 1500;
const MAX_TEXT_LEN = 500;
const BUCKET = "reminder-audio";
const SIGNED_URL_TTL_SEC = 3600;
const DEFAULT_VOICE = "shubh";
const DEFAULT_LANGUAGE = "en-IN";

// Bulbul v3 speakers (lowercase, as the API expects).
const ALLOWED_VOICES = [
  "shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan", "simran",
  "kavya", "amit", "dev", "ishita", "shreya", "ratan", "varun", "manan", "sumit",
  "roopa", "kabir", "aayan", "ashutosh", "advait", "anand", "tanya", "tarun", "sunny",
  "mani", "gokul", "vijay", "shruti", "suhani", "mohit", "kavitha", "rehan", "soham",
  "rupali",
];

// Launch languages only (English, Hindi, Marathi, Kannada).
const ALLOWED_LANGUAGES = ["en-IN", "hi-IN", "mr-IN", "kn-IN"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function invalid(field: string, message: string) {
  return json({ error: "invalid_input", field, message }, 400);
}

function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return json({ error, fallback: true, ...extra }, status);
}

async function logUsage(userId: string, chars: number, cached: boolean, success: boolean) {
  try {
    await sb.from("reminder_tts_usage").insert({ user_id: userId, chars, cached, model: MODEL, success });
  } catch (e) {
    console.error("usage log failed", (e as Error).message);
  }
}

async function markReminder(
  reminderId: string,
  userId: string,
  update: Record<string, unknown>,
) {
  try {
    await sb.from("reminders").update(update).eq("id", reminderId).eq("user_id", userId);
  } catch (e) {
    console.error("reminder update failed", (e as Error).message);
  }
}

// Calls Sarvam once. Returns the response, or null on network/timeout error.
async function callSarvamOnce(apiKey: string, body: string): Promise<Response | null> {
  try {
    return await fetch(SARVAM_URL, {
      method: "POST",
      headers: { "api-subscription-key": apiKey, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(SARVAM_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // ── 1. Auth ─────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);

  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  // ── 2. Validate input ───────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return invalid("body", "Request body must be JSON");
  }
  if (!body || typeof body !== "object") return invalid("body", "Request body must be an object");

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 1 || text.length > MAX_TEXT_LEN) {
    return invalid("text", `text must be 1-${MAX_TEXT_LEN} characters`);
  }

  const voice = body.voice === undefined ? DEFAULT_VOICE : body.voice;
  if (typeof voice !== "string" || !ALLOWED_VOICES.includes(voice)) {
    return invalid("voice", "voice is not an allowed Bulbul v3 speaker");
  }

  const language = body.language === undefined ? DEFAULT_LANGUAGE : body.language;
  if (typeof language !== "string" || !ALLOWED_LANGUAGES.includes(language)) {
    return invalid("language", "language is not supported");
  }

  const reminderId = body.reminderId === undefined || body.reminderId === null ? null : body.reminderId;
  if (reminderId !== null && (typeof reminderId !== "string" || !UUID_RE.test(reminderId))) {
    return invalid("reminderId", "reminderId must be a uuid");
  }

  if (body.preview !== undefined && typeof body.preview !== "boolean") {
    return invalid("preview", "preview must be a boolean");
  }
  const preview = body.preview === true;

  // ── 3. Reminder ownership ───────────────────────────────────────────────
  if (reminderId) {
    const { data: row, error: rowErr } = await sb
      .from("reminders")
      .select("id")
      .eq("id", reminderId)
      .eq("user_id", userId)
      .maybeSingle();
    if (rowErr) return fail(500, "internal");
    if (!row) return json({ error: "reminder_not_found" }, 404);
  }

  // ── 4. Hash and cache lookup ────────────────────────────────────────────
  const normalised = text.replace(/\s+/g, " ");
  const hash = await sha256Hex(`v1|${MODEL}|${voice}|${language}|${PACE}|${normalised}`);
  const fileName = `${hash}.mp3`;
  const audioPath = `${userId}/${fileName}`;
  const hashPrefix = hash.slice(0, 12);

  const { data: existing, error: listErr } = await sb.storage
    .from(BUCKET)
    .list(userId, { search: fileName, limit: 5 });
  if (listErr) console.error("cache list failed", listErr.message);

  const isCached = !listErr && (existing ?? []).some((f) => f.name === fileName);

  if (isCached) {
    const { data: signed, error: signErr } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(audioPath, SIGNED_URL_TTL_SEC);
    if (signErr || !signed?.signedUrl) return fail(500, "storage_failed");

    if (reminderId && !preview) {
      await markReminder(reminderId, userId, {
        audio_path: audioPath,
        audio_hash: hash,
        audio_status: "ready",
      });
    }
    await logUsage(userId, 0, true, true);
    console.log(JSON.stringify({ fn: "reminder-call-audio", user: userId, hash: hashPrefix, chars: 0, cached: true }));

    return json({
      audioPath,
      hash,
      signedUrl: signed.signedUrl,
      cached: true,
      voice,
      language,
      model: MODEL,
    });
  }

  // ── 5. Daily quota (non-cached generations only) ────────────────────────
  const dailyLimit = Math.max(1, parseInt(Deno.env.get("REMINDER_TTS_DAILY_LIMIT") ?? "20", 10) || 20);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: usedCount, error: quotaErr } = await sb
    .from("reminder_tts_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("cached", false)
    .eq("success", true)
    .gte("created_at", since);
  if (quotaErr) return fail(500, "internal");
  if ((usedCount ?? 0) >= dailyLimit) {
    return json({ error: "daily_limit", fallback: true }, 429);
  }

  // ── 6. Kill switch and secret ───────────────────────────────────────────
  if (Deno.env.get("CALL_REMINDERS_ENABLED") === "false") {
    return fail(503, "disabled");
  }
  const apiKey = Deno.env.get("SARVAM_API_KEY") ?? "";
  if (!apiKey) return fail(503, "not_configured");

  // ── 7. Sarvam call (one retry on 429 / 5xx / timeout) ───────────────────
  const sarvamBody = JSON.stringify({
    text: normalised,
    language_code: language,
    speaker: voice,
    model: MODEL,
    pace: PACE,
    speech_sample_rate: SAMPLE_RATE,
    output_audio_codec: "mp3",
  });

  const started = Date.now();
  let sarvamRes: Response | null = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    attempts = attempt;
    sarvamRes = await callSarvamOnce(apiKey, sarvamBody);
    const retryable = sarvamRes === null || sarvamRes.status === 429 || sarvamRes.status >= 500;
    if (!retryable || attempt === 2) break;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }

  const sarvamStatus = sarvamRes?.status ?? 0;
  const latencyMs = Date.now() - started;

  let sarvamPayload: any = null;
  let sarvamCode: string | undefined;
  if (sarvamRes) {
    try {
      sarvamPayload = await sarvamRes.json();
    } catch {
      sarvamPayload = null;
    }
  }

  const base64Audio: string | undefined =
    sarvamRes && sarvamRes.ok && Array.isArray(sarvamPayload?.audios) ? sarvamPayload.audios[0] : undefined;

  if (!base64Audio) {
    sarvamCode = typeof sarvamPayload?.error?.code === "string" ? sarvamPayload.error.code : undefined;
    console.log(JSON.stringify({
      fn: "reminder-call-audio", user: userId, hash: hashPrefix, chars: normalised.length,
      cached: false, sarvamStatus, attempts, latencyMs, ok: false,
    }));
    await logUsage(userId, normalised.length, false, false);
    if (reminderId && !preview) await markReminder(reminderId, userId, { audio_status: "failed" });
    return fail(502, "tts_failed", {
      sarvamStatus,
      ...(sarvamCode ? { sarvamCode } : {}),
    });
  }

  // ── 8. Decode and upload ────────────────────────────────────────────────
  let bytes: Uint8Array;
  try {
    const bin = atob(base64Audio);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    bytes = new Uint8Array(0);
  }
  if (bytes.length === 0) {
    await logUsage(userId, normalised.length, false, false);
    if (reminderId && !preview) await markReminder(reminderId, userId, { audio_status: "failed" });
    return fail(502, "tts_failed", { sarvamStatus });
  }

  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(audioPath, bytes, { contentType: "audio/mpeg", upsert: true });
  if (uploadErr) {
    console.error("upload failed", uploadErr.message);
    await logUsage(userId, normalised.length, false, false);
    if (reminderId && !preview) await markReminder(reminderId, userId, { audio_status: "failed" });
    return fail(500, "storage_failed");
  }

  // ── 9. Usage, reminder row, signed URL ──────────────────────────────────
  await logUsage(userId, normalised.length, false, true);
  console.log(JSON.stringify({
    fn: "reminder-call-audio", user: userId, hash: hashPrefix, chars: normalised.length,
    cached: false, sarvamStatus, attempts, latencyMs, ok: true,
  }));

  if (reminderId && !preview) {
    await markReminder(reminderId, userId, {
      audio_path: audioPath,
      audio_hash: hash,
      audio_status: "ready",
    });
  }

  const { data: signed, error: signErr } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(audioPath, SIGNED_URL_TTL_SEC);
  if (signErr || !signed?.signedUrl) return fail(500, "storage_failed");

  return json({
    audioPath,
    hash,
    signedUrl: signed.signedUrl,
    cached: false,
    voice,
    language,
    model: MODEL,
  });
});
