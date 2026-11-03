-- UNTESTED. Not applied. Owner applies with:
--   npx supabase db query --linked -f supabase/migrations/20261106100000_reminder_audio_prefetch_cron.sql
-- Never `supabase db push`.
--
-- Schedules reminder-audio-prefetch (cron mode) every 6 hours via pg_cron + pg_net.
-- Prerequisites (owner, once; the key is never written to this file):
--   1. Store the service role key in Vault under the name used below:
--        select vault.create_secret('<service role key>', 'reminder_audio_service_key');
--   2. Deploy the function: npx supabase functions deploy reminder-audio-prefetch --project-ref oxwhqvsoelqqsblmqkxx
--      (default verify_jwt is fine: the service role key is a valid JWT; the function checks it again.)
-- The job reads the secret at run time, so the key is not stored in cron.job.
--
-- Style follows 20261002031210_create_dubbing_batch_cron.sql.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reminder-audio-prefetch-every-6h') THEN
    PERFORM cron.unschedule('reminder-audio-prefetch-every-6h');
  END IF;

  PERFORM cron.schedule(
    'reminder-audio-prefetch-every-6h',
    '0 */6 * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://oxwhqvsoelqqsblmqkxx.supabase.co/functions/v1/reminder-audio-prefetch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
           WHERE name = 'reminder_audio_service_key' LIMIT 1
        )
      ),
      body := '{"mode":"cron"}'::jsonb,
      timeout_milliseconds := 120000
    );
    $cron$
  );
END $$;
