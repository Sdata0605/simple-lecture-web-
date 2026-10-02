import { describe, expect, it } from "vitest";
import {
  collectResults,
  createRestartThrottle,
  createUtteranceDetector,
  joinSegments,
  joinText,
  normalizeText,
  type DetectorDecision,
} from "./utteranceDetector";

const cfg = { silenceMs: 1400, minChars: 3 };
const res = (at: number, finalText: string, interimText = "") =>
  ({ type: "result", at, finalText, interimText }) as const;
const tick = (at: number) => ({ type: "tick", at }) as const;
const speech = (at: number) => ({ type: "speechStart", at }) as const;

/** Tick every 100 ms over (from, to] and return the first non-none decision + when. */
function tickUntil(
  d: ReturnType<typeof createUtteranceDetector>,
  from: number,
  to: number,
): { at: number; decision: DetectorDecision } | null {
  for (let t = from + 100; t <= to; t += 100) {
    const decision = d.push(tick(t));
    if (decision.kind !== "none") return { at: t, decision };
  }
  return null;
}

describe("normalizeText / joinText", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeText("  what   is\n\tosmosis  ")).toBe("what is osmosis");
    expect(normalizeText(undefined)).toBe("");
    expect(normalizeText(null)).toBe("");
  });
  it("joins with single spaces skipping empties", () => {
    expect(joinText("what is", "", "  osmosis ")).toBe("what is osmosis");
    expect(joinText("", "  ")).toBe("");
    expect(joinText(undefined, "a")).toBe("a");
  });
});

describe("joinSegments", () => {
  it("appends distinct segments", () => {
    expect(joinSegments(["what is", " osmosis"])).toBe("what is osmosis");
  });
  it("collapses Android cumulative finals", () => {
    expect(joinSegments(["what", "what is", "what is osmosis"])).toBe("what is osmosis");
  });
  it("is case-insensitive for cumulative detection", () => {
    expect(joinSegments(["what is", "What is osmosis"])).toBe("What is osmosis");
  });
  it("requires a word boundary for cumulative replacement", () => {
    expect(joinSegments(["photo", "photosynthesis"])).toBe("photo photosynthesis");
  });
  it("drops exact consecutive duplicates", () => {
    expect(joinSegments(["explain this", "again please", "again please"])).toBe("explain this again please");
  });
  it("skips empty segments", () => {
    expect(joinSegments(["", "  ", "hello there"])).toBe("hello there");
    expect(joinSegments([])).toBe("");
  });
});

describe("collectResults", () => {
  it("splits finals and interims", () => {
    expect(
      collectResults([
        { isFinal: true, transcript: "what is" },
        { isFinal: true, transcript: " the cell" },
        { isFinal: false, transcript: " wall made" },
        { isFinal: false, transcript: " of" },
      ]),
    ).toEqual({ finalText: "what is the cell", interimText: "wall made of" });
  });
  it("handles an empty list", () => {
    expect(collectResults([])).toEqual({ finalText: "", interimText: "" });
  });
});

describe("createUtteranceDetector", () => {
  it("returns none while idle, forever", () => {
    const d = createUtteranceDetector(cfg);
    expect(tickUntil(d, 0, 120_000)).toBeNull();
    expect(d.inUtterance).toBe(false);
  });

  it("finalizes after silenceMs of unchanged text", () => {
    const d = createUtteranceDetector(cfg);
    d.push(speech(1000));
    d.push(res(1500, "", "what"));
    d.push(res(1800, "", "what is"));
    d.push(res(2200, "what is osmosis", ""));
    expect(d.push(tick(3599))).toEqual({ kind: "none" });
    expect(d.push(tick(3600))).toEqual({ kind: "finalize", text: "what is osmosis" });
  });

  it("finalizes with interim-only text (Chrome never marked it final)", () => {
    const d = createUtteranceDetector(cfg);
    d.push(speech(0));
    d.push(res(400, "", "why is the sky blue"));
    const out = tickUntil(d, 400, 5000);
    expect(out).toEqual({ at: 1800, decision: { kind: "finalize", text: "why is the sky blue" } });
  });

  it("combines final + interim with whitespace normalization", () => {
    const d = createUtteranceDetector(cfg);
    d.push(res(0, "  what   is ", "  the\nanswer  "));
    expect(d.text).toBe("what is the answer");
    expect(tickUntil(d, 0, 5000)?.decision).toEqual({ kind: "finalize", text: "what is the answer" });
  });

  it("does not finalize mid-sentence while words keep changing", () => {
    const d = createUtteranceDetector(cfg);
    d.push(speech(0));
    const words = "so basically I wanted to ask about the second law of thermodynamics and entropy".split(" ");
    let text = "";
    let t = 0;
    for (const w of words) {
      // 1.2 s gaps between words: each < silenceMs, total ≫ silenceMs
      t += 1200;
      expect(tickUntil(d, t - 1200, t - 1)).toBeNull();
      text = text ? `${text} ${w}` : w;
      d.push(res(t, "", text));
    }
    const out = tickUntil(d, t, t + 5000);
    expect(out).toEqual({ at: t + 1400, decision: { kind: "finalize", text } });
  });

  it("silence clock does NOT reset when the same words are re-delivered as final", () => {
    const d = createUtteranceDetector(cfg);
    d.push(res(0, "", "hello teacher"));
    d.push(res(900, "hello teacher", "")); // interim → final, identical text
    expect(d.push(tick(1400))).toEqual({ kind: "finalize", text: "hello teacher" });
  });

  it("silence clock resets when text is revised (even if shorter)", () => {
    const d = createUtteranceDetector(cfg);
    d.push(res(0, "", "what is photo"));
    d.push(res(1000, "", "what is")); // engine revised its hypothesis
    expect(d.push(tick(1400))).toEqual({ kind: "none" });
    expect(d.push(tick(2400))).toEqual({ kind: "finalize", text: "what is" });
  });

  it("speech with no words → unclear after the longer grace, not after silenceMs", () => {
    const d = createUtteranceDetector(cfg);
    d.push(speech(1000));
    expect(tickUntil(d, 1000, 1000 + 3499)).toBeNull();
    expect(d.push(tick(1000 + 3500))).toEqual({ kind: "unclear" });
  });

  it("empty results do not count as words", () => {
    const d = createUtteranceDetector(cfg);
    d.push(speech(0));
    d.push(res(500, "", ""));
    d.push(res(1000, "  ", " "));
    expect(tickUntil(d, 1000, 10_000)).toEqual({ at: 3500, decision: { kind: "unclear" } });
  });

  it("repeated speechStart (noise, restarts) cannot extend the no-words grace", () => {
    const d = createUtteranceDetector(cfg);
    d.push(speech(0));
    d.push(speech(2000));
    d.push(speech(3000));
    expect(d.push(tick(3500))).toEqual({ kind: "unclear" });
  });

  it("words arriving late within the grace still finalize normally", () => {
    const d = createUtteranceDetector(cfg);
    d.push(speech(0));
    expect(tickUntil(d, 0, 3000)).toBeNull();
    d.push(res(3000, "", "explain mitosis"));
    expect(tickUntil(d, 3000, 10_000)).toEqual({ at: 4400, decision: { kind: "finalize", text: "explain mitosis" } });
  });

  it("new speechStart during an utterance (session restart) resets the silence clock", () => {
    const d = createUtteranceDetector(cfg);
    d.push(res(0, "what is", ""));
    d.push(speech(1000));
    expect(d.push(tick(1400))).toEqual({ kind: "none" });
    expect(d.push(tick(2400))).toEqual({ kind: "finalize", text: "what is" });
  });

  it("text shorter than minChars → unclear", () => {
    const d = createUtteranceDetector(cfg);
    d.push(speech(0));
    d.push(res(300, "hm", ""));
    expect(tickUntil(d, 300, 5000)).toEqual({ at: 1700, decision: { kind: "unclear" } });
  });

  it("minChars counts normalized characters", () => {
    const d = createUtteranceDetector(cfg);
    d.push(res(0, "  a  ", "  b  ")); // "a b" = 3 chars
    expect(d.push(tick(1400))).toEqual({ kind: "finalize", text: "a b" });
  });

  it("text exactly minChars finalizes", () => {
    const d = createUtteranceDetector(cfg);
    d.push(res(0, "why", ""));
    expect(d.push(tick(1400))).toEqual({ kind: "finalize", text: "why" });
  });

  it("result without speechStart starts the utterance", () => {
    const d = createUtteranceDetector(cfg);
    d.push(res(10_000, "", "hello there"));
    expect(d.inUtterance).toBe(true);
    expect(d.push(tick(11_399))).toEqual({ kind: "none" });
    expect(d.push(tick(11_400))).toEqual({ kind: "finalize", text: "hello there" });
  });

  it("resets itself after finalize", () => {
    const d = createUtteranceDetector(cfg);
    d.push(res(0, "hello there", ""));
    expect(d.push(tick(1400)).kind).toBe("finalize");
    expect(d.inUtterance).toBe(false);
    expect(d.text).toBe("");
    expect(tickUntil(d, 1400, 60_000)).toBeNull();
  });

  it("resets itself after unclear", () => {
    const d = createUtteranceDetector(cfg);
    d.push(speech(0));
    expect(d.push(tick(3500)).kind).toBe("unclear");
    expect(d.inUtterance).toBe(false);
    expect(tickUntil(d, 3500, 60_000)).toBeNull();
  });

  it("a fresh utterance after a decision is measured independently", () => {
    const d = createUtteranceDetector(cfg);
    d.push(res(0, "first question", ""));
    expect(d.push(tick(1400))).toEqual({ kind: "finalize", text: "first question" });
    d.push(speech(20_000));
    d.push(res(20_300, "", "second one"));
    expect(d.push(tick(21_600))).toEqual({ kind: "none" });
    expect(d.push(tick(21_700))).toEqual({ kind: "finalize", text: "second one" });
  });

  it("manual reset() discards everything", () => {
    const d = createUtteranceDetector(cfg);
    d.push(speech(0));
    d.push(res(100, "half a thought", ""));
    d.reset();
    expect(d.inUtterance).toBe(false);
    expect(tickUntil(d, 100, 60_000)).toBeNull();
  });

  it("maxUtteranceMs caps a never-ending utterance", () => {
    const d = createUtteranceDetector({ ...cfg, maxUtteranceMs: 10_000 });
    d.push(speech(0));
    let t = 0;
    let text = "";
    let out: DetectorDecision = { kind: "none" };
    while (out.kind === "none" && t < 30_000) {
      t += 100;
      if (t % 500 === 0) {
        text += " word";
        d.push(res(t, "", text));
      }
      out = d.push(tick(t));
    }
    expect(t).toBe(10_000);
    expect(out).toEqual({ kind: "finalize", text: normalizeText(text) });
  });

  it("honours a custom noWordsGraceMs but never below silenceMs", () => {
    const a = createUtteranceDetector({ ...cfg, noWordsGraceMs: 2000 });
    a.push(speech(0));
    expect(a.push(tick(1999)).kind).toBe("none");
    expect(a.push(tick(2000)).kind).toBe("unclear");

    const b = createUtteranceDetector({ ...cfg, noWordsGraceMs: 100 });
    b.push(speech(0));
    expect(b.push(tick(1399)).kind).toBe("none");
    expect(b.push(tick(1400)).kind).toBe("unclear");
  });

  it("default grace scales with a long silenceMs", () => {
    const d = createUtteranceDetector({ silenceMs: 2000, minChars: 3 });
    d.push(speech(0));
    expect(d.push(tick(4999)).kind).toBe("none");
    expect(d.push(tick(5000)).kind).toBe("unclear");
  });

  it("out-of-order (older) timestamps never move the silence clock backwards", () => {
    const d = createUtteranceDetector(cfg);
    d.push(res(1000, "", "what is"));
    d.push(res(500, "", "what is light")); // stale timestamp
    expect(d.push(tick(2399))).toEqual({ kind: "none" });
    expect(d.push(tick(2400))).toEqual({ kind: "finalize", text: "what is light" });
  });

  it("accumulated text across sessions (prefix + new session) keeps growing and finalizes once", () => {
    const d = createUtteranceDetector(cfg);
    d.push(speech(0));
    d.push(res(300, "what is", ""));
    // session ended & restarted; hook passes committed prefix + new session text
    d.push(speech(900));
    d.push(res(1200, "what is", "the"));
    d.push(res(1500, "what is the speed of light", ""));
    const out = tickUntil(d, 1500, 10_000);
    expect(out).toEqual({ at: 2900, decision: { kind: "finalize", text: "what is the speed of light" } });
  });
});

describe("createRestartThrottle", () => {
  it("uses the base delay for normal restarts", () => {
    const r = createRestartThrottle();
    expect(r.next(0)).toBe(150);
    expect(r.next(10_000)).toBe(150);
    expect(r.next(20_000)).toBe(150);
  });

  it("backs off after more than 5 restarts within 5 s", () => {
    const r = createRestartThrottle();
    const delays = [0, 200, 400, 600, 800, 1000, 1200].map((t) => r.next(t));
    expect(delays).toEqual([150, 150, 150, 150, 150, 1000, 1000]);
  });

  it("recovers once the window slides past the storm", () => {
    const r = createRestartThrottle();
    for (let t = 0; t < 1200; t += 200) r.next(t);
    expect(r.next(1200)).toBe(1000);
    expect(r.next(7000)).toBe(150);
  });

  it("reset() clears history", () => {
    const r = createRestartThrottle();
    for (let t = 0; t < 1400; t += 200) r.next(t);
    r.reset();
    expect(r.next(1400)).toBe(150);
  });
});
