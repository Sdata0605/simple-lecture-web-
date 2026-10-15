// One "Ask AI" for the whole site. The lecture player's Ask AI screen (AskAIAssistant) is the only Ask AI there
// is: every button that offers it (the floating AI logo, the Learning sidebar and tabs, a subject card...) just
// calls openAskAI() and <AskAIHost /> shows that screen. Kept free of heavy imports so any component can use it.
import { useSyncExternalStore } from "react";
import type { TeacherSubject } from "./aiTeacherApi";
import { matchSubjectByName } from "./aiTeacherSubjects";

/** What the button knows about where the student is. All optional: the screen asks for whatever is missing. */
export interface AskAIRequest {
  subjectId?: string | null;
  subjectName?: string | null;
  topicTitle?: string | null;
}

let current: AskAIRequest | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function openAskAI(request: AskAIRequest = {}): void {
  current = { ...request };
  emit();
}

export function closeAskAI(): void {
  if (current === null) return;
  current = null;
  emit();
}

/** The open request, or null while Ask AI is closed. */
export function useAskAIRequest(): AskAIRequest | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

export type SubjectChoice =
  | { kind: "subject"; subject: TeacherSubject }
  /** The student has to pick; `unknown` is the subject they were on when it is not one the teacher can teach. */
  | { kind: "pick"; unknown: string | null };

/**
 * Which subject Ask AI teaches. The one the student is on if the teacher knows it, the only one there is,
 * otherwise the student picks (and is told when the subject they were on is not available yet).
 */
export function chooseSubject(request: AskAIRequest, subjects: TeacherSubject[]): SubjectChoice {
  const byId = request.subjectId ? subjects.find((s) => s.id === request.subjectId) : undefined;
  const name = request.subjectName?.trim() || null;
  const subject = byId ?? (name ? matchSubjectByName(name, subjects) : null);
  if (subject) return { kind: "subject", subject };
  if (subjects.length === 1 && !request.subjectId && !name) return { kind: "subject", subject: subjects[0] };
  return { kind: "pick", unknown: name };
}
