-- Allow an explicit 'none' (student turned reminders off). Widens the CHECK only; no data change.
-- Not applied. Owner applies with: npx supabase db query --linked -f <this file>. Never db push.
-- Must be applied after 20261104100000_timetable_reminder_channel.sql.
BEGIN;
ALTER TABLE public.study_timetable_sessions
  DROP CONSTRAINT IF EXISTS study_timetable_sessions_reminder_channel_check;
ALTER TABLE public.study_timetable_sessions
  ADD CONSTRAINT study_timetable_sessions_reminder_channel_check
  CHECK (reminder_channel IS NULL OR reminder_channel IN ('call','message','notification','email','none'));
COMMIT;
