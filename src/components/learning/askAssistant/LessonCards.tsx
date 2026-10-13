// The lesson board's cards, in the orb screen's dark theme: emoji visuals, recap slides, the question to
// solve, the understanding check, written answers and study notes. Same behaviour as the AI Teacher page's
// cards (aiteacher/Cards.tsx, QuizCard.tsx), which are styled for a light page and so are not reused here.
import { Fragment, useState } from "react";
import { CheckCircle2, Download, FileText, Send, XCircle } from "lucide-react";
import type { LessonCard } from "@/lib/aiTeacherLecture";
import type { VisualData } from "@/components/aiteacher/Cards";
import type { QuizItem } from "@/components/aiteacher/QuizCard";
import { Markdown } from "@/components/aiteacher/Markdown";
import { docToHtml, downloadWord, printPdf, type DocData } from "@/lib/aiTeacherExport";

/** What a card can tell the teacher. */
export interface CardActions {
  reportQuizAnswer: (quiz: QuizItem, optionIndex: number) => void;
  reportUnderstanding: (choice: "got_it" | "somewhat" | "confused") => void;
  answerBigQuestion: (answer: string) => void;
}

export function CardBody({ item, actions }: { item: LessonCard; actions: CardActions }) {
  const card = item.card;
  switch (card.kind) {
    case "visual":
      return <Visual visual={card.visual} />;
    case "slide":
      return (
        <ul className="lb-bullets">
          {card.bullets.map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      );
    case "quiz":
      return <Quiz quiz={card.quiz} onAnswer={(i) => actions.reportQuizAnswer(card.quiz, i)} />;
    case "understand":
      return <Understand topic={card.topic} onChoose={actions.reportUnderstanding} />;
    case "bigq":
      return <BigQuestion question={card.question} hint={card.hint} onSubmit={actions.answerBigQuestion} />;
    case "document":
      return <Notes format={card.format} doc={card.doc} />;
  }
}

// ---------------------------------------------------------------- visuals

function Visual({ visual }: { visual: VisualData }) {
  const { kind, items, caption } = visual;
  let body: JSX.Element;

  if (kind === "scene") {
    body = (
      <div className="lb-scene">
        {items.map((it, i) => (
          <Fragment key={i}>
            <div className="lb-tile lb-tile--col">
              <span className="lb-emoji" role="img" aria-label={it.title}>{it.emoji}</span>
              <b>{it.title}</b>
              {it.text && <small>{it.text}</small>}
            </div>
            {i < items.length - 1 && <span className="lb-arrow" aria-hidden="true">→</span>}
          </Fragment>
        ))}
      </div>
    );
  } else if (kind === "timeline") {
    body = (
      <ol className="lb-timeline">
        {items.map((it, i) => (
          <li key={i}>
            <span className="lb-node" aria-hidden="true">{it.emoji}</span>
            <b>{it.title}</b>
            {it.text && <small>{it.text}</small>}
          </li>
        ))}
      </ol>
    );
  } else if (kind === "steps") {
    body = (
      <ol className="lb-flow">
        {items.map((it, i) => (
          <li key={i}>
            <div className="lb-tile">
              <span className="lb-num">{i + 1}</span>
              <span className="lb-emoji lb-emoji--sm" aria-hidden="true">{it.emoji}</span>
              <span className="lb-tile__text">
                <b>{it.title}</b>
                {it.text && <small>{it.text}</small>}
              </span>
            </div>
            {i < items.length - 1 && <span className="lb-down" aria-hidden="true">↓</span>}
          </li>
        ))}
      </ol>
    );
  } else if (kind === "compare") {
    const groups: string[] = [];
    items.forEach((it) => {
      const g = it.group || "";
      if (!groups.includes(g)) groups.push(g);
    });
    body = (
      <div className="lb-compare">
        {groups.slice(0, 2).map((g) => (
          <div key={g} className="lb-col">
            {g && <p className="lb-col__title">{g}</p>}
            {items
              .filter((it) => (it.group || "") === g)
              .map((it, i) => (
                <div key={i} className="lb-tile">
                  <span className="lb-emoji lb-emoji--sm" aria-hidden="true">{it.emoji}</span>
                  <span className="lb-tile__text">
                    <b>{it.title}</b>
                    {it.text && <small>{it.text}</small>}
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <div className="lb-grid">
        {items.map((it, i) => (
          <div key={i} className="lb-tile">
            <span className="lb-emoji lb-emoji--sm" aria-hidden="true">{it.emoji}</span>
            <span className="lb-tile__text">
              <b>{it.title}</b>
              {it.text && <small>{it.text}</small>}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {body}
      {caption && <p className="lb-caption">💡 {caption}</p>}
    </>
  );
}

// ---------------------------------------------------------------- questions

const LETTERS = "ABCDEFGH";

function Quiz({ quiz, onAnswer }: { quiz: QuizItem; onAnswer: (optionIndex: number) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const right = picked === quiz.correctIndex;

  return (
    <div>
      <Markdown className="lb-question">{quiz.question}</Markdown>
      <div className="lb-options" role="radiogroup" aria-label="Answer options">
        {quiz.options.map((option, i) => {
          const isCorrect = i === quiz.correctIndex;
          const state = answered ? (isCorrect ? " is-right" : picked === i ? " is-wrong" : " is-dim") : "";
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={picked === i}
              disabled={answered}
              className={`lb-opt${state}`}
              onClick={() => {
                setPicked(i);
                onAnswer(i);
              }}
            >
              <span className="lb-letter">{LETTERS[i]}</span>
              <span className="lb-opt__text">{option}</span>
              {answered && isCorrect && <CheckCircle2 size={16} aria-hidden="true" />}
              {answered && picked === i && !isCorrect && <XCircle size={16} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {answered && (
        <p className={`lb-feedback${right ? " is-right" : " is-wrong"}`}>
          {right ? "Correct!" : `Not quite. The correct answer is ${LETTERS[quiz.correctIndex]}.`}
          {quiz.explanation ? <span> {quiz.explanation}</span> : null}
        </p>
      )}
    </div>
  );
}

function Understand({ topic, onChoose }: { topic?: string; onChoose: (choice: "got_it" | "somewhat" | "confused") => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const options = [
    { id: "got_it" as const, emoji: "👍", label: "Got it!" },
    { id: "somewhat" as const, emoji: "🤔", label: "Somewhat" },
    { id: "confused" as const, emoji: "😕", label: "Confused" },
  ];
  return (
    <div>
      <p className="lb-question">Are you understanding{topic ? ` “${topic}”` : ""}?</p>
      <div className="lb-feel">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={!!picked}
            className={`lb-feel__btn${picked === o.id ? " is-picked" : picked ? " is-dim" : ""}`}
            onClick={() => {
              setPicked(o.id);
              onChoose(o.id);
            }}
          >
            <span aria-hidden="true">{o.emoji}</span>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function BigQuestion({ question, hint, onSubmit }: { question: string; hint?: string; onSubmit: (answer: string) => void }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div>
      <Markdown className="lb-question">{question}</Markdown>
      {hint && <p className="lb-hint">Hint: {hint}</p>}
      {sent ? (
        <p className="lb-sent">
          <span>Your answer</span>
          {sent}
        </p>
      ) : (
        <>
          <textarea
            className="lb-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={1200}
            placeholder="Say your answer out loud, or type it here…"
            aria-label="Your answer"
          />
          <button
            type="button"
            className="lb-send"
            disabled={text.trim().length < 3}
            onClick={() => {
              const answer = text.trim();
              setSent(answer);
              onSubmit(answer);
            }}
          >
            <Send size={14} aria-hidden="true" /> Send my answer
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- notes

function Notes({ format, doc }: { format: "pdf" | "word" | "both"; doc: DocData }) {
  const html = docToHtml(doc);
  return (
    <div className="lb-doc">
      <span className="lb-doc__icon" aria-hidden="true"><FileText size={20} /></span>
      <div className="lb-doc__text">
        <b>{doc.title}</b>
        <small>
          {doc.sections.length} sections · {doc.mcqs.length} MCQs · {doc.big_questions.length} big questions
        </small>
        <div className="lb-doc__buttons">
          {(format === "pdf" || format === "both") && (
            <button type="button" className="lb-ghost" onClick={() => printPdf(html)}>
              <Download size={14} aria-hidden="true" /> PDF
            </button>
          )}
          {(format === "word" || format === "both") && (
            <button type="button" className="lb-ghost" onClick={() => downloadWord(html, doc.title)}>
              <Download size={14} aria-hidden="true" /> Word
            </button>
          )}
        </div>
        {(format === "pdf" || format === "both") && <small>PDF opens your browser's print window: choose “Save as PDF”.</small>}
      </div>
    </div>
  );
}
