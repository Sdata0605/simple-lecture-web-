// The orb screen of the lecture player's Ask AI: a big orb that listens and speaks, live captions, and
// the quiz / visual cards the teacher puts on screen. Everything the student hears is the live AI Teacher's
// own voice; this component only shows what `deriveLectureView` says is happening: the teacher's tools
// (emoji visuals, quizzes, questions to solve, understanding checks, slides, notes) appear as a stack of cards
// under the orb. It renders as the middle and bottom rows of the `.aa-overlay` grid.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Keyboard, Mic, MicOff, Send } from "lucide-react";
import type { LectureCard, LectureView } from "@/lib/aiTeacherLecture";
import type { useLiveTeacher } from "@/components/aiteacher/useLiveTeacher";
import { QuizCard } from "@/components/aiteacher/QuizCard";
import { BigQuestionCard, DocumentCard, UnderstandCard, VisualCard } from "@/components/aiteacher/Cards";
import { VoiceOrb } from "./VoiceOrb";
import "./ask-assistant.css";

type Live = ReturnType<typeof useLiveTeacher>;

export interface LectureOrbScreenProps {
  view: LectureView;
  /** Only what the screen reads from the live teacher. */
  live: Pick<Live, "error" | "notice" | "muted" | "micAvailable" | "reportQuizAnswer" | "reportUnderstanding" | "answerBigQuestion">;
  /** Read every animation frame by the orb: 0..1. */
  getLevel: () => number;
  onOrbClick: () => void;
  onSend: (text: string) => void;
}

const MAX_CARDS = 5;

export function LectureOrbScreen({ view, live, getLevel, onOrbClick, onSend }: LectureOrbScreenProps) {
  const [typed, setTyped] = useState("");
  // The last few cards stay on screen so a visual is still there when the quiz about it arrives.
  const cards = view.cards.slice(-MAX_CARDS);
  const stackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stackRef.current?.scrollTo({ top: stackRef.current.scrollHeight, behavior: "smooth" });
  }, [view.cards.length]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = typed.trim();
    if (!text || !view.canType) return;
    setTyped("");
    onSend(text);
  };

  const problem = live.error || live.notice;
  const micLive = view.orbMode === "listening";

  return (
    <>
      <main className={`aa-center${cards.length ? " has-cards" : ""}`}>
        <div className="aa-orb-wrap">
          <VoiceOrb
            mode={view.orbMode}
            getLevel={getLevel}
            // Smaller when cards need the room.
            size={cards.length ? 110 : 200}
            onClick={view.orbAction === "none" ? undefined : onOrbClick}
            ariaLabel={view.orbLabel}
          />
        </div>

        <div className="aa-text" aria-live="polite">
          {problem && <p className="aa-notice">{problem}</p>}
          {view.status && <p className={`aa-status${view.statusTone === "hearing" ? " is-hearing" : ""}`}>{view.status}</p>}
          {view.studentLine?.live && <p className="aa-transcript">{view.studentLine.text}</p>}
          {view.studentLine && !view.studentLine.live && (
            <p className="aa-question">
              <span>You asked</span>
              {view.studentLine.text}
            </p>
          )}
          {view.teacherCaption && <p className="aa-caption">{view.teacherCaption}</p>}
        </div>

        {cards.length > 0 && (
          <div
            ref={stackRef}
            className="min-h-0 w-[min(640px,100%)] shrink space-y-2.5 overflow-y-auto overscroll-contain rounded-2xl text-left text-foreground"
            aria-label="From your teacher"
          >
            {cards.map((card) => (
              <div key={card.id} className="rounded-2xl bg-background p-2.5 shadow-xl">
                <CardBody card={card} live={live} />
              </div>
            ))}
          </div>
        )}
      </main>

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
    </>
  );
}

function CardBody({ card, live }: { card: LectureCard; live: LectureOrbScreenProps["live"] }) {
  switch (card.kind) {
    case "quiz":
      return <QuizCard quiz={card.quiz} onAnswer={(i) => live.reportQuizAnswer(card.quiz, i)} />;
    case "visual":
      return <VisualCard visual={card.visual} />;
    case "understand":
      return <UnderstandCard topic={card.topic} onChoose={live.reportUnderstanding} />;
    case "bigq":
      return <BigQuestionCard question={card.question} hint={card.hint} onSubmit={live.answerBigQuestion} />;
    case "document":
      return <DocumentCard format={card.format} doc={card.doc} />;
    case "slide":
      return (
        <section className="p-1">
          <h3 className="mb-1.5 text-sm font-semibold text-emerald-900">{card.title}</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {card.bullets.map((bullet, i) => (
              <li key={i}>{bullet}</li>
            ))}
          </ul>
        </section>
      );
  }
}
