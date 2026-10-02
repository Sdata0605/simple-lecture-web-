-- Create dubbing_jobs table for tracking multilanguage dubbing runs
-- (POST /job/<job_id>/dub_languages, GET /job/<job_id>/dub_status), so the
-- admin Dubbing tab can show a "Status" list of every dub ever triggered,
-- not just the one currently selected. Mirrors language_avatar_jobs.
CREATE TABLE public.dubbing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_job_id VARCHAR(9) REFERENCES video_generation_jobs(id) ON DELETE CASCADE,
  external_job_id TEXT NOT NULL,
  subject_id UUID REFERENCES popular_subjects(id) ON DELETE CASCADE,
  document_name TEXT,
  languages TEXT[] NOT NULL,
  speaker TEXT DEFAULT 'abhilash',
  tts_engine TEXT DEFAULT 'edgetts',
  status TEXT DEFAULT 'processing',
  progress_message TEXT,
  error_message TEXT,
  dubbed_languages JSONB,
  server_ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dubbing_jobs_video_job ON dubbing_jobs(video_job_id);
CREATE INDEX idx_dubbing_jobs_status ON dubbing_jobs(status);
CREATE INDEX idx_dubbing_jobs_subject ON dubbing_jobs(subject_id);

ALTER TABLE dubbing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage dubbing jobs"
  ON dubbing_jobs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_dubbing_jobs_updated_at
  BEFORE UPDATE ON dubbing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
