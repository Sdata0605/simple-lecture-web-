/**
 * Pure end-of-utterance logic for the hands-free "Ask AI" mic.
 *
 * No DOM, no timers, no clocks: every event carries its own timestamp (`at`,
 * milliseconds on any monotonic clock — the hook uses performance.now()), so the
 * whole thing is deterministic and unit-testable.
 *
 * ── Detector semantics ────────────────────────────────────────────────────────
 * The detector is either IDLE (nothing heard yet) or IN-UTTERANCE.
 *
 *  - `speechStart` or any `result` moves IDLE → IN-UTTERANCE and records the
 *    utterance start time. (A `result` counts even without a prior speechStart:
 *    some engines skip or reorder `speechstart`.)
 *  - The current text is `normalize(finalText + " " + interimText)`. Interim
 *    text counts fully — Chrome sometimes never marks the last chunk final, and
 *    we must still finalize with it.
 *  - The silence clock (`lastChangeAt`) resets only when the normalized text
 *    actually CHANGES (new words, revisions, even shrinking). A result that just
 *    re-delivers the same words (e.g. interim → final with identical text) is
 *    not the user speaking, so it does not postpone finalization. A repeated
 *    `speechStart` while in-utterance (a new recognition session after an
 *    auto-restart) also resets the silence clock, since words are about to follow.
 *  - `tick` makes the decisions:
 *      · text empty and `at - utteranceStart >= noWordsGraceMs` → "unclear"
 *        (noise / cough / mumble: speech was detected but no words ever came).
 *        The grace is deliberately longer than `silenceMs` because the first
 *        recognition result routinely lags speech onset by 0.5–1.5 s. It is
 *        measured from the FIRST speechStart, so repeated noise can't extend it.
 *      · text non-empty and `at - lastChangeAt >= silenceMs` → "finalize" with
 *        the text, or "unclear" if it is shorter than `minChars`.
 *      · `at - utteranceStart >= maxUtteranceMs` → same finalize/unclear rule
 *        (safety valve for a noisy room that never stops producing words).
 *    While words keep changing, nothing is decided — no mid-sentence cut-off.
 *  - After any non-"none" decision the detector resets itself to IDLE, so a
 *    stray tick afterwards returns "none".
 */

export interface UtteranceDetectorConfig {
  /** Silence (no change in transcript) after words that ends the utterance. */
  silenceMs: number;
  /** Final transcripts shorter than this (after normalization) are "unclear". */
  minChars: number;
  /** Speech detected but zero words for this long → "unclear".
   *  Default: max(3500, 2.5 × silenceMs). Never less than silenceMs. */
  noWordsGraceMs?: number;
  /** Hard cap on one utterance's length. Default 60000. */
  maxUtteranceMs?: number;
}

export type DetectorEvent =
  | { type: "speechStart"; at: number }
  | { type: "result"; at: number; finalText: string; interimText: string }
  | { type: "tick"; at: number };

export type DetectorDecision =
  | { kind: "none" }
  | { kind: "finalize"; text: string }
  | { kind: "unclear" };

export interface UtteranceDetector {
  push(e: DetectorEvent): DetectorDecision;
  reset(): void;
  /** True once speech/words have been detected in the current utterance. */
  readonly inUtterance: boolean;
  /** Current normalized text (final + interim). */
  readonly text: string;
}

const NONE: DetectorDecision = { kind: "none" };

/** Collapse all whitespace runs to single spaces and trim. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Join pieces with single spaces, skipping empties. */
export function joinText(...parts: Array<string | null | undefined>): string {
  return normalizeText(parts.map((p) => p ?? "").join(" "));
}

function startsWithWords(haystack: string, prefix: string): boolean {
  if (!haystack.startsWith(prefix)) return false;
  return haystack.length === prefix.length || haystack[prefix.length] === " ";
}

/**
 * Join the FINAL segments of one recognition session.
 *
 * Android Chrome (continuous mode) has a long-standing bug where each final
 * result repeats everything before it ("what", "what is", "what is osmosis"),
 * and sometimes re-delivers the exact same segment twice. So:
 *  - a segment that starts with (word-aligned, case-insensitive) everything
 *    accumulated so far REPLACES the accumulation;
 *  - a segment identical to the previous segment is dropped;
 *  - otherwise it is appended.
 */
export function joinSegments(segments: string[]): string {
  let out = "";
  let prev = "";
  for (const raw of segments) {
    const seg = normalizeText(raw);
    if (!seg) continue;
    const segLo = seg.toLowerCase();
    if (!out) {
      out = seg;
    } else if (startsWithWords(segLo, out.toLowerCase())) {
      out = seg;
    } else if (segLo === prev) {
      // exact duplicate of the previous segment — skip
    } else {
      out = `${out} ${seg}`;
    }
    prev = segLo;
  }
  return out;
}

export interface RecognitionResultLike {
  isFinal: boolean;
  transcript: string;
}

/**
 * Turn a SpeechRecognitionResultList (mapped to plain objects, iterated from 0)
 * into the session's final text and current interim text.
 */
export function collectResults(results: ArrayLike<RecognitionResultLike>): {
  finalText: string;
  interimText: string;
} {
  const finals: string[] = [];
  const interims: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r) continue;
    (r.isFinal ? finals : interims).push(r.transcript ?? "");
  }
  return { finalText: joinSegments(finals), interimText: joinText(...interims) };
}

export function createUtteranceDetector(cfg: UtteranceDetectorConfig): UtteranceDetector {
  const silenceMs = Math.max(0, cfg.silenceMs);
  const minChars = Math.max(0, cfg.minChars);
  const noWordsGraceMs = Math.max(silenceMs, cfg.noWordsGraceMs ?? Math.max(3500, silenceMs * 2.5));
  const maxUtteranceMs = cfg.maxUtteranceMs ?? 60_000;

  let active = false;
  let startedAt = 0;
  let lastChangeAt = 0;
  let text = "";

  const reset = () => {
    active = false;
    startedAt = 0;
    lastChangeAt = 0;
    text = "";
  };

  const begin = (at: number) => {
    active = true;
    startedAt = at;
    lastChangeAt = at;
  };

  const decide = (): DetectorDecision => {
    const t = text;
    reset();
    return t.length >= minChars && t.length > 0 ? { kind: "finalize", text: t } : { kind: "unclear" };
  };

  return {
    get inUtterance() {
      return active;
    },
    get text() {
      return text;
    },
    reset,
    push(e) {
      switch (e.type) {
        case "speechStart":
          if (!active) begin(e.at);
          else lastChangeAt = Math.max(lastChangeAt, e.at);
          return NONE;

        case "result": {
          if (!active) begin(e.at);
          const next = joinText(e.finalText, e.interimText);
          if (next !== text) {
            text = next;
            lastChangeAt = Math.max(lastChangeAt, e.at);
          }
          return NONE;
        }

        case "tick": {
          if (!active) return NONE;
          if (!text) {
            if (e.at - startedAt >= noWordsGraceMs) {
              reset();
              return { kind: "unclear" };
            }
            return NONE;
          }
          if (e.at - lastChangeAt >= silenceMs) return decide();
          if (e.at - startedAt >= maxUtteranceMs) return decide();
          return NONE;
        }

        default:
          return NONE;
      }
    },
  };
}

/**
 * Restart-storm guard for auto-restarting recognition sessions.
 * Android beeps on every start(), so if sessions keep dying instantly we back off.
 * `next(now)` records a restart and returns the delay to wait before it.
 */
export function createRestartThrottle(opts?: {
  baseDelayMs?: number;
  backoffDelayMs?: number;
  windowMs?: number;
  maxInWindow?: number;
}) {
  const baseDelayMs = opts?.baseDelayMs ?? 150;
  const backoffDelayMs = opts?.backoffDelayMs ?? 1000;
  const windowMs = opts?.windowMs ?? 5000;
  const maxInWindow = opts?.maxInWindow ?? 5;
  let history: number[] = [];
  return {
    next(now: number): number {
      history = history.filter((t) => now - t < windowMs);
      history.push(now);
      return history.length > maxInWindow ? backoffDelayMs : baseDelayMs;
    },
    reset() {
      history = [];
    },
  };
}
