// Shown inside the Ask AI screen when it was opened without a subject (the floating AI logo, say): the
// student picks what they want to be taught, then the live lesson starts.
import { Loader2, Sparkles } from "lucide-react";
import type { TeacherSubject } from "@/lib/aiTeacherApi";

export interface SubjectPickerProps {
  /** null while the list is still loading. */
  subjects: TeacherSubject[] | null;
  failed?: boolean;
  /** subject id -> names of the courses it belongs to, shown in small letters under the subject's name. */
  courses?: Record<string, string[]>;
  /** The subject the student was on, when the teacher cannot teach it yet. */
  unknown?: string | null;
  onPick: (subject: TeacherSubject) => void;
  onRetry?: () => void;
}

export function SubjectPicker({ subjects, failed, courses, unknown, onPick, onRetry }: SubjectPickerProps) {
  if (failed) {
    return (
      <main className="aa-center">
        <div className="aa-gate">
          <h2>Could not reach your teacher</h2>
          <p>Please check your internet connection and try again.</p>
          {onRetry && (
            <button type="button" className="aa-action" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      </main>
    );
  }

  if (subjects === null) {
    return (
      <main className="aa-center">
        <div className="aa-gate">
          <span className="aa-mic-chip" aria-hidden="true">
            <Loader2 size={16} className="animate-spin" />
          </span>
          <h2>Getting your teacher ready…</h2>
        </div>
      </main>
    );
  }

  if (subjects.length === 0) {
    return (
      <main className="aa-center">
        <div className="aa-gate">
          <h2>Your AI teacher is not ready yet</h2>
          <p>No subjects have been set up for the AI teacher so far. Please check back soon.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="aa-center">
      <div className="aa-gate aa-picker">
        <span className="aa-mic-chip" aria-hidden="true">
          <Sparkles size={16} />
        </span>
        <h2>What do you want to study?</h2>
        <p>
          {unknown
            ? `Your AI teacher cannot teach ${unknown} yet. Pick one of these subjects.`
            : "Pick a subject and ask your doubt out loud. Your AI teacher explains it from the basics."}
        </p>
        <div className="aa-picker__list">
          {subjects.map((subject) => (
            <button key={subject.id} type="button" className="aa-picker__item" onClick={() => onPick(subject)}>
              <span className="aa-picker__name">
                {subject.name}
                {courses?.[subject.id] && <small className="aa-picker__course">{courses[subject.id].join(" · ")}</small>}
              </span>
              <small className="aa-picker__topics">{subject.topics === 1 ? "1 topic" : `${subject.topics} topics`}</small>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
