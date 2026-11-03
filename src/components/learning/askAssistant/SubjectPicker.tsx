// Shown inside the Ask AI screen when it was opened without a subject (the floating AI logo, say): the
// student picks what they want to be taught, then the live lesson starts.
import type { ComponentType } from "react";
import { ArrowRight, BookOpen, Calculator, Earth, FlaskConical, Library, Lightbulb, Loader2, Rocket, School, Telescope, type LucideProps } from "lucide-react";
import type { TeacherSubject } from "@/lib/aiTeacherApi";
import { lookFor } from "@/lib/askSubjectLook";
import { RobotFace } from "./RobotFace";

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

// Only the icons subjectLook can name, so the bundle does not pull in the whole icon set.
const ICONS: Record<string, ComponentType<LucideProps>> = {
  Earth,
  Calculator,
  FlaskConical,
  Library,
  Lightbulb,
  School,
  BookOpen,
  Rocket,
  Telescope,
};

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
        <RobotFace size={140} />
        <h2>
          What do you want to <span className="aa-accent">study?</span>
        </h2>
        <p>
          {unknown
            ? `Your AI teacher cannot teach ${unknown} yet. Pick one of these subjects.`
            : "Pick a subject and ask your doubt out loud. Your AI teacher explains it from the basics."}
        </p>
        <div className="aa-picker__list">
          {subjects.map((subject) => {
            const look = lookFor(subject.name);
            const Icon = ICONS[look.icon] ?? BookOpen;
            const course = courses?.[subject.id]?.join(" · ");
            return (
              <button
                key={subject.id}
                type="button"
                className="aa-subject-card"
                style={{ border: `1px solid ${look.border}`, background: `linear-gradient(135deg, ${look.from}, ${look.to})` }}
                onClick={() => onPick(subject)}
              >
                <span className="aa-subject-card__icon" aria-hidden="true">
                  <Icon size={84} />
                </span>
                <span className="aa-subject-card__name">{subject.name}</span>
                {course && <span className="aa-subject-card__course">{course}</span>}
                <span className="aa-subject-card__topics">
                  <BookOpen size={15} aria-hidden="true" />
                  <span>{subject.topics === 1 ? "1 topic" : `${subject.topics} topics`}</span>
                </span>
                <span className="aa-subject-card__go" style={{ background: look.accent }} aria-hidden="true">
                  <ArrowRight size={18} color="#fff" />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}
