// Study "Call reminder" audio generator.
//
// POST { text, voice?, language?, reminderId?, preview?, ttlSec? }
//   -> 200 { audioPath, hash, signedUrl, cached, voice, language, model, engine, format }
//
// The TTS, cache and upload work lives in _shared/reminderAudio.ts (generateForUser), which is also
// used by the scheduled reminder-audio-prefetch function. Hashes and storage paths are unchanged.
//
// Engines (env REMINDER_TTS_ENGINE, default "gemini"):
//   gemini: Gemini TTS (env REMINDER_TTS_MODEL, default gemini-3.8-flash-tts) -> WAV, hash v2.
//   sarvam: Sarvam Bulbul v3 -> MP3, hash v1.
// If Gemini fails (or has no keys) and SARVAM_API_KEY is set, the Sarvam path runs automatically.
//
// Private Storage bucket `reminder-audio`. Signed URL TTL: ttlSec (default 3600, max 86400).
// Deployed with verify_jwt = true (see supabase/config.toml).
// API keys are read from the database or secrets and are never logged or returned.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_PREBUILT_VOICES } from "../_shared/geminiTts.ts";
import {
  ALLOWED_LANGUAGES,
  DEFAULT_LANGUAGE,
  DEFAULT_TTL_SEC,
  DEFAULT_VOICE,
  MAX_TEXT_LEN,
  MAX_TTL_SEC,
  SARVAM_VOICES,
  generateForUser,
} from "../_shared/reminderAudio.ts";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function invalid(field: string, message: string) {
  return json({ error: "invalid_input", field, message }, 400);
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
  if (
    typeof voice !== "string" ||
    !(SARVAM_VOICES.includes(voice) || GEMINI_PREBUILT_VOICES.includes(voice))
  ) {
    return invalid("voice", "voice is not an allowed speaker");
  }

  const language = body.language === undefined ? DEFAULT_LANGUAGE : body.language;
  if (typeof language !== "string" || !ALLOWED_LANGUAGES.includes(language)) {
    return invalid("language", "language is not supported");
  }

  const rawReminderId = body.reminderId;
  if (
    rawReminderId !== undefined && rawReminderId !== null &&
    (typeof rawReminderId !== "string" || !UUID_RE.test(rawReminderId))
  ) {
    return invalid("reminderId", "reminderId must be a uuid");
  }
  const reminderId: string | null = typeof rawReminderId === "string" ? rawReminderId : null;

  if (body.preview !== undefined && typeof body.preview !== "boolean") {
    return invalid("preview", "preview must be a boolean");
  }
  const preview = body.preview === true;

  let ttlSec = DEFAULT_TTL_SEC;
  if (body.ttlSec !== undefined && body.ttlSec !== null) {
    if (typeof body.ttlSec !== "number" || !Number.isFinite(body.ttlSec) || body.ttlSec < 1) {
      return invalid("ttlSec", "ttlSec must be a positive number of seconds");
    }
    ttlSec = Math.min(Math.floor(body.ttlSec), MAX_TTL_SEC);
  }

  // ── 3. Reminder ownership ───────────────────────────────────────────────
  if (reminderId) {
    const { data: row, error: rowErr } = await sb
      .from("reminders")
      .select("id")
      .eq("id", reminderId)
      .eq("user_id", userId)
      .maybeSingle();
    if (rowErr) return json({ error: "internal", fallback: true }, 500);
    if (!row) return json({ error: "reminder_not_found" }, 404);
  }

  // ── 4. Generate (cache, then TTS, then upload) ──────────────────────────
  // A preview never writes to the reminder row, so it is passed without reminderId.
  const result = await generateForUser(
    sb,
    userId,
    text,
    voice,
    language,
    preview ? null : reminderId,
    ttlSec,
  );
  if (!result.ok) {
    return json({ error: result.error, fallback: true, ...result.extra }, result.status);
  }

  return json({
    audioPath: result.audioPath,
    hash: result.hash,
    signedUrl: result.signedUrl,
    cached: result.cached,
    voice: result.voice,
    language: result.language,
    model: result.model,
    engine: result.engine,
    format: result.format,
  });
});
