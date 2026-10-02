import { describe, it, expect } from "vitest";
import { cuesForAnswerProgress } from "./statusCues";
import type { AnswerProgress, StatusCue } from "./statusCues";
import type { PostLectureAnswerPhase } from "@/hooks/usePostLectureAthenaAnswer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const p = (phase: PostLectureAnswerPhase, segmentCount = 0): AnswerProgress => ({ phase, segmentCount });

const ALL_PHASES: PostLectureAnswerPhase[] = [
  "idle",
  "asking",
  "streaming",
  "awaiting_video",
  "video_ready",
  "text_only",
  "out_of_scope",
  "error",
];

const TERMINAL_EXCLUSIVE: Partial<Record<PostLectureAnswerPhase, StatusCue>> = {
  video_ready: "interrupt",
  out_of_scope: "outOfScope",
  error: "error",
};

/**
 * Feed a sequence of states through the function the way the hook would
 * (prev = last state, next = new state) and return the cues per step.
 */
function run(states: AnswerProgress[]): StatusCue[][] {
  const out: StatusCue[][] = [];
  for (let i = 1; i < states.length; i++) out.push(cuesForAnswerProgress(states[i - 1], states[i]));
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cuesForAnswerProgress", () => {
  describe("no change → no cue", () => {
    it.each(ALL_PHASES)("identical prev/next in phase %s (0 segments) → []", (phase) => {
      expect(cuesForAnswerProgress(p(phase, 0), p(phase, 0))).toEqual([]);
    });

    it.each(ALL_PHASES)("identical prev/next in phase %s (4 segments) → []", (phase) => {
      expect(cuesForAnswerProgress(p(phase, 4), p(phase, 4))).toEqual([]);
    });

    it("identical but distinct objects (not the same reference) → []", () => {
      expect(cuesForAnswerProgress({ phase: "asking", segmentCount: 0 }, { phase: "asking", segmentCount: 0 })).toEqual(
        [],
      );
    });

    it("same object passed as prev and next → []", () => {
      const s = p("awaiting_video", 3);
      expect(cuesForAnswerProgress(s, s)).toEqual([]);
    });
  });

  describe("rule 1: video_ready → interrupt only", () => {
    it.each(ALL_PHASES.filter((ph) => ph !== "video_ready"))("%s → video_ready gives ['interrupt']", (prev) => {
      expect(cuesForAnswerProgress(p(prev, 2), p("video_ready", 2))).toEqual(["interrupt"]);
    });

    it("suppresses 'found' even if the first segments arrive in the same update", () => {
      expect(cuesForAnswerProgress(p("streaming", 0), p("video_ready", 3))).toEqual(["interrupt"]);
    });

    it("suppresses 'thinking'/'found' when jumping straight from idle with segments", () => {
      expect(cuesForAnswerProgress(p("idle", 0), p("video_ready", 5))).toEqual(["interrupt"]);
    });

    it("does not re-emit while staying in video_ready (even if segment count changes)", () => {
      expect(cuesForAnswerProgress(p("video_ready", 3), p("video_ready", 3))).toEqual([]);
      expect(cuesForAnswerProgress(p("video_ready", 3), p("video_ready", 4))).toEqual([]);
    });
  });

  describe("rule 2: out_of_scope → outOfScope only", () => {
    it.each(ALL_PHASES.filter((ph) => ph !== "out_of_scope"))("%s → out_of_scope gives ['outOfScope']", (prev) => {
      expect(cuesForAnswerProgress(p(prev, 0), p("out_of_scope", 0))).toEqual(["outOfScope"]);
    });

    it("suppresses 'found' when segments arrive in the same update", () => {
      expect(cuesForAnswerProgress(p("asking", 0), p("out_of_scope", 1))).toEqual(["outOfScope"]);
    });

    it("does not re-emit while staying out_of_scope", () => {
      expect(cuesForAnswerProgress(p("out_of_scope", 0), p("out_of_scope", 0))).toEqual([]);
    });
  });

  describe("rule 3: error → error only", () => {
    it.each(ALL_PHASES.filter((ph) => ph !== "error"))("%s → error gives ['error']", (prev) => {
      expect(cuesForAnswerProgress(p(prev, 0), p("error", 0))).toEqual(["error"]);
    });

    it("suppresses 'found' when segments arrive in the same update", () => {
      expect(cuesForAnswerProgress(p("streaming", 0), p("error", 2))).toEqual(["error"]);
    });

    it("an error after the video was being prepared still reports just the error", () => {
      expect(cuesForAnswerProgress(p("awaiting_video", 4), p("error", 4))).toEqual(["error"]);
    });

    it("does not re-emit while staying in error", () => {
      expect(cuesForAnswerProgress(p("error", 0), p("error", 0))).toEqual([]);
    });
  });

  describe("rule 4: progress cues", () => {
    it("idle → asking gives ['thinking']", () => {
      expect(cuesForAnswerProgress(p("idle"), p("asking"))).toEqual(["thinking"]);
    });

    it.each(["error", "out_of_scope", "video_ready", "text_only"] as const)(
      "retrying a question straight from %s → asking gives ['thinking']",
      (prev) => {
        expect(cuesForAnswerProgress(p(prev, 0), p("asking", 0))).toEqual(["thinking"]);
      },
    );

    it("asking → streaming with no segments yet gives []", () => {
      expect(cuesForAnswerProgress(p("asking", 0), p("streaming", 0))).toEqual([]);
    });

    it("first segment arriving (0 → 1) gives ['found']", () => {
      expect(cuesForAnswerProgress(p("streaming", 0), p("streaming", 1))).toEqual(["found"]);
    });

    it("first segments arriving in a batch (0 → 4) gives a single ['found']", () => {
      expect(cuesForAnswerProgress(p("streaming", 0), p("streaming", 4))).toEqual(["found"]);
    });

    it("first segment arriving while still in 'asking' gives ['found']", () => {
      expect(cuesForAnswerProgress(p("asking", 0), p("asking", 1))).toEqual(["found"]);
    });

    it("asking → streaming with segments already present gives ['found']", () => {
      expect(cuesForAnswerProgress(p("asking", 0), p("streaming", 2))).toEqual(["found"]);
    });

    it("more segments after the first (1 → 3) gives []", () => {
      expect(cuesForAnswerProgress(p("streaming", 1), p("streaming", 3))).toEqual([]);
    });

    it("segment count going down (e.g. a reset mid-stream) gives []", () => {
      expect(cuesForAnswerProgress(p("streaming", 3), p("streaming", 0))).toEqual([]);
    });

    it("streaming → awaiting_video gives ['preparingVisual']", () => {
      expect(cuesForAnswerProgress(p("streaming", 3), p("awaiting_video", 3))).toEqual(["preparingVisual"]);
    });

    it("segments arrive in the same update the phase moves to awaiting_video → ['found', 'preparingVisual'] in that order", () => {
      expect(cuesForAnswerProgress(p("streaming", 0), p("awaiting_video", 3))).toEqual(["found", "preparingVisual"]);
    });

    it("idle → asking with a segment already present → ['thinking', 'found'] in that order", () => {
      expect(cuesForAnswerProgress(p("idle", 0), p("asking", 1))).toEqual(["thinking", "found"]);
    });

    it("idle → awaiting_video with segments (everything collapsed into one update) → ['found', 'preparingVisual']", () => {
      expect(cuesForAnswerProgress(p("idle", 0), p("awaiting_video", 2))).toEqual(["found", "preparingVisual"]);
    });

    it("more segments while awaiting_video gives []", () => {
      expect(cuesForAnswerProgress(p("awaiting_video", 3), p("awaiting_video", 5))).toEqual([]);
    });
  });

  describe("'found' guard: never announced in video_ready / out_of_scope / error", () => {
    it.each(["video_ready", "out_of_scope", "error"] as const)(
      "first segments arriving while already in %s → [] (e.g. a video-only answer whose text trickles in later)",
      (phase) => {
        expect(cuesForAnswerProgress(p(phase, 0), p(phase, 1))).toEqual([]);
        expect(cuesForAnswerProgress(p(phase, 0), p(phase, 5))).toEqual([]);
      },
    );

    it("the video is playing with no text, then text arrives in several updates → assistant stays silent throughout", () => {
      const states = [p("awaiting_video", 0), p("video_ready", 0), p("video_ready", 1), p("video_ready", 4)];
      expect(run(states)).toEqual([["interrupt"], [], []]);
    });

    it("'found' is still announced in the phases where it belongs", () => {
      for (const phase of ["asking", "streaming", "awaiting_video"] as const) {
        expect(cuesForAnswerProgress(p(phase, 0), p(phase, 2)), phase).toEqual(["found"]);
      }
    });

    it("over every transition, 'found' never appears when next.phase is video_ready, out_of_scope or error", () => {
      for (const a of ALL_PHASES)
        for (const b of ["video_ready", "out_of_scope", "error"] as const)
          for (const ca of [0, 1, 3])
            for (const cb of [0, 1, 3]) {
              expect(cuesForAnswerProgress(p(a, ca), p(b, cb))).not.toContain("found");
            }
    });
  });

  describe("silent transitions", () => {
    it.each(ALL_PHASES.filter((ph) => ph !== "idle"))("%s → idle (reset) gives []", (prev) => {
      expect(cuesForAnswerProgress(p(prev, 3), p("idle", 0))).toEqual([]);
      expect(cuesForAnswerProgress(p(prev, 0), p("idle", 0))).toEqual([]);
    });

    it("streaming → text_only gives []", () => {
      expect(cuesForAnswerProgress(p("streaming", 3), p("text_only", 3))).toEqual([]);
    });

    it("awaiting_video → text_only (video gave up, text stays) gives []", () => {
      expect(cuesForAnswerProgress(p("awaiting_video", 3), p("text_only", 3))).toEqual([]);
    });
  });

  describe("realistic sequences", () => {
    it("full happy path idle → asking → streaming(0) → streaming(1) → streaming(3) → awaiting_video → video_ready", () => {
      const steps = run([
        p("idle", 0),
        p("asking", 0),
        p("streaming", 0),
        p("streaming", 1),
        p("streaming", 3),
        p("awaiting_video", 3),
        p("video_ready", 3),
      ]);
      expect(steps).toEqual([["thinking"], [], ["found"], [], ["preparingVisual"], ["interrupt"]]);
    });

    it("the happy path with duplicate re-renders between every step emits each cue exactly once", () => {
      const states = [
        p("idle", 0),
        p("asking", 0),
        p("asking", 0),
        p("streaming", 0),
        p("streaming", 0),
        p("streaming", 1),
        p("streaming", 1),
        p("streaming", 1),
        p("streaming", 3),
        p("awaiting_video", 3),
        p("awaiting_video", 3),
        p("awaiting_video", 3),
        p("video_ready", 3),
        p("video_ready", 3),
      ];
      expect(run(states).flat()).toEqual(["thinking", "found", "preparingVisual", "interrupt"]);
    });

    it("a second question after reset re-arms every cue", () => {
      const states = [
        p("idle", 0),
        p("asking", 0),
        p("streaming", 2),
        p("awaiting_video", 2),
        p("video_ready", 2),
        p("idle", 0), // user asks another question
        p("asking", 0),
        p("streaming", 0),
        p("streaming", 1),
        p("awaiting_video", 1),
        p("video_ready", 1),
      ];
      expect(run(states).flat()).toEqual([
        "thinking",
        "found",
        "preparingVisual",
        "interrupt",
        "thinking",
        "found",
        "preparingVisual",
        "interrupt",
      ]);
    });

    it("out-of-scope question: idle → asking → out_of_scope", () => {
      expect(run([p("idle"), p("asking"), p("out_of_scope"), p("out_of_scope")])).toEqual([
        ["thinking"],
        ["outOfScope"],
        [],
      ]);
    });

    it("text-only answer: idle → asking → streaming(2) → text_only", () => {
      expect(run([p("idle"), p("asking"), p("streaming", 2), p("text_only", 2)]).flat()).toEqual([
        "thinking",
        "found",
      ]);
    });

    it("failure mid-stream then retry", () => {
      const states = [p("idle"), p("asking"), p("streaming", 1), p("error", 1), p("error", 1), p("idle"), p("asking")];
      expect(run(states)).toEqual([["thinking"], ["found"], ["error"], [], [], ["thinking"]]);
    });
  });

  describe("invariants over every transition", () => {
    const counts = [0, 1, 3];
    const pairs: [AnswerProgress, AnswerProgress][] = [];
    for (const a of ALL_PHASES)
      for (const b of ALL_PHASES) for (const ca of counts) for (const cb of counts) pairs.push([p(a, ca), p(b, cb)]);

    it("never returns duplicate cues in one call", () => {
      for (const [prev, next] of pairs) {
        const cues = cuesForAnswerProgress(prev, next);
        expect(new Set(cues).size, JSON.stringify({ prev, next, cues })).toBe(cues.length);
      }
    });

    it("feeding the result state back in (next → next) is always silent", () => {
      for (const [, next] of pairs) {
        expect(cuesForAnswerProgress(next, { ...next }), JSON.stringify(next)).toEqual([]);
      }
    });

    it("entering video_ready / out_of_scope / error always yields exactly that single cue", () => {
      for (const [prev, next] of pairs) {
        const exclusive = TERMINAL_EXCLUSIVE[next.phase];
        if (!exclusive || prev.phase === next.phase) continue;
        expect(cuesForAnswerProgress(prev, next), JSON.stringify({ prev, next })).toEqual([exclusive]);
      }
    });

    it("'interrupt' only ever appears on entering video_ready", () => {
      for (const [prev, next] of pairs) {
        const cues = cuesForAnswerProgress(prev, next);
        if (cues.includes("interrupt")) {
          expect(next.phase).toBe("video_ready");
          expect(prev.phase).not.toBe("video_ready");
        }
      }
    });

    it("only emits cues from the allowed set, in canonical order", () => {
      const order: StatusCue[] = ["thinking", "found", "preparingVisual"];
      for (const [prev, next] of pairs) {
        const cues = cuesForAnswerProgress(prev, next);
        if (cues.length <= 1) continue;
        const idx = cues.map((c) => order.indexOf(c));
        expect(idx.every((i) => i >= 0), JSON.stringify({ prev, next, cues })).toBe(true);
        expect([...idx].sort((x, y) => x - y)).toEqual(idx);
      }
    });
  });

  describe("purity", () => {
    it("does not mutate its inputs", () => {
      const prev = Object.freeze(p("streaming", 0));
      const next = Object.freeze(p("awaiting_video", 2));
      expect(() => cuesForAnswerProgress(prev, next)).not.toThrow();
      expect(prev).toEqual({ phase: "streaming", segmentCount: 0 });
      expect(next).toEqual({ phase: "awaiting_video", segmentCount: 2 });
    });

    it("returns a fresh array each call (mutating one result cannot leak into the next)", () => {
      const a = cuesForAnswerProgress(p("idle"), p("idle"));
      a.push("thinking");
      expect(cuesForAnswerProgress(p("idle"), p("idle"))).toEqual([]);
      const b = cuesForAnswerProgress(p("idle"), p("asking"));
      b.length = 0;
      expect(cuesForAnswerProgress(p("idle"), p("asking"))).toEqual(["thinking"]);
    });

    it("is deterministic: same inputs, same output", () => {
      const r1 = cuesForAnswerProgress(p("streaming", 0), p("awaiting_video", 3));
      const r2 = cuesForAnswerProgress(p("streaming", 0), p("awaiting_video", 3));
      expect(r1).toEqual(r2);
    });
  });
});
