import { describe, expect, it } from "vitest";
import { TEACHER_PLAYBACK_RATE, teacherPlaybackRate } from "./aiTeacherVoice";

describe("teacherPlaybackRate: the speed of the teacher's voice", () => {
  it("is the normal speed unless a value was set to try a slower voice", () => {
    expect(TEACHER_PLAYBACK_RATE).toBe(1);
    expect(teacherPlaybackRate(null)).toBe(1);
    expect(teacherPlaybackRate(undefined)).toBe(1);
    expect(teacherPlaybackRate("")).toBe(1);
  });

  it("uses a stored value between 0.8 and 1.1 and ignores anything else", () => {
    expect(teacherPlaybackRate("0.92")).toBe(0.92);
    expect(teacherPlaybackRate("0.8")).toBe(0.8);
    expect(teacherPlaybackRate("0.5")).toBe(1);
    expect(teacherPlaybackRate("3")).toBe(1);
    expect(teacherPlaybackRate("fast")).toBe(1);
  });
});
