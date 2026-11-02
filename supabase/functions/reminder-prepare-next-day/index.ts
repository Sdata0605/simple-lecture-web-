// Prepares tomorrow's call-reminder audio for one student, once today's last call is over.
//
// Two callers, no clock time anywhere:
//   1. The mobile app, after a call reminder ends (answered, declined, missed, or ring window closed).
//      POST with the user's JWT in Authorization. Body is ignored. Only that user is prepared.
//   2. A scheduled job (NOT scheduled yet). POST with header `x-cron-key` equal to env
//      REMINDER_PREP_CRON_KEY. Body { userId } prepares one user; an empty body sweeps users
//      who have call reminders in the current window.
//
// Rule: prepare only when every call reminder of the user's local today is finished
// (status is not 'scheduled', or its ring window of 5 minutes has passed). Then generate
// audio for the user's local tomorrow call reminders only. No calls tomorrow means nothing is made.
// Audio is per user (reminder-audio/<user_id>/...), via _shared/reminderCallAudio.ts.
//
// Responses carry counts and reasons only: no text, keys or tokens.
// verify_jwt = false in supabase/config.toml, because the cron caller has no JWT. Auth is checked here.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensureCallAudio } from "../_shared/reminderCallAudio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const DEFAULT_TZ = "Asia/Kolkata";
const RING_WINDOW_MS = 5 * 60 * 1000; // a call is over once its ring window has closed
const MAX_CLIPS_PER_RUN = 10; // per user, per trigger
const MAX_USERS_PER_SWEEP = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

interface CallRow {
  id: string;
  user_id: string;
  message_text: string | null;
  voice: string | null;
  language: string | null;
  scheduled_at: string;
  status: string;
  enabled: boolean;
  tz: string | null;
}

function safeTz(tz: string | null | undefined): string {
  const candidate = (tz ?? "").trim() || DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TZ;
  }
}

// Local calendar date (YYYY-MM-DD) of an instant in the given IANA zone.
function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function prepareUser(userId: string, now: Date): Promise<Record<string, unknown>> {
  const from = new Date(now.getTime() - DAY_MS).toISOString();
  const to = new Date(now.getTime() + 2 * DAY_MS).toISOString();
  const { data, error } = await sb
    .from("reminders")
    .select("id, user_id, message_text, voice, language, scheduled_at, status, enabled, tz")
    .eq("user_id", userId)
    .eq("kind", "call")
    .eq("enabled", true)
    .neq("status", "cancelled")
    .gte("scheduled_at", from)
    .lte("scheduled_at", to);
  if (error) {
    console.error("prepare query failed", error.message);
    return { prepared: false, reason: "query_failed" };
  }

  const rows = (data ?? []) as CallRow[];
  const tz = safeTz(rows[0]?.tz);
  const today = localDate(now, tz);
  const tomorrow = localDate(new Date(now.getTime() + DAY_MS), tz);

  const todays = rows.filter((r) => localDate(new Date(r.scheduled_at), tz) === today);
  if (todays.length === 0) return { prepared: false, reason: "no_calls_today" };

  const stillOpen = todays.filter(
    (r) => r.status === "scheduled" && new Date(r.scheduled_at).getTime() + RING_WINDOW_MS > now.getTime(),
  );
  if (stillOpen.length > 0) return { prepared: false, reason: "calls_still_open", open: stillOpen.length };

  const tomorrows = rows
    .filter((r) => r.status === "scheduled" && localDate(new Date(r.scheduled_at), tz) === tomorrow)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .slice(0, MAX_CLIPS_PER_RUN);
  if (tomorrows.length === 0) return { prepared: false, reason: "no_calls_tomorrow" };

  const counts: Record<string, number> = { generated: 0, cached: 0, quota: 0, failed: 0, not_configured: 0 };
  for (const r of tomorrows) {
    const res = await ensureCallAudio({
      sb,
      userId,
      reminderId: r.id,
      text: r.message_text ?? "",
      voice: r.voice,
      language: r.language,
    });
    counts[res.status] = (counts[res.status] ?? 0) + 1;
  }
  console.log(JSON.stringify({ fn: "reminder-prepare-next-day", day: tomorrow, counts }));
  return { prepared: true, day: tomorrow, counts };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (Deno.env.get("CALL_REMINDERS_ENABLED") === "false") return json({ error: "disabled" }, 503);

  const now = new Date();
  const presentedKey = req.headers.get("x-cron-key") ?? "";

  // ── Scheduled job path ──────────────────────────────────────────────────
  if (presentedKey) {
    const cronKey = Deno.env.get("REMINDER_PREP_CRON_KEY") ?? "";
    if (!cronKey || !constantTimeEquals(presentedKey, cronKey)) return json({ error: "unauthorized" }, 401);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (body && typeof body.userId === "string") {
      if (!UUID_RE.test(body.userId)) return json({ error: "invalid_input", field: "userId" }, 400);
      const result = await prepareUser(body.userId, now);
      return json({ mode: "cron_user", ...result });
    }

    // Sweep: users with call reminders from yesterday to two days ahead.
    const from = new Date(now.getTime() - DAY_MS).toISOString();
    const to = new Date(now.getTime() + 2 * DAY_MS).toISOString();
    const { data, error } = await sb
      .from("reminders")
      .select("user_id")
      .eq("kind", "call")
      .eq("enabled", true)
      .eq("status", "scheduled")
      .gte("scheduled_at", from)
      .lte("scheduled_at", to)
      .limit(1000);
    if (error) return json({ error: "internal" }, 500);

    const users = [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))].slice(0, MAX_USERS_PER_SWEEP);
    const summary: Record<string, number> = {};
    for (const uid of users) {
      const r = await prepareUser(uid, now);
      const key = r.prepared ? "prepared" : String(r.reason);
      summary[key] = (summary[key] ?? 0) + 1;
    }
    return json({ mode: "cron_sweep", users: users.length, summary });
  }

  // ── Mobile app path (after a call ends) ─────────────────────────────────
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);
  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const result = await prepareUser(userData.user.id, now);
  return json({ mode: "self", ...result });
});
