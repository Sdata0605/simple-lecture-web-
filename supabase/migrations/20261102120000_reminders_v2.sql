-- Reminders v2: kinds (call|message|notification), Calendar vs Daily sections,
-- floating wall-clock time for daily reminders, on/off switch, 'delivered' status.
-- Additive and idempotent: safe to re-run.
-- Apply ONLY with:
--   npx supabase db query --linked -f supabase/migrations/20261102120000_reminders_v2.sql
-- Never with `supabase db push` (remote migration history does not match local files).

BEGIN;

-- 1. New columns. Nullable first, so existing rows stay valid during backfill.
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS kind        text,
  ADD COLUMN IF NOT EXISTS section     text,
  ADD COLUMN IF NOT EXISTS time_of_day time(0),
  ADD COLUMN IF NOT EXISTS tz          text,
  ADD COLUMN IF NOT EXISTS enabled     boolean NOT NULL DEFAULT true;

-- 2. Backfill existing rows (feature was never released; only internal test rows exist).
--    Legacy weekdays/weekly rows become daily (v2 UI has no weekly repeat).
UPDATE public.reminders SET repeat_rule = 'daily'
 WHERE repeat_rule IN ('weekdays', 'weekly');

UPDATE public.reminders
   SET kind = CASE WHEN call_enabled THEN 'call' ELSE 'message' END
 WHERE kind IS NULL;

UPDATE public.reminders
   SET section = CASE WHEN repeat_rule = 'daily' THEN 'daily' ELSE 'calendar' END
 WHERE section IS NULL;

UPDATE public.reminders SET tz = 'Asia/Kolkata' WHERE tz IS NULL;

UPDATE public.reminders
   SET time_of_day = date_trunc('minute', scheduled_at AT TIME ZONE tz)::time(0)
 WHERE repeat_rule = 'daily' AND time_of_day IS NULL;

-- 3. Defaults and consistency trigger.
--    Old (v1) clients send call_enabled and no kind; new clients send kind.
CREATE OR REPLACE FUNCTION public.reminders_v2_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.kind IS NOT DISTINCT FROM OLD.kind
     AND NEW.call_enabled IS DISTINCT FROM OLD.call_enabled THEN
    NEW.kind := CASE WHEN NEW.call_enabled THEN 'call' ELSE 'message' END;
  END IF;
  IF NEW.kind IS NULL THEN
    NEW.kind := CASE WHEN NEW.call_enabled THEN 'call' ELSE 'message' END;
  END IF;
  NEW.call_enabled := (NEW.kind = 'call');

  IF NEW.tz IS NULL THEN
    NEW.tz := 'Asia/Kolkata';
  END IF;
  IF NEW.section IS NULL THEN
    NEW.section := CASE WHEN NEW.repeat_rule = 'daily' THEN 'daily' ELSE 'calendar' END;
  END IF;
  IF NEW.repeat_rule = 'daily' AND NEW.time_of_day IS NULL THEN
    NEW.time_of_day := date_trunc('minute', NEW.scheduled_at AT TIME ZONE NEW.tz)::time(0);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS reminders_v2_defaults ON public.reminders;
CREATE TRIGGER reminders_v2_defaults
  BEFORE INSERT OR UPDATE ON public.reminders
  FOR EACH ROW EXECUTE FUNCTION public.reminders_v2_defaults();

-- 4. Per-user safety cap (abuse guard; the UI limits are far lower).
CREATE OR REPLACE FUNCTION public.reminders_v2_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT count(*) FROM public.reminders WHERE user_id = NEW.user_id) >= 200 THEN
    RAISE EXCEPTION 'reminder_limit' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS reminders_v2_cap ON public.reminders;
CREATE TRIGGER reminders_v2_cap
  BEFORE INSERT ON public.reminders
  FOR EACH ROW EXECUTE FUNCTION public.reminders_v2_cap();

-- 5. Constraints (after backfill).
ALTER TABLE public.reminders ALTER COLUMN kind SET NOT NULL;
ALTER TABLE public.reminders ALTER COLUMN section SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.reminders ADD CONSTRAINT reminders_kind_check
    CHECK (kind IN ('call', 'message', 'notification'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.reminders ADD CONSTRAINT reminders_section_check
    CHECK (section IN ('calendar', 'daily'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.reminders ADD CONSTRAINT reminders_daily_time_check
    CHECK (repeat_rule <> 'daily' OR time_of_day IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.reminders ADD CONSTRAINT reminders_tz_check
    CHECK (tz IS NULL OR char_length(tz) BETWEEN 1 AND 64);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. Widen the status CHECK to include 'delivered' (backward compatible: superset).
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
    FROM pg_constraint
   WHERE conrelid = 'public.reminders'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%'
     AND pg_get_constraintdef(oid) ILIKE '%cancelled%'
     AND pg_get_constraintdef(oid) NOT ILIKE '%delivered%'
     AND pg_get_constraintdef(oid) NOT ILIKE '%audio_status%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.reminders DROP CONSTRAINT %I', c);
    ALTER TABLE public.reminders ADD CONSTRAINT reminders_status_check
      CHECK (status IN ('scheduled', 'answered', 'declined', 'missed', 'cancelled', 'delivered'));
  END IF;
END $$;

-- 7. Indexes.
CREATE INDEX IF NOT EXISTS reminders_user_active_idx
  ON public.reminders (user_id, scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS reminders_user_section_idx
  ON public.reminders (user_id, section, time_of_day);

COMMIT;
