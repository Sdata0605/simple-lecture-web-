import { supabase } from "@/integrations/supabase/client";

export interface TeacherSubject { id: string; name: string; topics: number }
export interface OutlineTopic { id: string; title: string }
export interface OutlineChapter { id: string; title: string; topics: OutlineTopic[] }

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
  subject: { id: string; name: string };
}

export class TeacherApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}

/** Calls the public `ai-teacher` edge function. No login needed. */
export async function teacherApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ai-teacher", { body: { action, ...body } });
  if (error) {
    let message = "Something went wrong. Please try again.";
    let status: number | undefined;
    const res = (error as any).context as Response | undefined;
    if (res) {
      status = res.status;
      try { const j = await res.json(); if (j?.error) message = j.error; } catch { /* keep default */ }
    }
    throw new TeacherApiError(message, status);
  }
  if (data?.error) throw new TeacherApiError(String(data.error));
  return data as T;
}
