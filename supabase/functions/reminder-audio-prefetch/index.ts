// Pre-generates audio for timetable call reminders, using the shared path in _shared/reminderAudio.ts.
//
// Two modes, one function. Both take POST with JSON body.
//
// 1. Cron mode. Called by pg_cron (see the migration 20261106100000_reminder_audio_prefetch_cron.sql).
//      Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//      body: { "mode": "cron" }
//      Finds call reminders (kind 'call', source 'timetable') that fire within the next 3 days and whose
//      audio_status is not 'ready'. Oldest fire time first, so day 1 is done first. Generates audio with a
//      24-hour signed URL, writes audio_path / audio_hash / audio_status, then sends one data-only push per
//      user to send-push-notification.
//      200 { mode: "cron", scanned, ready, failed, deferred, usersPushed, usersPushFailed }
//
// 2. Plan mode. Called by the app with the student's JWT.
//      Authorization: Bearer <user access token>
//      body: { "timetable_id": "<uuid>", "days"?: 1 | 2 | 3 }   (days default 1)
//      Checks the caller owns the timetable. Generates audio for that timetable's call reminders that
//      fire within `days`. Stops at a 30 second budget; reminders not reached by then count as failed.
//      200 { ready, failed }
//
// Errors: 400 invalid_input, 401 unauthorized, 404 not_found (also for another user's timetable),
// 405 method_not_allowed, 500 internal, 503 disabled (CALL_REMINDERS_ENABLED=false).
// Responses carry counts only: no text, keys, tokens or signed URLs.
// Idempotent: rows already 'ready' are not regenerated, and the shared path reuses cached files by hash.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DEFAULT_LANGUAGE, DEFAULT_TTL_SEC, DEFAULT_VOICE, MAX_TTL_SEC, generateForUser } from "../_shared/reminderAudio.ts";

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_KEY = Deno.env.get("REMINDER_CRON_KEY") ?? "";
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const DAY_MS = 24 * 60 * 60 * 1000;
const CRON_WINDOW_MS = 3 * DAY_MS;
const CRON_TTL_SEC = MAX_TTL_SEC; // 24 hours: the push carries the URL and the app may open it later
const CRON_BATCH_LIMIT = 200;
const CRON_BUDGET_MS = 100_000; // stop starting new clips after this; the rest wait for the next run
const PLAN_BUDGET_MS = 30_000; // the caller gives up after this
const PLAN_LIMIT = 200;
const PUSH_TIMEOUT_MS = 15_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROW_COLUMNS = "id, user_id, message_text, voice, language, scheduled_at, audio_status";

interface ReminderRow {
  id: string;
  user_id: string;
  message_text: string | null;
  voice: string | null;
  language: string | null;
  scheduled_at: string;
  audio_status: string;
}

interface ReadyItem {
  rid: string;
  hash: string;
  url: string;
  fmt: string;
  fireAt: string;
  userId: string;
}

function invalid(field: string, message: string) {
  return json({ error: "invalid_input", field, message }, 400);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Resolves to the value, or null if the deadline passes first. The underlying work keeps running
// (its result is idempotent), but the caller stops waiting.
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), Math.max(1, ms));
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

// Generates audio for one reminder row. Returns null on any failure (the shared path marks the row failed).
async function prepareRow(row: ReminderRow, ttlSec: number, timeoutMs: number): Promise<ReadyItem | null> {
  const res = await withDeadline(
    generateForUser(
      sb,
      row.user_id,
      row.message_text ?? "",
      row.voice || DEFAULT_VOICE,
      row.language || DEFAULT_LANGUAGE,
      row.id,
      ttlSec,
    ),
    timeoutMs,
  );
  if (!res || !res.ok) return null;
  return {
    rid: row.id,
    hash: res.hash,
    url: res.signedUrl,
    fmt: res.format,
    fireAt: row.scheduled_at,
    userId: row.user_id,
  };
}

// One data-only push per user. Returns true when send-push-notification accepted it.
async function sendAudioPush(userId: string, items: ReadyItem[]): Promise<boolean> {
  const payloadItems = items
    .slice()
    .sort((a, b) => a.fireAt.localeCompare(b.fireAt))
    .map(({ rid, hash, url, fmt, fireAt }) => ({ rid, hash, url, fmt, fireAt }));
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        data_only: true,
        data: { type: "reminder_audio", items: JSON.stringify(payloadItems) },
      }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function runCron(): Promise<Response> {
  const started = Date.now();
  const now = Date.now();
  const { data, error } = await sb
    .from("reminders")
    .select(ROW_COLUMNS)
    .eq("kind", "call")
    .eq("source", "timetable")
    .eq("enabled", true)
    .eq("status", "scheduled")
    .neq("audio_status", "ready")
    .gte("scheduled_at", new Date(now).toISOString())
    .lte("scheduled_at", new Date(now + CRON_WINDOW_MS).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(CRON_BATCH_LIMIT);
  if (error) {
    console.error("cron query failed", error.message);
    return json({ error: "internal" }, 500);
  }

  const rows = (data ?? []) as ReminderRow[];
  let ready = 0;
  let failed = 0;
  let deferred = 0;
  const byUser = new Map<string, ReadyItem[]>();

  for (const row of rows) {
    const remaining = CRON_BUDGET_MS - (Date.now() - started);
    if (remaining <= 0) {
      deferred++;
      continue;
    }
    const item = await prepareRow(row, CRON_TTL_SEC, remaining);
    if (!item) {
      failed++;
      continue;
    }
    ready++;
    const list = byUser.get(item.userId) ?? [];
    list.push(item);
    byUser.set(item.userId, list);
  }

  let usersPushed = 0;
  let usersPushFailed = 0;
  for (const [userId, items] of byUser) {
    if (await sendAudioPush(userId, items)) usersPushed++;
    else usersPushFailed++;
  }

  console.log(JSON.stringify({ fn: "reminder-audio-prefetch", mode: "cron", scanned: rows.length, ready, failed, deferred }));
  return json({ mode: "cron", scanned: rows.length, ready, failed, deferred, usersPushed, usersPushFailed });
}

async function runPlan(userId: string, timetableId: string, days: number): Promise<Response> {
  const started = Date.now();

  // Ownership: the timetable's student must be the caller. Other timetables look like not found.
  const { data: tt, error: ttErr } = await sb
    .from("study_timetables")
    .select("id, student_id")
    .eq("id", timetableId)
    .maybeSingle();
  if (ttErr) return json({ error: "internal" }, 500);
  if (!tt || tt.student_id !== userId) return json({ error: "not_found" }, 404);

  const now = Date.now();
  const windowEnd = new Date(now + days * DAY_MS).toISOString();
  const nowIso = new Date(now).toISOString();

  const { data: sessions, error: sErr } = await sb
    .from("study_timetable_sessions")
    .select("id")
    .eq("timetable_id", timetableId)
    .gte("scheduled_at", nowIso)
    .lte("scheduled_at", windowEnd)
    .limit(1000);
  if (sErr) return json({ error: "internal" }, 500);
  const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id);
  if (sessionIds.length === 0) return json({ ready: 0, failed: 0 });

  const { data: rows, error: rErr } = await sb
    .from("reminders")
    .select(ROW_COLUMNS)
    .eq("user_id", userId)
    .eq("kind", "call")
    .eq("source", "timetable")
    .eq("enabled", true)
    .eq("status", "scheduled")
    .in("session_id", sessionIds)
    .gte("scheduled_at", nowIso)
    .lte("scheduled_at", windowEnd)
    .order("scheduled_at", { ascending: true })
    .limit(PLAN_LIMIT);
  if (rErr) return json({ error: "internal" }, 500);

  let ready = 0;
  let failed = 0;
  for (const row of (rows ?? []) as ReminderRow[]) {
    if (row.audio_status === "ready") {
      ready++;
      continue;
    }
    const remaining = PLAN_BUDGET_MS - (Date.now() - started);
    if (remaining <= 0) {
      failed++; // not reached within the budget
      continue;
    }
    const item = await prepareRow(row, DEFAULT_TTL_SEC, remaining);
    if (item) ready++;
    else failed++;
  }

  console.log(JSON.stringify({ fn: "reminder-audio-prefetch", mode: "plan", days, ready, failed }));
  return json({ ready, failed });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (Deno.env.get("CALL_REMINDERS_ENABLED") === "false") return json({ error: "disabled" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return invalid("body", "Request body must be JSON");
  }
  if (!body || typeof body !== "object") return invalid("body", "Request body must be an object");

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);

  // ── Cron mode: the REMINDER_CRON_KEY function secret only ───────────────
  if (body.mode === "cron") {
    if (!CRON_KEY || !constantTimeEquals(token, CRON_KEY)) return json({ error: "unauthorized" }, 401);
    return runCron();
  }

  // ── Plan mode: the student's own JWT ────────────────────────────────────
  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const timetableId = body.timetable_id;
  if (typeof timetableId !== "string" || !UUID_RE.test(timetableId)) {
    return invalid("timetable_id", "timetable_id must be a uuid");
  }

  let days = 1;
  const rawDays = body.days;
  if (rawDays !== undefined && rawDays !== null) {
    if (typeof rawDays !== "number" || !Number.isInteger(rawDays) || rawDays < 1 || rawDays > 3) {
      return invalid("days", "days must be 1, 2 or 3");
    }
    days = rawDays;
  }

  return runPlan(userData.user.id, timetableId, days);
});
