// The Ask AI screen of the lecture player. Everything the student hears is the live AI Teacher's own voice;
// this component only shows what is happening.
//   - Laptops and tablets: the lesson board on the left (the question, then the explanation as steps, from
//     the basics to the answer and a question to solve) and the teacher on the right (orb, captions, quick
//     buttons, type box).
//   - Phones: one step at a time with the orb docked small underneath; before the first step the orb is big.
// It is the content of the `.aa-overlay` grid below the top bar.
import { useEffect, useState, type FormEvent } from "react";
import { Keyboard, Mic, MicOff, Send } from "lucide-react";
import { QUICK_REQUESTS, type Lesson, type LectureView } from "@/lib/aiTeacherLecture";
import type { useLiveTeacher } from "@/components/aiteacher/useLiveTeacher";
import { LessonBoard } from "./LessonBoard";
import type { CardActions } from "./LessonCards";
import { VoiceOrb } from "./VoiceOrb";
import "./ask-assistant.css";
import "./lesson-board.css";

type Live = ReturnType<typeof useLiveTeacher>;

export interface LectureOrbScreenProps {
  view: LectureView;
  lesson: Lesson;
  /** Only what the screen reads from the live teacher. */
  live: Pick<Live, "error" | "notice" | "muted" | "micAvailable"> & CardActions;
  /** Read every animation frame by the orb: 0..1. */
  getLevel: () => number;
  onOrbClick: () => void;
  onSend: (text: string) => void;
  /** A quick button: the prompt goes to the teacher without showing up as the student's question. */
  onQuick: (prompt: string) => void;
}

const WIDE = "(min-width: 900px)";

/** True on laptops and tablets, where the board and the teacher sit side by side. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE).matches ?? true);
  useEffect(() => {
    const query = window.matchMedia?.(WIDE);
    if (!query) return;
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

export function LectureOrbScreen({ view, lesson, live, getLevel, onOrbClick, onSend, onQuick }: LectureOrbScreenProps) {
  const wide = useWide();
  const [typed, setTyped] = useState("");
  const hasBoard = lesson.cards.length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = typed.trim();
    if (!text || !view.canType) return;
    setTyped("");
    onSend(text);
  };

  const problem = live.error || live.notice;
  const micLive = view.orbMode === "listening";
  // Big in the split layout, and on a phone before the first step; docked small once the board is showing.
  const orbSize = wide ? 170 : hasBoard ? 56 : 190;

  return (
    <main className={`aa-stage${hasBoard ? " has-board" : ""}`}>
      <section className="aa-board" aria-label="Lesson board">
        <LessonBoard lesson={lesson} actions={live} />
      </section>

      <aside className="aa-teacher" aria-label="Your teacher">
        <div className="aa-orb-wrap">
          <VoiceOrb
            mode={view.orbMode}
            getLevel={getLevel}
            size={orbSize}
            onClick={view.orbAction === "none" ? undefined : onOrbClick}
            ariaLabel={view.orbLabel}
          />
        </div>

        <div className="aa-text" aria-live="polite">
          {problem && <p className="aa-notice">{problem}</p>}
          {view.status && <p className={`aa-status${view.statusTone === "hearing" ? " is-hearing" : ""}`}>{view.status}</p>}
          {view.studentLine?.live && <p className="aa-transcript">{view.studentLine.text}</p>}
          {/* Once the board is up, the question sits at the top of it instead. */}
          {view.studentLine && !view.studentLine.live && !hasBoard && (
            <p className="aa-question">
              <span>You asked</span>
              {view.studentLine.text}
            </p>
          )}
          {view.teacherCaption && <p className="aa-caption">{view.teacherCaption}</p>}
        </div>

        {view.inCall && (
          <div className="aa-chips" role="group" aria-label="Quick requests">
            {QUICK_REQUESTS.map((request) => (
              <button key={request.id} type="button" className="aa-chip" onClick={() => onQuick(request.prompt)}>
                {request.label}
              </button>
            ))}
          </div>
        )}

        <form className="aa-composer" onSubmit={submit}>
          <span className={`aa-mic-chip${micLive ? " is-live" : ""}`} aria-hidden="true">
            {micLive ? <Mic size={15} /> : !live.micAvailable || live.muted ? <MicOff size={15} /> : <Keyboard size={15} />}
          </span>
          <input
            className="aa-input"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Prefer typing? Ask your question here…"
            aria-label="Type your question"
            disabled={!view.canType}
            maxLength={500}
            enterKeyHint="send"
          />
          <button type="submit" className="aa-send" disabled={!typed.trim() || !view.canType} aria-label="Send question">
            <Send size={17} />
          </button>
        </form>
      </aside>
    </main>
  );
}
