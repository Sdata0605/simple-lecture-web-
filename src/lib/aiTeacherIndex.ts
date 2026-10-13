// Admin-side client for the ai-teacher-index edge function: keeps the AI Teacher's knowledge index
// (what the teacher can teach, on the website and in the mobile app) in step with published lectures.
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface IndexCoverageRow {
  subject_id: string;
  name: string;
  courses: string[];
  topics_indexed: number;     // topic routing cards; the teacher only offers subjects that have some
  eligible: number;           // published lectures that have markdown
  indexed: number;
  pending: number;
  unpublished_with_markdown: number;
  stale: number;              // indexed lectures that are no longer published
}

export interface IndexProgress {
  eligible: number;
  remaining: number;
  indexed: number;
  unchanged: number;
  pruned: number;
  skipped: { document_id: string; reason?: string }[];
  failed: { document_id: string; error: string }[];
}

interface IndexSubjectResponse {
  eligible: number;
  attempted: string[];
  indexed: number;
  unchanged: number;
  skipped: { document_id: string; reason?: string }[];
  failed: { document_id: string; error: string }[];
  pruned: number;
  remaining: number;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ai-teacher-index", { body });
  if (error) {
    let message = error.message;
    try {
      const detail = await (error as { context?: Response }).context?.json?.();
      if (detail?.error) message = detail.error;
    } catch { /* keep the generic message */ }
    throw new Error(message);
  }
  return data as T;
}

export async function fetchIndexCoverage(): Promise<IndexCoverageRow[]> {
  return (await call<{ subjects: IndexCoverageRow[] }>({ action: "coverage" })).subjects;
}

/** Indexes every pending published lecture of a subject, looping over time-boxed server calls. */
export async function indexSubject(
  subjectId: string,
  opts: { force?: boolean; onProgress?: (p: IndexProgress) => void } = {},
): Promise<IndexProgress> {
  const total: IndexProgress = { eligible: 0, remaining: 0, indexed: 0, unchanged: 0, pruned: 0, skipped: [], failed: [] };
  const exclude: string[] = [];
  for (let round = 0; round < 200; round++) {
    const r = await call<IndexSubjectResponse>({ action: "index_subject", subject_id: subjectId, force: !!opts.force, exclude_ids: exclude });
    exclude.push(...r.attempted);
    total.eligible = r.eligible;
    total.remaining = r.remaining;
    total.indexed += r.indexed;
    total.unchanged += r.unchanged;
    total.pruned += r.pruned;
    total.skipped.push(...r.skipped);
    total.failed.push(...r.failed);
    opts.onProgress?.({ ...total });
    if (r.remaining <= 0 || r.attempted.length === 0) break;
  }
  return total;
}

const FALLBACK_HINT = "Open Admin → Settings → AI Teacher knowledge index and press Index.";

/** Fire-and-forget after a lecture is published: never blocks or fails the publish itself. */
export function indexJobAfterPublish(jobId: string): void {
  call<{ status: string; reason?: string }>({ action: "index_document", job_id: jobId })
    .then((r) => {
      if (r.status === "indexed") toast.success("AI Teacher can now teach this lecture");
      else if (r.status === "skipped") toast.info(`AI Teacher skipped this lecture: ${r.reason ?? "nothing to index"}`);
    })
    .catch((e: Error) => {
      console.error("[ai-teacher-index] index_document failed", e);
      toast.warning(`Published, but the AI Teacher could not learn it yet (${e.message}). ${FALLBACK_HINT}`);
    });
}

/** Fire-and-forget after a lecture is unpublished: the teacher must not teach unpublished content. */
export function removeJobIndexAfterUnpublish(jobId: string): void {
  call({ action: "remove_document", job_id: jobId }).catch((e: Error) => {
    console.error("[ai-teacher-index] remove_document failed", e);
    toast.warning(`Unpublished, but the AI Teacher index was not cleaned (${e.message}). ${FALLBACK_HINT}`);
  });
}

/** After a bulk publish: index everything that is still pending for the subject, with a progress toast. */
export async function indexSubjectAfterBulkPublish(subjectId: string): Promise<void> {
  const id = toast.loading("Updating the AI Teacher with the newly published lectures…");
  try {
    const r = await indexSubject(subjectId, {
      onProgress: (p) => toast.loading(`Updating the AI Teacher… ${p.indexed + p.unchanged} done, ${p.remaining} left`, { id }),
    });
    if (r.failed.length) toast.warning(`AI Teacher updated, ${r.failed.length} lecture(s) failed. ${FALLBACK_HINT}`, { id });
    else toast.success(`AI Teacher updated (${r.indexed} lecture${r.indexed === 1 ? "" : "s"} indexed)`, { id });
  } catch (e) {
    console.error("[ai-teacher-index] index_subject failed", e);
    toast.warning(`Published, but the AI Teacher could not be updated (${(e as Error).message}). ${FALLBACK_HINT}`, { id });
  }
}
