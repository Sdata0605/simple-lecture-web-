import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DubbedLanguageEntry {
  lang: string;
  video_path: string;
}

export interface DubbingJob {
  id: string;
  video_job_id: string | null;
  external_job_id: string;
  subject_id: string | null;
  document_name: string | null;
  languages: string[];
  speaker: string;
  tts_engine: string;
  status: string;
  progress_message: string | null;
  error_message: string | null;
  dubbed_languages: DubbedLanguageEntry[] | null;
  server_ip: string | null;
  created_at: string;
  updated_at: string;
}

// All dubbing runs ever triggered for a subject — backs the Dubbing tab's
// "Status" view. Polls only while something is actually in progress.
export function useDubbingJobs(subjectId?: string) {
  return useQuery({
    queryKey: ['dubbing-jobs', subjectId],
    queryFn: async () => {
      let query = supabase
        .from('dubbing_jobs')
        .select('*')
        .order('created_at', { ascending: false });
      if (subjectId) query = query.eq('subject_id', subjectId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as DubbingJob[];
    },
    enabled: !!subjectId,
    refetchInterval: (query) => {
      const hasActive = query.state.data?.some((j) => j.status === 'processing');
      return hasActive ? 5000 : false;
    },
  });
}

export function useDubbingJobMutations() {
  const queryClient = useQueryClient();

  const invalidate = (subjectId?: string) => {
    queryClient.invalidateQueries({ queryKey: ['dubbing-jobs', subjectId] });
  };

  const createDubbingJob = async (job: {
    video_job_id: string;
    external_job_id: string;
    subject_id: string;
    document_name: string | null;
    languages: string[];
    speaker: string;
    tts_engine: string;
    server_ip: string;
  }) => {
    const { data, error } = await supabase
      .from('dubbing_jobs')
      .insert([{ ...job, status: 'processing' } as never])
      .select()
      .single();
    if (error) throw error;
    invalidate(job.subject_id);
    return data as unknown as DubbingJob;
  };

  const updateDubbingJob = async (
    id: string,
    patch: Partial<Pick<DubbingJob, 'status' | 'progress_message' | 'error_message' | 'dubbed_languages'>>,
    subjectId?: string,
  ) => {
    const { error } = await supabase
      .from('dubbing_jobs')
      .update(patch as never)
      .eq('id', id);
    if (error) throw error;
    invalidate(subjectId);
  };

  return { createDubbingJob, updateDubbingJob };
}
