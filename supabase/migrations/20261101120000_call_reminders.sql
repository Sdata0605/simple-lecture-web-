-- Study "Call reminder" feature: reminders table, TTS usage log, private audio bucket.
-- Idempotent: safe to re-run.

-- ── reminders ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reminders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title          text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  message_text   text NOT NULL CHECK (char_length(message_text) BETWEEN 1 AND 500),
  scheduled_at   timestamptz NOT NULL,
  repeat_rule    text NOT NULL DEFAULT 'none'
                 CHECK (repeat_rule IN ('none','daily','weekdays','weekly')),
  call_enabled   boolean NOT NULL DEFAULT false,
  voice          text NOT NULL DEFAULT 'shubh',
  language       text NOT NULL DEFAULT 'en-IN'
                 CHECK (language IN ('en-IN','hi-IN','mr-IN','kn-IN')),
  audio_path     text,            -- storage key inside bucket reminder-audio
  audio_hash     text,            -- sha256 hex used to build audio_path
  audio_status   text NOT NULL DEFAULT 'none'
                 CHECK (audio_status IN ('none','pending','ready','failed')),
  status         text NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled','answered','declined','missed','cancelled')),
  last_fired_at  timestamptz,
  session_id     uuid REFERENCES public.study_timetable_sessions(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reminders_user_scheduled_idx
  ON public.reminders (user_id, scheduled_at);

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "reminders_select_own" ON public.reminders
    FOR SELECT TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "reminders_insert_own" ON public.reminders
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "reminders_update_own" ON public.reminders
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "reminders_delete_own" ON public.reminders
    FOR DELETE TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- updated_at trigger: reuses public.update_updated_at_column() (defined in the
-- 2025-10-03 baseline migration).
DROP TRIGGER IF EXISTS reminders_touch_updated_at ON public.reminders;
CREATE TRIGGER reminders_touch_updated_at BEFORE UPDATE ON public.reminders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── TTS usage log (quota + cost tracking) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reminder_tts_usage (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chars       integer NOT NULL,
  cached      boolean NOT NULL,
  model       text NOT NULL,
  success     boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reminder_tts_usage_user_day_idx
  ON public.reminder_tts_usage (user_id, created_at DESC);

ALTER TABLE public.reminder_tts_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "reminder_tts_usage_select_own" ON public.reminder_tts_usage
    FOR SELECT TO authenticated USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- no insert/update/delete policies: only the service role (edge function) writes.

-- ── Storage bucket ────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('reminder-audio', 'reminder-audio', false, 2097152, ARRAY['audio/mpeg'])
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "reminder_audio_read_own" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'reminder-audio'
           AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- uploads/deletes only via service role in the edge function (no insert policy).
