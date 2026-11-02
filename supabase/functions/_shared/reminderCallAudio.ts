// Per-user call-reminder audio for the server-side preparation path.
//
// Every file is stored under the owner's folder: reminder-audio/<user_id>/<hash>.<ext>.
// Nothing is shared between users. The app's Gemini keys (loadGeminiKeys) generate the audio,
// with Sarvam as the automatic fallback. Hashes match reminder-call-audio exactly, so a file
// made by either function is a cache hit for the other.
//
// Never log or return keys, tokens or the reminder text beyond what the caller needs.

// deno-lint-ignore-file no-explicit-any
import { loadGeminiKeys } from "./geminiKeys.ts";
import {
  STYLE_VERSION,
  base64ToBytes,
  resolveGeminiVoice,
  styleFor,
  synthesize,
} from "./geminiTts.ts";

const BUCKET = "reminder-audio";
const GEMINI_TIMEOUT_MS = 10000;
const GEMINI_ATTEMPTS = 2;
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash-tts";
const SARVAM_MODEL = "bulbul:v3";
const SARVAM_PACE = 0.9;
const SARVAM_SAMPLE_RATE = 24000;
const SARVAM_URL = "https://api.sarvam.ai/text-to-speech";
const SARVAM_TIMEOUT_MS = 8000;
const SARVAM_DEFAULT_SPEAKER = "shubh";
const DEFAULT_LANGUAGE = "en-IN";
const MAX_TEXT_LEN = 500;

export type CallAudioStatus = "cached" | "generated" | "quota" | "failed" | "not_configured";

export interface CallAudioResult {
  status: CallAudioStatus;
  audioPath?: string;
  hash?: string;
  engine?: "gemini" | "sarvam";
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function logUsage(sb: any, userId: string, chars: number, cached: boolean, success: boolean, model: string) {
  try {
    await sb.from("reminder_tts_usage").insert({ user_id: userId, chars, cached, model, success });
  } catch (e) {
    console.error("usage log failed", (e as Error).message);
  }
}

/**
 * Makes sure one call reminder has audio in the user's own folder, and points the row at it.
 * Returns the status; it never throws.
 */
export async function ensureCallAudio(opts: {
  sb: any;
  userId: string;
  reminderId: string;
  text: string;
  voice?: string | null;
  language?: string | null;
}): Promise<CallAudioResult> {
  const { sb, userId, reminderId } = opts;
  const text = (opts.text ?? "").trim();
  if (text.length < 1 || text.length > MAX_TEXT_LEN) return { status: "failed" };
  const normalised = text.replace(/\s+/g, " ");
  const language = opts.language || DEFAULT_LANGUAGE;
  const voice = opts.voice || SARVAM_DEFAULT_SPEAKER;

  const engineSetting = Deno.env.get("REMINDER_TTS_ENGINE") === "sarvam" ? "sarvam" : "gemini";
  const geminiModel = (Deno.env.get("REMINDER_TTS_MODEL") ?? "").trim() || DEFAULT_GEMINI_MODEL;
  const geminiVoice = resolveGeminiVoice(voice);
  const geminiHash = await sha256Hex(`v2|gemini|${geminiModel}|${geminiVoice}|${language}|${STYLE_VERSION}|${normalised}`);
  const sarvamHash = await sha256Hex(`v1|${SARVAM_MODEL}|${voice}|${language}|${SARVAM_PACE}|${normalised}`);
  const primary = engineSetting === "gemini"
    ? { engine: "gemini" as const, hash: geminiHash, ext: "wav", model: geminiModel }
    : { engine: "sarvam" as const, hash: sarvamHash, ext: "mp3", model: SARVAM_MODEL };

  // 1. Cache: this user's own file already exists.
  const fileName = `${primary.hash}.${primary.ext}`;
  const audioPath = `${userId}/${fileName}`;
  const { data: existing, error: listErr } = await sb.storage
    .from(BUCKET)
    .list(userId, { search: fileName, limit: 5 });
  const cached = !listErr && (existing ?? []).some((f: { name: string }) => f.name === fileName);
  if (cached) {
    await linkRow(sb, reminderId, userId, audioPath, primary.hash);
    await logUsage(sb, userId, 0, true, true, primary.model);
    return { status: "cached", audioPath, hash: primary.hash, engine: primary.engine };
  }

  // 2. Daily quota for new generations (same limit as reminder-call-audio).
  const dailyLimit = Math.max(1, parseInt(Deno.env.get("REMINDER_TTS_DAILY_LIMIT") ?? "40", 10) || 40);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: usedCount, error: quotaErr } = await sb
    .from("reminder_tts_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("cached", false)
    .eq("success", true)
    .gte("created_at", since);
  if (quotaErr) return { status: "failed" };
  if ((usedCount ?? 0) >= dailyLimit) return { status: "quota" };

  // 3. Keys.
  const sarvamKey = Deno.env.get("SARVAM_API_KEY") ?? "";
  const geminiKeys = engineSetting === "gemini" ? await loadGeminiKeys(sb) : [];
  if (geminiKeys.length === 0 && !sarvamKey) return { status: "not_configured" };

  // 4. Generate: Gemini first, Sarvam as fallback.
  let bytes: Uint8Array | null = null;
  let format: "wav" | "mp3" = "wav";
  let mime = "audio/wav";
  let engine: "gemini" | "sarvam" = "gemini";
  let hash = geminiHash;
  let model = geminiModel;

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
    if (g.ok) bytes = g.wav;
  }

  if (!bytes && sarvamKey) {
    try {
      const res = await fetch(SARVAM_URL, {
        method: "POST",
        headers: { "api-subscription-key": sarvamKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: normalised,
          language_code: language,
          speaker: voice,
          model: SARVAM_MODEL,
          pace: SARVAM_PACE,
          speech_sample_rate: SARVAM_SAMPLE_RATE,
          output_audio_codec: "mp3",
        }),
        signal: AbortSignal.timeout(SARVAM_TIMEOUT_MS),
      });
      const payload: any = res.ok ? await res.json().catch(() => null) : null;
      const b64: unknown = Array.isArray(payload?.audios) ? payload.audios[0] : undefined;
      if (typeof b64 === "string" && b64.length > 0) {
        const decoded = base64ToBytes(b64);
        if (decoded.length > 0) {
          bytes = decoded;
          format = "mp3";
          mime = "audio/mpeg";
          engine = "sarvam";
          hash = sarvamHash;
          model = SARVAM_MODEL;
        }
      }
    } catch {
      bytes = null;
    }
  }

  if (!bytes) {
    await logUsage(sb, userId, normalised.length, false, false, model);
    await sb.from("reminders").update({ audio_status: "failed" }).eq("id", reminderId).eq("user_id", userId);
    return { status: "failed" };
  }

  // 5. Upload to the owner's folder only.
  const outPath = `${userId}/${hash}.${format}`;
  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(outPath, bytes, { contentType: mime, upsert: true });
  if (uploadErr) {
    console.error("call audio upload failed", uploadErr.message);
    await logUsage(sb, userId, normalised.length, false, false, model);
    return { status: "failed" };
  }

  await logUsage(sb, userId, normalised.length, false, true, model);
  await linkRow(sb, reminderId, userId, outPath, hash);
  console.log(JSON.stringify({ fn: "reminderCallAudio", user: userId, hash: hash.slice(0, 12), engine, ok: true }));
  return { status: "generated", audioPath: outPath, hash, engine };
}

async function linkRow(sb: any, reminderId: string, userId: string, audioPath: string, hash: string) {
  await sb
    .from("reminders")
    .update({ audio_path: audioPath, audio_hash: hash, audio_status: "ready" })
    .eq("id", reminderId)
    .eq("user_id", userId);
}
