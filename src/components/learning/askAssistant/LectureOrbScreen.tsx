// The orb screen of the lecture player's Ask AI: a big orb that listens and speaks, live captions, and
// the quiz / visual cards the teacher puts on screen. Everything the student hears is the live AI Teacher's
// own voice; this component only shows what `deriveLectureView` says is happening. It renders as the
// middle and bottom rows of the `.aa-overlay` grid.
import { useState, type FormEvent } from "react";
import { Keyboard, Mic, MicOff, Send, X } from "lucide-react";
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

export function LectureOrbScreen({ view, live, getLevel, onOrbClick, onSend }: LectureOrbScreenProps) {
  const [typed, setTyped] = useState("");
  const [dismissedCard, setDismissedCard] = useState<number | null>(null);
  const card = view.card && view.card.id !== dismissedCard ? view.card : null;

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
      <main className="aa-center">
        <div className="aa-orb-wrap">
          <VoiceOrb
            mode={view.orbMode}
            getLevel={getLevel}
            // Smaller when a card needs the room.
            size={card ? 120 : 200}
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

        {card && (
          <div className="relative max-h-[34vh] w-[min(640px,100%)] overflow-y-auto rounded-2xl bg-background p-2.5 text-left text-foreground shadow-xl">
            <button
              type="button"
              onClick={() => setDismissedCard(card.id)}
              aria-label="Close this card"
              className="absolute right-1.5 top-1.5 z-10 rounded-full p-1 text-muted-foreground hover:bg-muted"
            >
              <X size={14} />
            </button>
            <CardBody card={card} live={live} />
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
