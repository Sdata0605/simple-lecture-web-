DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'video_generation_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.video_generation_jobs;
  END IF;
END;
$$;
