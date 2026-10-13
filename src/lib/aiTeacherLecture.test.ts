import { describe, expect, it } from "vitest";
import {
  LECTURE_CONTEXT_TAG,
  buildLectureOpening,
  QUICK_REQUESTS,
  deriveLectureView,
  deriveLesson,
  formatClock,
  visibleStudentText,
  withFirstQuestion,
  type LectureAskContext,
  type LectureLive,
} from "./aiTeacherLecture";
import type { TranscriptItem } from "@/components/aiteacher/useLiveTeacher";

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
    expect(t).toContain("close this screen");
    expect(t).not.toContain("voice-only");
    expect(t).toContain("a Maths lecture");
    expect(t).not.toContain("paused at");
  });

  it("asks about doubts and offers a quick quiz when the lecture has finished", () => {
    const t = buildLectureOpening({ trigger: "end", subjectName: "Science", topicTitle: "Light", context: ctx });
    expect(t).toContain("I just finished watching");
    expect(t).toContain("ask if I have any doubts");
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
    expect(t.length).toBeLessThan(3200); // the narration is cut to 1200 characters, not passed through whole
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


const base: LectureLive = { status: "live", speaking: false, muted: false, micAvailable: true, micLevel: 0, teacherName: "Asha", transcript: [] };
const say = (role: "user" | "teacher", text: string, done = true): TranscriptItem => ({ kind: "text", id: Math.random(), role, text, done });

describe("deriveLectureView: what the orb screen shows", () => {
  it("shows the orb thinking while the call connects, and cannot be tapped or typed into yet", () => {
    for (const status of ["connecting", "idle"] as const) {
      const v = deriveLectureView({ ...base, status });
      expect(v.orbMode).toBe("thinking");
      expect(v.status).toBe("Connecting to your teacher…");
      expect(v.orbAction).toBe("none");
      expect(v.canType).toBe(false);
    }
  });

  it("listens when live and quiet, and notices when the student is being heard", () => {
    const quiet = deriveLectureView(base);
    expect(quiet).toMatchObject({ orbMode: "listening", status: "Go ahead, I'm listening", statusTone: "normal", orbAction: "mute", canType: true });
    const talking = deriveLectureView({ ...base, micLevel: 0.5 });
    expect(talking).toMatchObject({ status: "Listening…", statusTone: "hearing" });
  });

  it("speaks with the teacher's own words as the caption", () => {
    const v = deriveLectureView({ ...base, speaking: true, transcript: [say("teacher", "Namaste! What is confusing you?", false)] });
    expect(v.orbMode).toBe("speaking");
    expect(v.status).toBe("Asha is speaking · tap the orb to interrupt");
    expect(v.teacherCaption).toBe("Namaste! What is confusing you?");
    expect(v.studentLine).toBeNull();
  });

  it("lets the student tap the orb to interrupt the teacher, and mutes otherwise", () => {
    const talking = deriveLectureView({ ...base, speaking: true });
    expect(talking).toMatchObject({ orbAction: "interrupt", orbLabel: "Interrupt the teacher" });
    // Interrupting works even when there is no microphone yet, and even if the mic is muted.
    expect(deriveLectureView({ ...base, speaking: true, micAvailable: false }).orbAction).toBe("interrupt");
    expect(deriveLectureView({ ...base, speaking: true, muted: true }).orbAction).toBe("interrupt");
    // Once the teacher has finished, the same tap is the mute switch again.
    expect(deriveLectureView({ ...base, speaking: false })).toMatchObject({ orbAction: "mute", orbLabel: "Mute microphone" });
  });

  it("shows the student's live words, then 'Thinking…' once they have finished asking", () => {
    const hearing = deriveLectureView({ ...base, transcript: [say("teacher", "Go ahead."), say("user", "why do", false)] });
    expect(hearing.studentLine).toEqual({ text: "why do", live: true });
    expect(hearing.teacherCaption).toBeNull();

    const asked = deriveLectureView({ ...base, transcript: [say("user", "why do plants need light?", true)] });
    expect(asked.studentLine).toEqual({ text: "why do plants need light?", live: false });
    expect(asked.status).toBe("Thinking…");
  });

  it("explains a muted or missing microphone", () => {
    expect(deriveLectureView({ ...base, muted: true })).toMatchObject({ orbMode: "idle", status: "Microphone muted. Tap the orb to unmute", orbLabel: "Unmute microphone" });
    expect(deriveLectureView({ ...base, micAvailable: false })).toMatchObject({ orbMode: "idle", status: "Type your question below", orbAction: "none", canType: true });
  });

  it("lets the student restart after an error or the end of the class", () => {
    expect(deriveLectureView({ ...base, status: "error" })).toMatchObject({ orbMode: "error", orbAction: "restart", canType: true });
    expect(deriveLectureView({ ...base, status: "ended" })).toMatchObject({ orbMode: "idle", orbAction: "restart", status: "Class ended. Tap the orb to start again" });
  });

  it("asks for an explanation from the very basics, as numbered steps ending in a question to solve", () => {
    const mid = buildLectureOpening({ trigger: "mid", subjectName: "Science", context: null });
    for (const tool of ["show_visual", "present_slide", "show_quiz", "ask_big_question"]) expect(mid).toContain(tool);
  });
});

const slide = (id: number, title: string): TranscriptItem => ({ kind: "slide", id, title, bullets: ["a", "b"] });
const visualCard = (id: number, title: string): TranscriptItem => ({ kind: "visual", id, visual: { kind: "steps", title, items: [{ emoji: "🌱", title: "Seed" }, { emoji: "🌿", title: "Plant" }] } });
const quizCard = (id: number): TranscriptItem => ({ kind: "quiz", id, quiz: { id: "q", question: "2+2?", options: ["3", "4"], correctIndex: 1, explanation: null } });

describe("deriveLesson: the board the student sees", () => {
  it("is empty before the teacher shows anything", () => {
    expect(deriveLesson([say("user", "why do plants need sunlight?")])).toEqual({ question: null, cards: [], explainCount: 0, hasTurn: false });
  });

  it("numbers the steps in order, names them from the title, and remembers what was asked", () => {
    const lesson = deriveLesson([
      say("teacher", "Hello"),
      say("user", "why do plants need sunlight?"),
      visualCard(1, "Step 1 · The basics"),
      say("teacher", "Plants need food.", false),
      slide(2, "Step 2 - Build up"),
      visualCard(3, "Step 3: Everyday example"),
      slide(4, "Step 4 · Answer"),
      quizCard(5),
    ]);
    expect(lesson.question).toBe("why do plants need sunlight?");
    expect(lesson.cards.map((c) => [c.step, c.label, c.role])).toEqual([
      [1, "The basics", "explain"],
      [2, "Build up", "explain"],
      [3, "Everyday example", "explain"],
      [4, "Answer", "answer"],
      [null, "Your turn", "turn"],
    ]);
    expect(lesson).toMatchObject({ explainCount: 4, hasTurn: true });
  });

  it("starts a fresh board when the teacher begins again at Step 1 for a new question", () => {
    const lesson = deriveLesson([
      say("user", "why do plants need sunlight?"),
      slide(1, "Step 1 · The basics"),
      slide(2, "Step 2 · Build up"),
      quizCard(3),
      say("user", "what is photosynthesis?"),
      slide(4, "Step 1 · The basics"),
    ]);
    expect(lesson.question).toBe("what is photosynthesis?");
    expect(lesson.cards.map((c) => c.id)).toEqual([4]);
    expect(lesson.hasTurn).toBe(false);
  });

  it("keeps the board when the student answers a question by voice", () => {
    const lesson = deriveLesson([say("user", "why?"), slide(1, "Step 1 · The basics"), quizCard(2), say("user", "four")]);
    expect(lesson.cards).toHaveLength(2);
    expect(lesson.question).toBe("why?");
  });

  it("still works when the teacher forgets the Step prefix, and ignores the hidden context message", () => {
    const opening = buildLectureOpening({ trigger: "mid", subjectName: "Science", context: null });
    const lesson = deriveLesson([say("user", opening), slide(1, "Light and plants"), visualCard(2, "How it works")]);
    expect(lesson.question).toBeNull();
    expect(lesson.cards.map((c) => [c.step, c.label])).toEqual([[1, "Light and plants"], [2, "How it works"]]);
  });

  it("keeps notes and understanding checks on the board without counting them as steps", () => {
    const doc: TranscriptItem = { kind: "document", id: 9, format: "pdf", doc: { title: "Notes", sections: [], mcqs: [], big_questions: [] } };
    const lesson = deriveLesson([slide(1, "Step 1 · The basics"), { kind: "understand", id: 2 }, doc]);
    expect(lesson.cards.map((c) => [c.step, c.role])).toEqual([[1, "explain"], [null, "turn"], [null, "notes"]]);
    expect(lesson.explainCount).toBe(1);
  });
});

describe("quick requests", () => {
  it("are one-tap requests that ask for a simpler explanation, an example, or a repeat", () => {
    expect(QUICK_REQUESTS.map((q) => q.label)).toEqual(["Explain simpler", "Give an example", "Repeat that"]);
    expect(QUICK_REQUESTS[0].prompt).toContain("very basics");
  });
});
