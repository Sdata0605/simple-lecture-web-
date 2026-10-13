import { describe, expect, it } from "vitest";
import {
  LECTURE_CONTEXT_TAG,
  buildLectureOpening,
  formatClock,
  visibleStudentText,
  withFirstQuestion,
  type LectureAskContext,
} from "./aiTeacherLecture";

const ctx: LectureAskContext = {
  currentTime: 754,
  duration: 1800,
  sectionIndex: 3,
  sectionCount: 9,
  sectionTitle: "Causes of the French Revolution",
  keyPoints: ["Heavy taxes on the Third Estate", "Bread prices rose"],
  narration: "The peasants carried most of the tax burden while the clergy and nobles paid very little.",
};

describe("buildLectureOpening", () => {
  it("tells the teacher which lecture is paused, where, and what was being said", () => {
    const t = buildLectureOpening({ trigger: "mid", subjectName: "Social Science", topicTitle: "French Revolution", context: ctx });
    expect(t.startsWith(LECTURE_CONTEXT_TAG)).toBe(true);
    expect(t).toContain('"French Revolution" (Social Science)');
    expect(t).toContain("paused at 12:34, in section 3 of 9");
    expect(t).toContain("Causes of the French Revolution");
    expect(t).toContain("Heavy taxes on the Third Estate; Bread prices rose");
    expect(t).toContain("carried most of the tax burden");
  });

  it("never asks which subject, and knows how to hand control back to the lecture", () => {
    const t = buildLectureOpening({ trigger: "mid", subjectName: "Maths", context: null });
    expect(t).toContain("never ask which subject");
    expect(t).toContain('"Resume lecture"');
    expect(t).toContain("a Maths lecture");
    expect(t).not.toContain("paused at");
  });

  it("offers a recap quiz when the lecture has finished", () => {
    const t = buildLectureOpening({ trigger: "end", subjectName: "Science", topicTitle: "Light", context: ctx });
    expect(t).toContain("I just finished watching");
    expect(t).toContain("3-question quiz");
    expect(t).not.toContain("Key points on my screen"); // the screen context is only for a mid-lecture pause
  });

  it("asks for the lecture language only when the student's setting is auto", () => {
    const base = { trigger: "mid" as const, subjectName: "Science", lectureLanguage: "kannada", context: null };
    expect(buildLectureOpening({ ...base, replyInLectureLanguage: true })).toContain("Talk to me in Kannada unless I speak English.");
    const fixed = buildLectureOpening({ ...base, replyInLectureLanguage: false });
    expect(fixed).toContain("The lecture is in Kannada.");
    expect(fixed).not.toContain("Talk to me in");
    expect(buildLectureOpening({ ...base, lectureLanguage: "english", replyInLectureLanguage: true })).not.toContain("Talk to me in");
  });

  it("keeps a very long narration short", () => {
    const t = buildLectureOpening({
      trigger: "mid",
      subjectName: "Science",
      context: { ...ctx, narration: "word ".repeat(2000), keyPoints: Array.from({ length: 30 }, (_, i) => `point ${i}`) },
    });
    expect(t.length).toBeLessThan(2600);
    expect(t).toContain("point 7");
    expect(t).not.toContain("point 8");
  });
});

describe("what the student sees of the opening", () => {
  const opening = buildLectureOpening({ trigger: "mid", subjectName: "Science", context: null });

  it("hides the plumbing message", () => {
    expect(visibleStudentText(opening)).toBeNull();
  });

  it("keeps a question the student typed before the call was up", () => {
    expect(visibleStudentText(withFirstQuestion(opening, "  why is the sky blue? "))).toBe("why is the sky blue?");
  });

  it("leaves ordinary student messages alone", () => {
    expect(visibleStudentText("explain again")).toBe("explain again");
    expect(withFirstQuestion(opening)).toBe(opening);
  });
});

describe("formatClock", () => {
  it("formats minutes and seconds, tolerating bad input", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65.9)).toBe("1:05");
    expect(formatClock(-5)).toBe("0:00");
    expect(formatClock(Number.NaN)).toBe("0:00");
  });
});
