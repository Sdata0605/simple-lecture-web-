import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SUPABASE_DIRECT_URL } from "@/lib/supabaseUrl";

const DEFAULT_BASE = "http://116.202.230.124:8090";
const PROXY_URL = `${SUPABASE_DIRECT_URL}/functions/v1/athena-proxy`;

export interface AthenaSubject {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  documents?: number;
  chunks?: number;
}

export interface AthenaChapter {
  id: string;
  title: string;
  chapter_number?: number | null;
}

export interface AthenaTopic {
  id: string;
  title: string;
  // The upstream Athena API 500s if topic_number is sent as a JSON number —
  // it only accepts a string (see useCreateAthenaTopic below). Keep the read
  // side widened to match what actually comes back.
  topic_number?: string | number | null;
}

export interface AthenaDocument {
  id: string;
  title?: string;
  filename: string;
  status: "ready" | "processing" | "failed" | "low_extraction";
  total_chunks?: number;
  error_message?: string | null;
  created_at?: string;
}

export interface AthenaQuestion {
  answer_id: string;
  question_text: string;
  chapter_id?: string | null;
  chapter_title?: string | null;
  topic_id?: string | null;
  topic_title?: string | null;
  usage_count?: number;
  created_at?: string;
  video_ready?: boolean | null;
}

export interface AthenaQuestionCounts {
  subject_id: string;
  total: number;
  untagged: number;
  by_chapter: Array<{
    chapter_id: string;
    chapter_title: string;
    chapter_number?: number;
    count: number;
    by_topic: Array<{ topic_id: string; topic_title: string; count: number }>;
  }>;
}

function buildUrl(
  path: string,
  params?: Record<string, string | number | undefined>,
  base: string = DEFAULT_BASE,
) {
  const search = new URLSearchParams();
  search.set("path", path);
  search.set("base", base);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== "") search.set(k, String(v));
  });
  return `${PROXY_URL}?${search.toString()}`;
}

async function parseJsonResponse(res: Response) {
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // keep raw text if not JSON
  }
  if (!res.ok) {
    throw new Error(
      typeof body === "string"
        ? body
        : body?.error || body?.detail || body?.message || `Request failed (${res.status})`,
    );
  }
  return body;
}

// Exported (not just used by the hooks below) so imperative bulk flows —
// e.g. ImportSubjectToAthenaDialog's sequential import pipeline — can call
// the Athena API directly without going through React Query mutations.
export async function athenaGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const res = await fetch(buildUrl(path, params));
  return parseJsonResponse(res);
}

export async function athenaPostJson<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(res);
}

export async function athenaUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(buildUrl(path), { method: "POST", body: formData });
  return parseJsonResponse(res);
}

// ---------------- Subjects ----------------

export function useAthenaSubjects() {
  return useQuery({
    queryKey: ["athena", "subjects"],
    queryFn: () => athenaGet<{ subjects: AthenaSubject[] }>("/subjects").then((d) => d.subjects ?? []),
    staleTime: 15_000,
  });
}

export function useCreateAthenaSubject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; slug?: string; description?: string }) =>
      athenaPostJson<AthenaSubject>("/subjects", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["athena", "subjects"] }),
  });
}

// ---------------- Chapters ----------------

export function useAthenaChapters(subjectId?: string) {
  return useQuery({
    queryKey: ["athena", "chapters", subjectId],
    queryFn: () =>
      athenaGet<{ chapters: AthenaChapter[] }>(`/subjects/${subjectId}/chapters`).then((d) => d.chapters ?? []),
    enabled: !!subjectId,
  });
}

export function useCreateAthenaChapter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { subjectId: string; title: string; chapterNumber?: number }) =>
      athenaPostJson<AthenaChapter>("/chapters", payload),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["athena", "chapters", vars.subjectId] }),
  });
}

// ---------------- Topics ----------------

export function useAthenaTopics(chapterId?: string) {
  return useQuery({
    queryKey: ["athena", "topics", chapterId],
    queryFn: () => athenaGet<{ topics: AthenaTopic[] }>(`/chapters/${chapterId}/topics`).then((d) => d.topics ?? []),
    enabled: !!chapterId,
  });
}

export function useCreateAthenaTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ topicNumber, ...payload }: { chapterId: string; title: string; topicNumber?: number | string }) =>
      // Upstream 500s on a JSON number here — it only accepts topic_number as
      // a string (confirmed by direct testing against the Athena API).
      athenaPostJson<AthenaTopic>("/topics", {
        ...payload,
        topicNumber: topicNumber !== undefined && topicNumber !== "" ? String(topicNumber) : undefined,
      }),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["athena", "topics", vars.chapterId] }),
  });
}

// ---------------- Documents ----------------

export function useAthenaDocuments(subjectId?: string) {
  return useQuery({
    queryKey: ["athena", "documents", subjectId],
    queryFn: () =>
      athenaGet<{ documents: AthenaDocument[] }>(`/subjects/${subjectId}/documents`).then((d) => d.documents ?? []),
    enabled: !!subjectId,
    refetchInterval: (q) => {
      const rows = (q.state.data as AthenaDocument[] | undefined) ?? [];
      return rows.some((r) => r.status === "processing") ? 4000 : false;
    },
  });
}

export function useUploadAthenaDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { files: File[]; subjectId: string; chapterId?: string; topicId?: string }) => {
      const fd = new FormData();
      vars.files.forEach((f) => fd.append("files", f));
      fd.append("subjectId", vars.subjectId);
      if (vars.chapterId) fd.append("chapterId", vars.chapterId);
      if (vars.topicId) fd.append("topicId", vars.topicId);
      return athenaUpload<{ uploaded: Array<{ filename: string; document_id: string; status: string }> }>(
        "/documents",
        fd,
      );
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["athena", "documents", vars.subjectId] }),
  });
}

// ---------------- Questions ----------------

export interface AthenaQuestionsFilters {
  chapterId?: string;
  topicId?: string;
  q?: string;
  sort?: "popular" | "recent";
  limit?: number;
  offset?: number;
}

export function useAthenaQuestions(subjectId?: string, filters: AthenaQuestionsFilters = {}, live = true) {
  return useQuery({
    queryKey: ["athena", "questions", subjectId, filters],
    queryFn: () =>
      athenaGet<{ total: number; limit: number; offset: number; questions: AthenaQuestion[] }>(
        `/subjects/${subjectId}/questions`,
        {
          chapter_id: filters.chapterId,
          topic_id: filters.topicId,
          q: filters.q,
          sort: filters.sort,
          limit: filters.limit,
          offset: filters.offset,
        },
      ),
    enabled: !!subjectId,
    refetchInterval: live ? 5000 : false,
  });
}

export function useAthenaQuestionCounts(subjectId?: string, live = true) {
  return useQuery({
    queryKey: ["athena", "question-counts", subjectId],
    queryFn: () => athenaGet<AthenaQuestionCounts>(`/subjects/${subjectId}/question-counts`),
    enabled: !!subjectId,
    refetchInterval: live ? 8000 : false,
  });
}
