import { useEffect, useRef } from "react";
import { AUTO_CONTINUE_MS, type Nudge } from "@/lib/aiTeacherLecture";

/**
 * Sends `nudge.text` once, after `delayMs` of quiet, for each step. A pending nudge is cancelled as soon as
 * `nudge` goes away (the teacher started talking again, or the student spoke), and a step already nudged is
 * never nudged twice.
 */
export function useAutoContinue(nudge: Nudge | null, send: (text: string) => void, delayMs: number = AUTO_CONTINUE_MS): void {
  const sendRef = useRef(send);
  sendRef.current = send;
  const nudgedRef = useRef<number | null>(null);
  const cardId = nudge?.cardId ?? null;
  const text = nudge?.text ?? null;

  useEffect(() => {
    if (cardId === null || text === null || nudgedRef.current === cardId) return;
    const timer = window.setTimeout(() => {
      nudgedRef.current = cardId;
      sendRef.current(text);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [cardId, text, delayMs]);
}
