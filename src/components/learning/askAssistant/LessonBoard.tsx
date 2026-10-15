// The lesson board: what the student asked, a progress bar, and the teacher's explanation as steps that
// appear one by one (basics, build up, example, answer; a question to solve only if the student wants one). The newest step is open
// and scrolled into view; earlier steps fold into a single line the student can reopen. Cards stay mounted
// while folded so a picked answer is not lost.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, HelpCircle, Sparkles } from "lucide-react";
import type { Lesson, LessonCard } from "@/lib/aiTeacherLecture";
import { CardBody, type CardActions } from "./LessonCards";

const MIN_EXPLAIN_PILLS = 4;

interface Pill {
  key: string;
  label: string;
  state: "done" | "now" | "todo";
  target: number | null;
  turn?: boolean;
}

/** Progress along the usual path: basics, build up, example, answer (and "your turn", once the student asked for a question). */
function pillsFor(lesson: Lesson): Pill[] {
  const last = lesson.cards[lesson.cards.length - 1];
  const onTurn = last?.role === "turn";
  const current = last?.step ?? lesson.explainCount;
  const pills: Pill[] = [];
  for (let i = 1; i <= Math.max(MIN_EXPLAIN_PILLS, lesson.explainCount); i++) {
    const target = lesson.cards.find((c) => c.step === i)?.id ?? null;
    pills.push({ key: `s${i}`, label: String(i), target, state: onTurn || i < current ? "done" : i === current ? "now" : "todo" });
  }
  // No question is promised up front: the "?" step only appears when the student has taken a question.
  const turn = lesson.cards.find((c) => c.role === "turn");
  if (turn) pills.push({ key: "turn", label: "?", turn: true, target: turn.id, state: onTurn ? "now" : "todo" });
  return pills;
}

function eyebrow(item: LessonCard): string {
  if (item.step !== null) return `Step ${item.step}`;
  return item.role === "notes" ? "Notes" : "Your turn";
}

function title(item: LessonCard): string {
  if (item.role === "notes") return "Study notes";
  return item.role === "turn" && item.card.kind === "quiz" ? "Quick question" : item.label;
}

export function LessonBoard({ lesson, actions }: { lesson: Lesson; actions: CardActions }) {
  const { cards, question } = lesson;
  const latest = cards.length ? cards[cards.length - 1].id : null;
  const [openId, setOpenId] = useState<number | null>(latest);
  const boardRef = useRef<HTMLDivElement>(null);

  // Follow the teacher: the newest step opens and scrolls into view.
  useEffect(() => {
    setOpenId(latest);
    if (latest === null) return;
    const el = boardRef.current?.querySelector(`[data-card="${latest}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [latest]);

  if (cards.length === 0) {
    return (
      <div className="lb-empty">
        <span className="aa-mic-chip" aria-hidden="true"><Sparkles size={16} /></span>
        <h2>Ask me anything</h2>
        <p>I'll explain it from the very basics, one step at a time, so you really understand it.</p>
        <div className="lb-empty__path" aria-hidden="true">
          <span>1 The basics</span>
          <span>2 Build up</span>
          <span>3 Example</span>
          <span>4 Answer</span>
        </div>
      </div>
    );
  }

  const pills = pillsFor(lesson);
  const open = (id: number | null) => {
    if (id === null) return;
    setOpenId(id);
    boardRef.current?.querySelector(`[data-card="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div ref={boardRef} className={lesson.math ? "lb-board--math" : undefined}>
      {question && (
        <p className="lb-ask">
          <span>You asked</span>
          {question}
        </p>
      )}

      <div className="lb-progress" role="group" aria-label="Lesson progress">
        {pills.map((pill) => (
          <button
            key={pill.key}
            type="button"
            className={`lb-pill is-${pill.state}`}
            disabled={pill.target === null}
            aria-label={pill.turn ? "Your turn" : `Step ${pill.label}`}
            aria-current={pill.state === "now" ? "step" : undefined}
            onClick={() => open(pill.target)}
          >
            {pill.state === "done" && !pill.turn ? <Check size={13} aria-hidden="true" /> : pill.turn ? <HelpCircle size={14} aria-hidden="true" /> : pill.label}
          </button>
        ))}
      </div>

      {cards.map((item, index) => {
        // A maths solution stays open from start to finish: each line of working follows from the one above.
        const isOpen = lesson.math || openId === item.id;
        const past = index < cards.length - 1;
        const head = (
          <>
            <span className="lb-step__badge" aria-hidden="true">
              {past && item.role !== "notes" && !lesson.math ? <Check size={15} /> : item.step ?? (item.role === "notes" ? "•" : "?")}
            </span>
            <span className="lb-step__label">
              <i>{eyebrow(item)}</i>
              {title(item)}
            </span>
          </>
        );
        return (
          <section
            key={item.id}
            data-card={item.id}
            className={`lb-step lb-step--${item.role}${isOpen ? " is-open" : ""}${past ? " is-past" : " is-current"}`}
          >
            {lesson.math ? (
              <div className="lb-step__head lb-step__head--static">{head}</div>
            ) : (
              <button type="button" className="lb-step__head" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : item.id)}>
                {head}
                <ChevronDown className="lb-step__chev" size={18} aria-hidden="true" />
              </button>
            )}
            <div className="lb-step__body" hidden={!isOpen}>
              <CardBody item={item} actions={actions} math={lesson.math} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
