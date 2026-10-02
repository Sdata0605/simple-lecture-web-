import { describe, it, expect, vi } from "vitest";
import { createClipPicker } from "./clipPicker";
import type { AssistantClip, AssistantClipCategory } from "./assistantAudioTypes";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function clip(category: AssistantClipCategory, n: number, text: string): AssistantClip {
  const num = String(n).padStart(2, "0");
  return {
    id: `${category}-${num}`,
    category,
    text,
    src: `/assistant-audio/${category}/${category}-${num}.mp3`,
  };
}

/** A realistic mixed manifest, deliberately interleaved by category. */
function makeManifest(): AssistantClip[] {
  return [
    clip("thinking", 1, "Let me think about that."),
    clip("greeting", 1, "Hi! What would you like to ask?"),
    clip("thinking", 2, "Good question, one moment."),
    clip("found", 1, "Here's what I found."),
    clip("thinking", 3, "Looking through the lecture now."),
    clip("greeting", 2, "Hey there, ask me anything about this lecture."),
    clip("thinking", 4, "Give me a second."),
    clip("found", 2, "Okay, got it."),
    clip("error", 1, "Sorry, something went wrong."),
    clip("thinking", 5, "Hmm, let me check."),
    clip("greeting", 3, "I'm listening."),
  ];
}

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALMOST_ONE = 1 - Number.EPSILON;

/** Random sources chosen to push a shuffle toward edge positions. */
const ADVERSARIAL_RANDOMS: Record<string, () => () => number> = {
  "always 0": () => () => 0,
  "always ~1": () => () => ALMOST_ONE,
  "always 0.5": () => () => 0.5,
  "alternating 0 / ~1": () => {
    let i = 0;
    return () => (i++ % 2 === 0 ? 0 : ALMOST_ONE);
  },
  "alternating ~1 / 0": () => {
    let i = 0;
    return () => (i++ % 2 === 0 ? ALMOST_ONE : 0);
  },
  "ramp 0..~1": () => {
    let i = 0;
    return () => ((i++ % 97) / 97) * ALMOST_ONE;
  },
  "seeded 1": () => seeded(1),
  "seeded 42": () => seeded(42),
  "seeded 2024": () => seeded(2024),
};

function pickMany(
  picker: ReturnType<typeof createClipPicker>,
  category: AssistantClipCategory,
  count: number,
): AssistantClip[] {
  const out: AssistantClip[] = [];
  for (let i = 0; i < count; i++) {
    const c = picker.pick(category);
    if (c === null) throw new Error(`pick(${category}) returned null on pick #${i}`);
    out.push(c);
  }
  return out;
}

const ids = (clips: AssistantClip[]) => clips.map((c) => c.id);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createClipPicker", () => {
  describe("empty / missing categories", () => {
    it("returns null for a category that has no clips", () => {
      const picker = createClipPicker(makeManifest(), seeded(1));
      expect(picker.pick("outOfScope")).toBeNull();
      expect(picker.pick("stillThere")).toBeNull();
    });

    it("keeps returning null (and does not throw) on repeated picks of an empty category", () => {
      const picker = createClipPicker(makeManifest(), seeded(1));
      for (let i = 0; i < 10; i++) expect(picker.pick("didntCatch")).toBeNull();
    });

    it("returns null for every category when given no clips at all", () => {
      const picker = createClipPicker([], seeded(1));
      expect(picker.pick("greeting")).toBeNull();
      expect(picker.pick("thinking")).toBeNull();
    });

    it("picking an empty category does not disturb another category's bag", () => {
      const picker = createClipPicker(makeManifest(), seeded(7));
      const first = picker.pick("greeting")!;
      picker.pick("outOfScope");
      picker.pick("outOfScope");
      const rest = pickMany(picker, "greeting", 2);
      expect(new Set(ids([first, ...rest])).size).toBe(3);
    });
  });

  describe("category purity", () => {
    it("only ever returns clips of the requested category", () => {
      const manifest = makeManifest();
      const picker = createClipPicker(manifest, seeded(3));
      const categories: AssistantClipCategory[] = ["thinking", "greeting", "found", "error"];
      for (let i = 0; i < 400; i++) {
        const cat = categories[i % categories.length];
        const c = picker.pick(cat);
        expect(c).not.toBeNull();
        expect(c!.category).toBe(cat);
      }
    });

    it("returns clip objects taken from the input (not fabricated copies with different data)", () => {
      const manifest = makeManifest();
      const picker = createClipPicker(manifest, seeded(3));
      for (const c of pickMany(picker, "thinking", 20)) {
        expect(manifest).toContainEqual(c);
      }
    });
  });

  describe("single-clip category (N = 1)", () => {
    it("always returns that one clip", () => {
      const manifest = [...makeManifest(), clip("outOfScope", 1, "That isn't covered in this subject.")];
      for (const [name, make] of Object.entries(ADVERSARIAL_RANDOMS)) {
        const picker = createClipPicker(manifest, make());
        const picks = pickMany(picker, "outOfScope", 25);
        expect(new Set(ids(picks)), name).toEqual(new Set(["outOfScope-01"]));
      }
    });
  });

  describe("shuffle bag", () => {
    it.each(Object.keys(ADVERSARIAL_RANDOMS))(
      "every consecutive block of N picks is a permutation of all N clips (random: %s)",
      (name) => {
        const picker = createClipPicker(makeManifest(), ADVERSARIAL_RANDOMS[name]());
        const N = 5; // "thinking"
        const picks = ids(pickMany(picker, "thinking", N * 20));
        const all = ["thinking-01", "thinking-02", "thinking-03", "thinking-04", "thinking-05"];
        for (let block = 0; block < 20; block++) {
          const slice = picks.slice(block * N, block * N + N);
          expect([...slice].sort(), `block ${block}: ${slice.join(",")}`).toEqual(all);
        }
      },
    );

    it("the first N picks cover all N clips before any repeat (N = 3)", () => {
      const picker = createClipPicker(makeManifest(), seeded(99));
      const firstThree = ids(pickMany(picker, "greeting", 3));
      expect(new Set(firstThree).size).toBe(3);
    });

    it("fairness: over 10,000 picks, per-clip counts never differ by more than 1 at any point", () => {
      const picker = createClipPicker(makeManifest(), seeded(12345));
      const counts = new Map<string, number>();
      for (let i = 0; i < 10_000; i++) {
        const c = picker.pick("thinking")!;
        counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
        const values = [...counts.values()];
        // Before a clip has been seen at all its count is effectively 0.
        const min = counts.size < 5 ? 0 : Math.min(...values);
        const max = Math.max(...values);
        if (max - min > 1) {
          throw new Error(`imbalance after ${i + 1} picks: ${JSON.stringify([...counts])}`);
        }
      }
      // 10,000 is a multiple of 5 — every clip must have been played exactly 2,000 times.
      expect([...counts.values()]).toEqual([2000, 2000, 2000, 2000, 2000]);
    });

    it("fairness with the default Math.random: 5,000 picks split exactly evenly", () => {
      const picker = createClipPicker(makeManifest());
      const counts = new Map<string, number>();
      for (const c of pickMany(picker, "thinking", 5_000)) {
        counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
      }
      expect(counts.size).toBe(5);
      for (const n of counts.values()) expect(n).toBe(1000);
    });

    it("actually shuffles: order is not simply the input order for every bag", () => {
      const picker = createClipPicker(makeManifest(), seeded(5));
      const picks = ids(pickMany(picker, "thinking", 5 * 30));
      const inputOrder = "thinking-01,thinking-02,thinking-03,thinking-04,thinking-05";
      const bags = Array.from({ length: 30 }, (_, i) => picks.slice(i * 5, i * 5 + 5).join(","));
      expect(new Set(bags).size).toBeGreaterThan(1);
      expect(bags.every((b) => b === inputOrder)).toBe(false);
    });
  });

  describe("no immediate repeat (N >= 2)", () => {
    it.each(Object.keys(ADVERSARIAL_RANDOMS))(
      "never returns the same clip twice in a row, across many bag refills (random: %s)",
      (name) => {
        const picker = createClipPicker(makeManifest(), ADVERSARIAL_RANDOMS[name]());
        for (const cat of ["thinking", "greeting", "found"] as const) {
          const picks = ids(pickMany(picker, cat, 3_000));
          for (let i = 1; i < picks.length; i++) {
            if (picks[i] === picks[i - 1]) {
              throw new Error(`${cat}: repeat of ${picks[i]} at pick ${i} (bag boundary? ${i % 3})`);
            }
          }
        }
      },
    );

    it.each(Object.keys(ADVERSARIAL_RANDOMS))(
      "N = 2 must strictly alternate (bag + no-repeat leaves no other option) (random: %s)",
      (name) => {
        const picker = createClipPicker(makeManifest(), ADVERSARIAL_RANDOMS[name]());
        const picks = ids(pickMany(picker, "found", 200));
        for (let i = 2; i < picks.length; i++) expect(picks[i]).toBe(picks[i - 2]);
        expect(picks[0]).not.toBe(picks[1]);
      },
    );

    it("holds for every seed in a sweep (refill boundary stress, N = 3)", () => {
      for (let seed = 0; seed < 300; seed++) {
        const picker = createClipPicker(makeManifest(), seeded(seed));
        const picks = ids(pickMany(picker, "greeting", 60));
        for (let i = 1; i < picks.length; i++) {
          if (picks[i] === picks[i - 1]) throw new Error(`seed ${seed}: repeat at pick ${i}`);
        }
      }
    });
  });

  describe("determinism", () => {
    it("the same injected random sequence yields the same pick sequence", () => {
      const a = createClipPicker(makeManifest(), seeded(777));
      const b = createClipPicker(makeManifest(), seeded(777));
      const cats: AssistantClipCategory[] = ["thinking", "greeting", "thinking", "found", "thinking", "error"];
      const seqA: (string | null)[] = [];
      const seqB: (string | null)[] = [];
      for (let i = 0; i < 300; i++) {
        seqA.push(a.pick(cats[i % cats.length])?.id ?? null);
        seqB.push(b.pick(cats[i % cats.length])?.id ?? null);
      }
      expect(seqA).toEqual(seqB);
    });

    it("different random sources can produce different sequences (random is actually used)", () => {
      const sequences = new Set<string>();
      for (let seed = 0; seed < 20; seed++) {
        const picker = createClipPicker(makeManifest(), seeded(seed));
        sequences.add(ids(pickMany(picker, "thinking", 10)).join(","));
      }
      expect(sequences.size).toBeGreaterThan(1);
    });

    it("does not consult Math.random when a random function is injected", () => {
      const spy = vi.spyOn(Math, "random");
      try {
        const picker = createClipPicker(makeManifest(), seeded(1));
        pickMany(picker, "thinking", 50);
        pickMany(picker, "greeting", 50);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it("falls back to Math.random when no random function is given", () => {
      const rng = seeded(11);
      const spy = vi.spyOn(Math, "random").mockImplementation(rng);
      try {
        const picker = createClipPicker(makeManifest());
        pickMany(picker, "thinking", 20);
        expect(spy).toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("category independence", () => {
    it("picks from other categories between picks do not reset or reshuffle a partially used bag", () => {
      for (let seed = 0; seed < 50; seed++) {
        const picker = createClipPicker(makeManifest(), seeded(seed));
        const got: AssistantClip[] = [];
        got.push(picker.pick("thinking")!);
        pickMany(picker, "greeting", 7); // crosses greeting bag boundaries
        got.push(picker.pick("thinking")!);
        pickMany(picker, "found", 5);
        got.push(picker.pick("thinking")!);
        picker.pick("error");
        got.push(picker.pick("thinking")!);
        pickMany(picker, "greeting", 3);
        got.push(picker.pick("thinking")!);
        // The five interleaved "thinking" picks must still form one complete bag.
        expect(new Set(ids(got)).size, `seed ${seed}: ${ids(got).join(",")}`).toBe(5);
      }
    });

    it("interleaved picking preserves bag + no-repeat guarantees for every category", () => {
      const picker = createClipPicker(makeManifest(), seeded(31337));
      const byCat: Record<string, string[]> = { thinking: [], greeting: [], found: [] };
      const pattern: AssistantClipCategory[] = ["thinking", "greeting", "thinking", "found", "greeting", "thinking"];
      for (let i = 0; i < 3_000; i++) {
        const cat = pattern[i % pattern.length];
        byCat[cat].push(picker.pick(cat)!.id);
      }
      const sizes: Record<string, number> = { thinking: 5, greeting: 3, found: 2 };
      for (const [cat, picks] of Object.entries(byCat)) {
        const N = sizes[cat];
        for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
        for (let b = 0; b + N <= picks.length; b += N) {
          expect(new Set(picks.slice(b, b + N)).size, `${cat} block at ${b}`).toBe(N);
        }
      }
    });
  });

  describe("input immutability", () => {
    it("does not mutate the input array or the clip objects", () => {
      const manifest = makeManifest();
      const snapshot = JSON.parse(JSON.stringify(manifest));
      const originalRefs = [...manifest];
      const picker = createClipPicker(manifest, seeded(8));
      pickMany(picker, "thinking", 100);
      pickMany(picker, "greeting", 100);
      expect(manifest).toEqual(snapshot);
      manifest.forEach((c, i) => expect(c).toBe(originalRefs[i]));
    });

    it("works with a deeply frozen input (would throw if it sorted/shuffled in place)", () => {
      const manifest = Object.freeze(makeManifest().map((c) => Object.freeze(c)));
      const picker = createClipPicker(manifest, seeded(8));
      expect(() => pickMany(picker, "thinking", 50)).not.toThrow();
    });
  });
});
