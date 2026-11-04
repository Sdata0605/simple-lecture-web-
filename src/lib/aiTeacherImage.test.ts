import { describe, expect, it } from "vitest";
import { scaledSize, QUESTION_IMAGE_MAX_SIDE, QUESTION_IMAGE_MIN_SIDE } from "./aiTeacherImage";

describe("scaledSize", () => {
  it("shrinks a very large photo so its longest side fits, keeping the ratio", () => {
    const s = scaledSize(6000, 4000);
    expect(s.width).toBe(QUESTION_IMAGE_MAX_SIDE);
    expect(s.height).toBe(Math.round((4000 * QUESTION_IMAGE_MAX_SIDE) / 6000));
  });

  it("enlarges a tiny screenshot so its text is legible", () => {
    const s = scaledSize(352, 132);
    expect(Math.max(s.width, s.height)).toBe(QUESTION_IMAGE_MIN_SIDE);
    expect(s.width / s.height).toBeCloseTo(352 / 132, 1);
  });

  it("leaves a medium photo at its own size", () => {
    expect(scaledSize(1200, 900)).toEqual({ width: 1200, height: 900 });
  });

  it("handles a tall photo", () => {
    const s = scaledSize(1000, 9000);
    expect(s.height).toBe(QUESTION_IMAGE_MAX_SIDE);
    expect(s.width).toBe(Math.round((1000 * QUESTION_IMAGE_MAX_SIDE) / 9000));
  });

  it("rejects a photo with no size", () => {
    expect(() => scaledSize(0, 100)).toThrow();
  });
});
