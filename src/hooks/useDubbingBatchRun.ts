import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DubbingBatchItemStatus = "queued" | "processing" | "completed" | "stopped";

export interface DubbedLanguageEntry {
  lang: string;
  video_path: string;
}

export interface DubbingBatchItem {
  topicId: string;
  topicTitle: string;
  chapterTitle?: string;
  videoJobId: string;
  externalJobId: string;
  documentName?: string | null;
  serverIp: string;
  status: DubbingBatchItemStatus;
  progressMessage?: string;
  errorMessage?: string;
  dubbedLanguages?: DubbedLanguageEntry[];
}

export interface DubbingBatchRun {
  id: string;
  subject_id: string;
  subject_name: string;
  server_ip: string;
  status: "running" | "stopped" | "completed" | "failed";
  items: DubbingBatchItem[];
  current_index: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_tick_at: string | null;
  pipeline_config: {
    languages: string[];
    speaker: string;
    tts_engine: string;
    avatar_id?: string;
    skip_avatar?: boolean;
    skip_section_merge?: boolean;
    skip_final_merge?: boolean;
  } | null;
}

const KIND = "dubbing_batch";

// Same auto_submission_runs table + claim RPC the lecture/marketing pipeline
// uses, filtered to kind='dubbing_batch' — a genuinely server-driven queue
// (ticked every minute by pg_cron, see the dubbing-batch-tick migration),
// not dependent on this hook's own polling to make progress happen.
export function useDubbingBatchRun(subjectId: string | undefined) {
  const qc = useQueryClient();
  const key = ["dubbing-batch-run", subjectId];

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<DubbingBatchRun | null> => {
      if (!subjectId) return null;
      const { data } = await supabase
        .from("auto_submission_runs" as any)
        .select("*")
        .eq("subject_id", subjectId)
        .eq("kind", KIND)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as any) ?? null;
    },
    enabled: !!subjectId,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!subjectId) return;
    const channel = supabase
      .channel(`dubbing_batch_runs_${subjectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "auto_submission_runs", filter: `subject_id=eq.${subjectId}` },
        () => qc.invalidateQueries({ queryKey: key }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);

  const stopRun = async (id: string) => {
    await supabase.from("auto_submission_runs" as any).update({ status: "stopped" }).eq("id", id);
    qc.invalidateQueries({ queryKey: key });
  };

  const dismissRun = async (id: string) => {
    await supabase.from("auto_submission_runs" as any).delete().eq("id", id);
    qc.invalidateQueries({ queryKey: key });
  };

  const resumeRun = async (id: string) => {
    const { data } = await supabase
      .from("auto_submission_runs" as any)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    const r: any = data;
    if (!r) return;
    const items: DubbingBatchItem[] = Array.isArray(r.items) ? [...r.items] : [];

    let resumeIdx = items.findIndex((it) => it.status === "stopped");
    if (resumeIdx === -1) resumeIdx = r.current_index ?? 0;

    const target = items[resumeIdx];
    if (target) {
      items[resumeIdx] = {
        topicId: target.topicId,
        topicTitle: target.topicTitle,
        chapterTitle: target.chapterTitle,
        videoJobId: target.videoJobId,
        externalJobId: target.externalJobId,
        documentName: target.documentName,
        serverIp: target.serverIp,
        status: "queued",
      };
    }

    await supabase
      .from("auto_submission_runs" as any)
      .update({
        items,
        current_index: resumeIdx,
        status: "running",
        last_tick_at: null, // bypass the 25s claim cooldown
      })
      .eq("id", id);

    try {
      await supabase.functions.invoke("dubbing-batch-tick", { body: {} });
    } catch { /* cron will pick it up within a minute regardless */ }

    qc.invalidateQueries({ queryKey: key });
  };

  return { run: query.data ?? null, isLoading: query.isLoading, stopRun, dismissRun, resumeRun };
}
