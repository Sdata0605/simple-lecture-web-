import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";

export interface QuizItem {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string | null;
}

const LETTERS = "ABCDEFGH";

export function QuizCard({
  quiz,
  onAnswer,
}: {
  quiz: QuizItem;
  onAnswer?: (optionIndex: number, correct: boolean) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;

  const choose = (i: number) => {
    if (answered) return;
    setPicked(i);
    onAnswer?.(i, i === quiz.correctIndex);
  };

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <Markdown className="mb-3 font-medium">{quiz.question}</Markdown>
      <div className="space-y-2" role="radiogroup" aria-label="Answer options">
        {quiz.options.map((opt, i) => {
          const isCorrect = i === quiz.correctIndex;
          const isPicked = picked === i;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={isPicked}
              disabled={answered}
              onClick={() => choose(i)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                !answered && "hover:bg-accent hover:border-primary/50",
                answered && isCorrect && "border-green-600 bg-green-50 text-green-900",
                answered && isPicked && !isCorrect && "border-red-500 bg-red-50 text-red-900",
                answered && !isPicked && !isCorrect && "opacity-60",
              )}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">{LETTERS[i]}</span>
              <span className="flex-1">{opt}</span>
              {answered && isCorrect && <CheckCircle2 className="h-4 w-4 text-green-600" />}
              {answered && isPicked && !isCorrect && <XCircle className="h-4 w-4 text-red-500" />}
            </button>
          );
        })}
      </div>
      {answered && (
        <p className={cn("mt-3 text-sm", picked === quiz.correctIndex ? "text-green-700" : "text-red-700")}>
          {picked === quiz.correctIndex ? "Correct!" : `Not quite. The correct answer is ${LETTERS[quiz.correctIndex]}.`}
          {quiz.explanation ? <span className="text-muted-foreground"> {quiz.explanation}</span> : null}
        </p>
      )}
    </div>
  );
}
