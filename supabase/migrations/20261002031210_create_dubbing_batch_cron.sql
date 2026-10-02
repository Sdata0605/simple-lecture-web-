-- Schedules the dubbing-batch-tick edge function to run every minute via
-- pg_cron, independent of any admin browser tab — this is what makes the
-- Dubbing tab's "Auto Pipeline" genuinely server-side (reuses the existing
-- auto_submission_runs table + claim_auto_submission_run RPC with a new
-- kind='dubbing_batch', no schema change needed for either).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dubbing-batch-tick-every-minute') THEN
    PERFORM cron.unschedule('dubbing-batch-tick-every-minute');
  END IF;

  PERFORM cron.schedule(
    'dubbing-batch-tick-every-minute',
    '* * * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://oxwhqvsoelqqsblmqkxx.supabase.co/functions/v1/dubbing-batch-tick',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
    $cron$
  );
END $$;
