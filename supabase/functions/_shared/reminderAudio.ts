// Call-reminder audio: one shared TTS + cache path for every caller.
//
// Used by reminder-call-audio (user JWT, app) and reminder-audio-prefetch (service role, cron and plan mode).
//
// Files are stored per owner: reminder-audio/<user_id>/<hash>.<ext>. Nothing is shared between users.
//   gemini: Gemini TTS -> WAV, hash v2 (Keys: _shared/geminiKeys.ts).
//   sarvam: Sarvam Bulbul v3 -> MP3, hash v1. Used as primary when REMINDER_TTS_ENGINE=sarvam,
//           or as automatic fallback when Gemini fails (or has no keys).
// Hashes and cache lookups are identical for every caller, so a file made by one is a hit for the others.
//
// Never log or return API keys, tokens, or reminder text.

// deno-lint-ignore-file no-explicit-any
import { loadGeminiKeys } from "./geminiKeys.ts";
import {
  STYLE_VERSION,
  base64ToBytes,
  resolveGeminiVoice,
  styleFor,
  synthesize,
} from "./geminiTts.ts";

export const BUCKET = "reminder-audio";
export const MAX_TEXT_LEN = 500;
export const DEFAULT_TTL_SEC = 3600;
export const MAX_TTL_SEC = 86400;
export const DEFAULT_VOICE = "shubh";
export const DEFAULT_LANGUAGE = "en-IN";

// Bulbul v3 speakers (lowercase, as the API expects).
export const SARVAM_VOICES = [
  "shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan", "simran",
  "kavya", "amit", "dev", "ishita", "shreya", "ratan", "varun", "manan", "sumit",
  "roopa", "kabir", "aayan", "ashutosh", "advait", "anand", "tanya", "tarun", "sunny",
  "mani", "gokul", "vijay", "shruti", "suhani", "mohit", "kavitha", "rehan", "soham",
  "rupali",
];

// Launch languages only (English, Hindi, Marathi, Kannada).
export const ALLOWED_LANGUAGES = ["en-IN", "hi-IN", "mr-IN", "kn-IN"];

const GEMINI_TIMEOUT_MS = 10000;
const GEMINI_ATTEMPTS = 2;
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash-tts";
const SARVAM_MODEL = "bulbul:v3";
const SARVAM_PACE = 0.9;
const SARVAM_SAMPLE_RATE = 24000;
const SARVAM_URL = "https://api.sarvam.ai/text-to-speech";
const SARVAM_TIMEOUT_MS = 12000; // Sarvam as the primary engine (2 attempts)
const SARVAM_FALLBACK_TIMEOUT_MS = 8000; // Sarvam after a Gemini failure (1 attempt)
const RETRY_DELAY_MS = 1500;

type Engine = "gemini" | "sarvam";

interface Generated {
  engine: Engine;
  model: string;
  format: "wav" | "mp3";
  mime: string;
  hash: string;
  bytes: Uint8Array;
}

export interface ReminderAudioOk {
  ok: true;
  audioPath: string;
  hash: string;
  signedUrl: string;
  cached: boolean;
  voice: string;
  language: string;
  model: string;
  engine: Engine;
  format: "wav" | "mp3";
}

export interface ReminderAudioErr {
  ok: false;
  status: number;
  error: string;
  extra: Record<string, unknown>;
}

export type ReminderAudioResult = ReminderAudioOk | ReminderAudioErr;

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sarvamSpeakerFor(voice: string): string {
  return SARVAM_VOICES.includes(voice) ? voice : DEFAULT_VOICE;
}

async function logUsage(sb: any, userId: string, chars: number, cached: boolean, success: boolean, model: string) {
  try {
    await sb.from("reminder_tts_usage").insert({ user_id: userId, chars, cached, model, success });
  } catch (e) {
    console.error("usage log failed", (e as Error).message);
  }
}

async function markReminder(sb: any, reminderId: string, userId: string, update: Record<string, unknown>) {
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

/**
 * Returns audio for one call reminder text, for one user.
 * Cache first (same hash as always), then TTS (Gemini, Sarvam fallback), then upload and a signed URL.
 * If reminderId is given, the caller must already have checked that the reminder belongs to userId;
 * the row is then updated (audio_path, audio_hash, audio_status).
 * Never throws for expected failures: returns { ok: false, status, error, extra }.
 */
export async function generateForUser(
  sb: any,
  userId: string,
  text: string,
  voice: string,
  language: string,
  reminderId?: string | null,
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<ReminderAudioResult> {
  const fail = (status: number, error: string, extra: Record<string, unknown> = {}): ReminderAudioErr =>
    ({ ok: false, status, error, extra });

  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length < 1 || trimmed.length > MAX_TEXT_LEN) return fail(400, "invalid_input", { field: "text" });
  const ttl = Math.min(Math.max(1, Math.floor(ttlSec)), MAX_TTL_SEC);

  // ── Engine, hashes and cache lookup ─────────────────────────────────────
  const normalised = trimmed.replace(/\s+/g, " ");
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

  const isCached = !listErr && (existing ?? []).some((f: { name: string }) => f.name === fileName);

  if (isCached) {
    const audioPath = `${userId}/${fileName}`;
    const { data: signed, error: signErr } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(audioPath, ttl);
    if (signErr || !signed?.signedUrl) return fail(500, "storage_failed");

    if (reminderId) {
      await markReminder(sb, reminderId, userId, {
        audio_path: audioPath,
        audio_hash: primary.hash,
        audio_status: "ready",
      });
    }
    await logUsage(sb, userId, 0, true, true, primary.model);
    console.log(JSON.stringify({ fn: "reminder-audio", user: userId, hash: hashPrefix, engine: primary.engine, chars: 0, cached: true }));

    return {
      ok: true,
      audioPath,
      hash: primary.hash,
      signedUrl: signed.signedUrl,
      cached: true,
      voice,
      language,
      model: primary.model,
      engine: primary.engine,
      format: primary.ext as "wav" | "mp3",
    };
  }

  // ── Kill switch and keys ────────────────────────────────────────────────
  if (Deno.env.get("CALL_REMINDERS_ENABLED") === "false") {
    return fail(503, "disabled");
  }
  const sarvamKey = Deno.env.get("SARVAM_API_KEY") ?? "";
  const geminiKeys = engineSetting === "gemini" ? await loadGeminiKeys(sb) : [];
  if (geminiKeys.length === 0 && !sarvamKey) return fail(503, "not_configured");

  // ── Generate: Gemini first, Sarvam as automatic fallback ────────────────
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
      console.log(JSON.stringify({ fn: "reminder-audio", user: userId, hash: hashPrefix, engine: "gemini", geminiStatus, attempts: g.attempts, ok: false }));
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
      fn: "reminder-audio", user: userId, hash: hashPrefix, chars: normalised.length,
      engine: primary.engine, cached: false, geminiStatus, sarvamStatus, latencyMs, ok: false,
    }));
    await logUsage(sb, userId, normalised.length, false, false, primary.model);
    if (reminderId) await markReminder(sb, reminderId, userId, { audio_status: "failed" });
    return fail(502, "tts_failed", {
      ...(geminiStatus !== undefined ? { geminiStatus } : {}),
      ...(sarvamStatus !== undefined ? { sarvamStatus } : {}),
      ...(sarvamCode ? { sarvamCode } : {}),
    });
  }

  // ── Upload ──────────────────────────────────────────────────────────────
  const audioPath = `${userId}/${generated.hash}.${generated.format}`;
  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(audioPath, generated.bytes, { contentType: generated.mime, upsert: true });
  if (uploadErr) {
    console.error("upload failed", uploadErr.message);
    await logUsage(sb, userId, normalised.length, false, false, generated.model);
    if (reminderId) await markReminder(sb, reminderId, userId, { audio_status: "failed" });
    return fail(500, "storage_failed");
  }

  // ── Usage, reminder row, signed URL ─────────────────────────────────────
  await logUsage(sb, userId, normalised.length, false, true, generated.model);
  console.log(JSON.stringify({
    fn: "reminder-audio", user: userId, hash: generated.hash.slice(0, 12), chars: normalised.length,
    engine: generated.engine, cached: false, geminiStatus, sarvamStatus, latencyMs, ok: true,
  }));

  if (reminderId) {
    await markReminder(sb, reminderId, userId, {
      audio_path: audioPath,
      audio_hash: generated.hash,
      audio_status: "ready",
    });
  }

  const { data: signed, error: signErr } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(audioPath, ttl);
  if (signErr || !signed?.signedUrl) return fail(500, "storage_failed");

  return {
    ok: true,
    audioPath,
    hash: generated.hash,
    signedUrl: signed.signedUrl,
    cached: false,
    voice,
    language,
    model: generated.model,
    engine: generated.engine,
    format: generated.format,
  };
}
