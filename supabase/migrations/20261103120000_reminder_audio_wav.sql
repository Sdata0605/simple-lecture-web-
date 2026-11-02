-- Gemini voice for call reminders returns WAV. Allow WAV in the private reminder-audio bucket.
-- Additive: keeps audio/mpeg (Sarvam fallback). Only the allow-list and the size cap change.
-- Applied by the owner via the SQL editor / Management API, NOT `supabase db push`.

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['audio/mpeg', 'audio/wav', 'audio/x-wav'],
       file_size_limit    = 5242880
 WHERE id = 'reminder-audio';
