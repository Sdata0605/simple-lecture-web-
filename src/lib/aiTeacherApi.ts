import { supabase } from "@/integrations/supabase/client";

export interface TeacherSubject { id: string; name: string; topics: number }
export interface OutlineTopic { id: string; label: string; title: string }
export interface OutlineChapter { id: string; number: number; title: string; topics: OutlineTopic[] }
/** A subject with its whole numbered syllabus (sent with the voice session). */
export interface CatalogSubject { id: string; name: string; chapters: OutlineChapter[] }

export interface TeacherReference {
  id: string;
  topic_id: string | null;
  heading_path: string;
  content: string;
  chapter_title: string | null;
  topic_title: string | null;
  score: number;
}
export interface TeacherDocument { title: string; url: string; kind: string }
export interface BankQuestion {
  id: string;
  text: string;
  options: { key: string; text: string }[];
  correct: string;
  explanation: string | null;
}
export interface RetrievalResult {
  found: boolean;
  references: TeacherReference[];
  topics: { topic_id: string; chapter_title: string | null; topic_title: string | null; summary: string | null }[];
  documents: TeacherDocument[];
  questions: BankQuestion[];
}
export interface ChatResult extends RetrievalResult { answer: string }
export interface LiveSession {
  token: string;
  apiVersion: string;
  lockLevel: string;
  model: string;
  voiceName: string;
  teacherName: string;
  systemInstruction: string;
  subjects: TeacherSubject[];
  catalog: CatalogSubject[];
  /** Tool declarations locked into the token; the live connection must reuse them as-is. */
  tools: unknown[];
}

export class TeacherApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}

/** Calls the public `ai-teacher` edge function. No login needed. */
export async function teacherApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  // One quiet retry for connection problems (the request never reached the function, or a gateway
  // hiccuped without a JSON answer). Real answers from the function are never retried.
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await supabase.functions.invoke("ai-teacher", { body: { action, ...body } });
    if (!error) {
      if (data?.error) throw new TeacherApiError(String(data.error));
      return data as T;
    }
    let message = "";
    let status: number | undefined;
    const res = (error as any).context as Response | undefined;
    if (res && typeof res.json === "function") {
      status = res.status;
      try { const j = await res.json(); if (j?.error) message = String(j.error); } catch { /* not JSON */ }
    }
    if (message) throw new TeacherApiError(message, status);   // an answer from the function itself
    if (attempt < 2) { await new Promise((r) => setTimeout(r, 800)); continue; }
    throw new TeacherApiError(
      status ? "The teacher is not responding right now. Please try again." : "Connection problem. Please check your internet and try again.",
      status,
    );
  }
}
