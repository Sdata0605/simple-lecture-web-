-- Timetable reminders, part 1: per-session channel, link ids for the Open class
-- button, and the trigger that keeps one reminders row per call / message /
-- notification session for the next 8 days. Email sessions never create a row.
-- Additive and idempotent. Not applied: the owner applies it with
--   npx supabase db query --linked -f supabase/migrations/20261104100000_timetable_reminder_channel.sql
-- Never `supabase db push`.

BEGIN;

-- 1. Channel per study session. NULL = no channel chosen (legacy behaviour).
ALTER TABLE public.study_timetable_sessions
  ADD COLUMN IF NOT EXISTS reminder_channel text;

DO $$ BEGIN
  ALTER TABLE public.study_timetable_sessions
    ADD CONSTRAINT study_timetable_sessions_reminder_channel_check
    CHECK (reminder_channel IS NULL OR reminder_channel IN ('call', 'message', 'notification', 'email'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. reminders: origin plus the ids the Open class button needs (no search on the device).
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS source     text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS course_id  uuid,
  ADD COLUMN IF NOT EXISTS subject_id uuid,
  ADD COLUMN IF NOT EXISTS chapter_id uuid,
  ADD COLUMN IF NOT EXISTS topic_id   uuid;

DO $$ BEGIN
  ALTER TABLE public.reminders ADD CONSTRAINT reminders_source_check
    CHECK (source IN ('user', 'timetable'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.reminders ADD CONSTRAINT reminders_timetable_session_check
    CHECK (source <> 'timetable' OR session_id IS NOT NULL OR status = 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One timetable reminder per session.
CREATE UNIQUE INDEX IF NOT EXISTS reminders_timetable_session_uidx
  ON public.reminders (session_id) WHERE source = 'timetable' AND session_id IS NOT NULL;

-- 3. The 200-row abuse cap must count only the student's own reminders, not timetable rows.
CREATE OR REPLACE FUNCTION public.reminders_v2_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source = 'timetable' THEN RETURN NEW; END IF;
  IF (SELECT count(*) FROM public.reminders WHERE user_id = NEW.user_id AND source = 'user') >= 200 THEN
    RAISE EXCEPTION 'reminder_limit' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

-- 4. Materialiser: one reminders row for one session. Only call / message / notification,
--    only pending, only starting within the next 8 days.
CREATE OR REPLACE FUNCTION public.timetable_reminder_upsert(s public.study_timetable_sessions)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  topic text;
  txt   text;
BEGIN
  topic := left(regexp_replace(btrim(coalesce(nullif(btrim(s.title), ''), 'your next topic')), '\s+', ' ', 'g'), 80);
  txt   := 'Hey, it''s time to study ' || topic || '. Tap to open the app.';

  INSERT INTO public.reminders AS r
    (user_id, title, message_text, scheduled_at, repeat_rule, kind, section, tz, enabled,
     voice, language, status, session_id, source, course_id, subject_id, chapter_id, topic_id, audio_status)
  VALUES
    (s.student_id, topic, txt, s.scheduled_at, 'none', s.reminder_channel, 'calendar', 'Asia/Kolkata', true,
     'shubh', 'en-IN', 'scheduled', s.id, 'timetable', s.course_id, s.subject_id, s.chapter_id, s.topic_id,
     CASE WHEN s.reminder_channel = 'call' THEN 'pending' ELSE 'none' END)
  ON CONFLICT (session_id) WHERE source = 'timetable' AND session_id IS NOT NULL
  DO UPDATE SET
    title        = EXCLUDED.title,
    message_text = EXCLUDED.message_text,
    scheduled_at = EXCLUDED.scheduled_at,
    kind         = EXCLUDED.kind,
    course_id    = EXCLUDED.course_id,
    subject_id   = EXCLUDED.subject_id,
    chapter_id   = EXCLUDED.chapter_id,
    topic_id     = EXCLUDED.topic_id,
    enabled      = true,
    status       = 'scheduled',
    -- Changed sentence or kind means the old audio no longer matches: queue new audio.
    audio_status = CASE WHEN r.message_text IS DISTINCT FROM EXCLUDED.message_text
                          OR r.kind IS DISTINCT FROM EXCLUDED.kind
                        THEN EXCLUDED.audio_status ELSE r.audio_status END,
    audio_path   = CASE WHEN r.message_text IS DISTINCT FROM EXCLUDED.message_text
                          OR r.kind IS DISTINCT FROM EXCLUDED.kind
                        THEN NULL ELSE r.audio_path END,
    audio_hash   = CASE WHEN r.message_text IS DISTINCT FROM EXCLUDED.message_text
                          OR r.kind IS DISTINCT FROM EXCLUDED.kind
                        THEN NULL ELSE r.audio_hash END;
END
$$;

REVOKE ALL ON FUNCTION public.timetable_reminder_upsert(public.study_timetable_sessions)
  FROM PUBLIC, anon, authenticated;

-- 5. Trigger: keep the reminders row in step with the session.
CREATE OR REPLACE FUNCTION public.timetable_reminder_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- BEFORE DELETE: cancel first, so the FK "ON DELETE SET NULL" cannot leave a live orphan row.
    UPDATE public.reminders SET status = 'cancelled', enabled = false
     WHERE source = 'timetable' AND session_id = OLD.id AND status <> 'cancelled';
    RETURN OLD;
  END IF;

  -- Legacy sessions (no channel, none before) do no work.
  IF NEW.reminder_channel IS NULL AND (TG_OP = 'INSERT' OR OLD.reminder_channel IS NULL) THEN
    RETURN NULL;
  END IF;

  -- Nothing that matters for the reminder changed (notes, duration, reminder_sent_at, ...).
  IF TG_OP = 'UPDATE'
     AND NEW.reminder_channel IS NOT DISTINCT FROM OLD.reminder_channel
     AND NEW.scheduled_at     IS NOT DISTINCT FROM OLD.scheduled_at
     AND NEW.status           IS NOT DISTINCT FROM OLD.status
     AND NEW.title            IS NOT DISTINCT FROM OLD.title
     AND NEW.student_id       IS NOT DISTINCT FROM OLD.student_id
     AND NEW.course_id        IS NOT DISTINCT FROM OLD.course_id
     AND NEW.subject_id       IS NOT DISTINCT FROM OLD.subject_id
     AND NEW.chapter_id       IS NOT DISTINCT FROM OLD.chapter_id
     AND NEW.topic_id         IS NOT DISTINCT FROM OLD.topic_id THEN
    RETURN NULL;
  END IF;

  IF NEW.reminder_channel IN ('call', 'message', 'notification')
     AND NEW.status = 'pending'
     AND NEW.scheduled_at > now()
     AND NEW.scheduled_at <= now() + interval '8 days' THEN
    PERFORM public.timetable_reminder_upsert(NEW);
  ELSE
    -- Email, cleared, done, skipped, past, or beyond 8 days: no phone reminder.
    UPDATE public.reminders SET status = 'cancelled', enabled = false
     WHERE source = 'timetable' AND session_id = NEW.id AND status <> 'cancelled';
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS timetable_reminder_sync_trg ON public.study_timetable_sessions;
CREATE TRIGGER timetable_reminder_sync_trg
  AFTER INSERT OR UPDATE ON public.study_timetable_sessions
  FOR EACH ROW EXECUTE FUNCTION public.timetable_reminder_sync();

DROP TRIGGER IF EXISTS timetable_reminder_delete_trg ON public.study_timetable_sessions;
CREATE TRIGGER timetable_reminder_delete_trg
  BEFORE DELETE ON public.study_timetable_sessions
  FOR EACH ROW EXECUTE FUNCTION public.timetable_reminder_sync();

COMMIT;
