-- Timetable reminders, part 2: roll-forward for sessions that enter the 8-day window.
-- A session created 30 days ahead gets no reminders row until it is within 8 days;
-- this function fills those in. It is NOT scheduled here. Scheduling it needs the owner's approval.
-- Additive and idempotent. Not applied: owner runs
--   npx supabase db query --linked -f supabase/migrations/20261104100100_timetable_reminder_window.sql
-- Never `supabase db push`.

BEGIN;

CREATE OR REPLACE FUNCTION public.timetable_reminders_roll_window()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.study_timetable_sessions%ROWTYPE;
  n integer := 0;
BEGIN
  FOR s IN
    SELECT x.*
      FROM public.study_timetable_sessions x
     WHERE x.reminder_channel IN ('call', 'message', 'notification')
       AND x.status = 'pending'
       AND x.scheduled_at > now()
       AND x.scheduled_at <= now() + interval '8 days'
       AND NOT EXISTS (
         SELECT 1 FROM public.reminders r
          WHERE r.source = 'timetable' AND r.session_id = x.id AND r.status <> 'cancelled')
     ORDER BY x.scheduled_at
     LIMIT 2000
  LOOP
    PERFORM public.timetable_reminder_upsert(s);
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION public.timetable_reminders_roll_window() FROM PUBLIC, anon, authenticated;

COMMIT;
