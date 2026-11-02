// Study "Call reminder" audio generator.
//
// POST { text, voice?, language?, reminderId?, preview? }
//   -> 200 { audioPath, hash, signedUrl, cached, voice, language, model, engine, format }
//
// Engines (env REMINDER_TTS_ENGINE, default "gemini"):
//   gemini: Gemini TTS (env REMINDER_TTS_MODEL, default gemini-3.8-flash-tts) -> WAV,
//           stored as <user_id>/<hash>.wav, hash v2. Keys: _shared/geminiKeys.ts.
//   sarvam: Sarvam Bulbul v3 -> MP3, stored as <user_id>/<hash>.mp3, hash v1.
// If Gemini fails (or has no keys) and SARVAM_API_KEY is set, the Sarvam path runs automatically.
//
// Private Storage bucket `reminder-audio`, 1-hour signed URL.
// Deployed with verify_jwt = true (see supabase/config.toml).
// API keys are read from the database or secrets and are never logged or returned.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadGeminiKeys } from "../_shared/geminiKeys.ts";
import {
  GEMINI_PREBUILT_VOICES,
  STYLE_VERSION,
  base64ToBytes,
  resolveGeminiVoice,
  styleFor,
  synthesize,
} from "../_shared/geminiTts.ts";

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

const SARVAM_MODEL = "bulbul:v3";
const SARVAM_PACE = 0.9;
const SARVAM_SAMPLE_RATE = 24000;
const SARVAM_URL = "https://api.sarvam.ai/text-to-speech";
const SARVAM_TIMEOUT_MS = 12000; // Sarvam as the primary engine (2 attempts)
const SARVAM_FALLBACK_TIMEOUT_MS = 8000; // Sarvam after a Gemini failure (1 attempt)
const RETRY_DELAY_MS = 1500;
const GEMINI_TIMEOUT_MS = 10000;
const GEMINI_ATTEMPTS = 2;
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash-tts";
const MAX_TEXT_LEN = 500;
const BUCKET = "reminder-audio";
const SIGNED_URL_TTL_SEC = 3600;
const DEFAULT_VOICE = "shubh";
const DEFAULT_LANGUAGE = "en-IN";

// Bulbul v3 speakers (lowercase, as the API expects).
const SARVAM_VOICES = [
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

type Engine = "gemini" | "sarvam";

interface Generated {
  engine: Engine;
  model: string;
  format: "wav" | "mp3";
  mime: string;
  hash: string;
  bytes: Uint8Array;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sarvamSpeakerFor(voice: string): string {
  return SARVAM_VOICES.includes(voice) ? voice : DEFAULT_VOICE;
}

function invalid(field: string, message: string) {
  return json({ error: "invalid_input", field, message }, 400);
}

function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return json({ error, fallback: true, ...extra }, status);
}

async function logUsage(userId: string, chars: number, cached: boolean, success: boolean, model: string) {
  try {
    await sb.from("reminder_tts_usage").insert({ user_id: userId, chars, cached, model, success });
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
async function callSarvamOnce(apiKey: string, body: string, timeoutMs: number): Promise<Response | null> {
  try {
    return await fetch(SARVAM_URL, {
      method: "POST",
      headers: { "api-subscription-key": apiKey, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
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

  // ── 4. Engine, hashes and cache lookup ──────────────────────────────────
  const normalised = text.replace(/\s+/g, " ");
  const engineSetting: Engine = Deno.env.get("REMINDER_TTS_ENGINE") === "sarvam" ? "sarvam" : "gemini";
  const geminiModel = (Deno.env.get("REMINDER_TTS_MODEL") ?? "").trim() || DEFAULT_GEMINI_MODEL;
  const geminiVoice = resolveGeminiVoice(voice);
  const sarvamSpeaker = sarvamSpeakerFor(voice);

  const geminiHash = await sha256Hex(`v2|gemini|${geminiModel}|${geminiVoice}|${language}|${STYLE_VERSION}|${normalised}`);
  const sarvamHash = await sha256Hex(`v1|${SARVAM_MODEL}|${sarvamSpeaker}|${language}|${SARVAM_PACE}|${normalised}`);

  // The primary engine decides which cached file is valid to return.
  const primary = engineSetting === "gemini"
    ? { engine: "gemini" as Engine, hash: geminiHash, ext: "wav", model: geminiModel }
    : { engine: "sarvam" as Engine, hash: sarvamHash, ext: "mp3", model: SARVAM_MODEL };
  const fileName = `${primary.hash}.${primary.ext}`;
  const hashPrefix = primary.hash.slice(0, 12);

  const { data: existing, error: listErr } = await sb.storage
    .from(BUCKET)
    .list(userId, { search: fileName, limit: 5 });
  if (listErr) console.error("cache list failed", listErr.message);

  const isCached = !listErr && (existing ?? []).some((f) => f.name === fileName);

  if (isCached) {
    const audioPath = `${userId}/${fileName}`;
    const { data: signed, error: signErr } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(audioPath, SIGNED_URL_TTL_SEC);
    if (signErr || !signed?.signedUrl) return fail(500, "storage_failed");

    if (reminderId && !preview) {
      await markReminder(reminderId, userId, {
        audio_path: audioPath,
        audio_hash: primary.hash,
        audio_status: "ready",
      });
    }
    await logUsage(userId, 0, true, true, primary.model);
    console.log(JSON.stringify({ fn: "reminder-call-audio", user: userId, hash: hashPrefix, engine: primary.engine, chars: 0, cached: true }));

    return json({
      audioPath,
      hash: primary.hash,
      signedUrl: signed.signedUrl,
      cached: true,
      voice,
      language,
      model: primary.model,
      engine: primary.engine,
      format: primary.ext,
    });
  }

  // ── 5. No daily cap: every student can generate as many reminder voices as needed ──

  // ── 6. Kill switch and keys ─────────────────────────────────────────────
  if (Deno.env.get("CALL_REMINDERS_ENABLED") === "false") {
    return fail(503, "disabled");
  }
  const sarvamKey = Deno.env.get("SARVAM_API_KEY") ?? "";
  const geminiKeys = engineSetting === "gemini" ? await loadGeminiKeys(sb) : [];
  if (geminiKeys.length === 0 && !sarvamKey) return fail(503, "not_configured");

  // ── 7. Generate: Gemini first, Sarvam as automatic fallback ─────────────
  const started = Date.now();
  let generated: Generated | null = null;
  let geminiStatus: number | undefined;
  let sarvamStatus: number | undefined;
  let sarvamCode: string | undefined;

  if (geminiKeys.length > 0) {
    const g = await synthesize({
      keys: geminiKeys,
      model: geminiModel,
      voice: geminiVoice,
      style: styleFor(language),
      text: normalised,
      timeoutMs: GEMINI_TIMEOUT_MS,
      attempts: GEMINI_ATTEMPTS,
    });
    geminiStatus = g.status;
    if (g.ok) {
      generated = { engine: "gemini", model: geminiModel, format: "wav", mime: "audio/wav", hash: geminiHash, bytes: g.wav };
    } else {
      console.log(JSON.stringify({ fn: "reminder-call-audio", user: userId, hash: hashPrefix, engine: "gemini", geminiStatus, attempts: g.attempts, ok: false }));
    }
  }

  if (!generated && sarvamKey) {
    const sarvamPrimary = engineSetting === "sarvam";
    const sarvamAttempts = sarvamPrimary ? 2 : 1;
    const sarvamTimeout = sarvamPrimary ? SARVAM_TIMEOUT_MS : SARVAM_FALLBACK_TIMEOUT_MS;
    const sarvamBody = JSON.stringify({
      text: normalised,
      language_code: language,
      speaker: sarvamSpeaker,
      model: SARVAM_MODEL,
      pace: SARVAM_PACE,
      speech_sample_rate: SARVAM_SAMPLE_RATE,
      output_audio_codec: "mp3",
    });

    let sarvamRes: Response | null = null;
    for (let attempt = 1; attempt <= sarvamAttempts; attempt++) {
      sarvamRes = await callSarvamOnce(sarvamKey, sarvamBody, sarvamTimeout);
      const retryable = sarvamRes === null || sarvamRes.status === 429 || sarvamRes.status >= 500;
      if (!retryable || attempt === sarvamAttempts) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    sarvamStatus = sarvamRes?.status ?? 0;

    let sarvamPayload: any = null;
    if (sarvamRes) {
      try {
        sarvamPayload = await sarvamRes.json();
      } catch {
        sarvamPayload = null;
      }
    }
    const base64Audio: unknown =
      sarvamRes && sarvamRes.ok && Array.isArray(sarvamPayload?.audios) ? sarvamPayload.audios[0] : undefined;
    if (typeof base64Audio === "string" && base64Audio.length > 0) {
      const bytes = base64ToBytes(base64Audio);
      if (bytes.length > 0) {
        generated = { engine: "sarvam", model: SARVAM_MODEL, format: "mp3", mime: "audio/mpeg", hash: sarvamHash, bytes };
      }
    }
    if (!generated) {
      sarvamCode = typeof sarvamPayload?.error?.code === "string" ? sarvamPayload.error.code : undefined;
    }
  }

  const latencyMs = Date.now() - started;

  if (!generated) {
    console.log(JSON.stringify({
      fn: "reminder-call-audio", user: userId, hash: hashPrefix, chars: normalised.length,
      engine: primary.engine, cached: false, geminiStatus, sarvamStatus, latencyMs, ok: false,
    }));
    await logUsage(userId, normalised.length, false, false, primary.model);
    if (reminderId && !preview) await markReminder(reminderId, userId, { audio_status: "failed" });
    return fail(502, "tts_failed", {
      ...(geminiStatus !== undefined ? { geminiStatus } : {}),
      ...(sarvamStatus !== undefined ? { sarvamStatus } : {}),
      ...(sarvamCode ? { sarvamCode } : {}),
    });
  }

  // ── 8. Upload ───────────────────────────────────────────────────────────
  const audioPath = `${userId}/${generated.hash}.${generated.format}`;
  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(audioPath, generated.bytes, { contentType: generated.mime, upsert: true });
  if (uploadErr) {
    console.error("upload failed", uploadErr.message);
    await logUsage(userId, normalised.length, false, false, generated.model);
    if (reminderId && !preview) await markReminder(reminderId, userId, { audio_status: "failed" });
    return fail(500, "storage_failed");
  }

  // ── 9. Usage, reminder row, signed URL ──────────────────────────────────
  await logUsage(userId, normalised.length, false, true, generated.model);
  console.log(JSON.stringify({
    fn: "reminder-call-audio", user: userId, hash: generated.hash.slice(0, 12), chars: normalised.length,
    engine: generated.engine, cached: false, geminiStatus, sarvamStatus, latencyMs, ok: true,
  }));

  if (reminderId && !preview) {
    await markReminder(reminderId, userId, {
      audio_path: audioPath,
      audio_hash: generated.hash,
      audio_status: "ready",
    });
  }

  const { data: signed, error: signErr } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(audioPath, SIGNED_URL_TTL_SEC);
  if (signErr || !signed?.signedUrl) return fail(500, "storage_failed");

  return json({
    audioPath,
    hash: generated.hash,
    signedUrl: signed.signedUrl,
    cached: false,
    voice,
    language,
    model: generated.model,
    engine: generated.engine,
    format: generated.format,
  });
});
