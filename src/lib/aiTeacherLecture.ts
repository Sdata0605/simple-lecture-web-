// "Ask AI" inside a lecture player: the student talks to the same live AI Teacher as /aiteacher, but the
// teacher is told which lecture is paused and where, so it can answer in context without asking which
// subject the student wants.
import type { TranscriptItem } from "@/components/aiteacher/useLiveTeacher";

/** Where the student was in the lecture when they tapped Ask AI. */
export interface LectureAskContext {
  currentTime: number;
  duration: number;
  /** 1-based position of the section being played. */
  sectionIndex: number;
  sectionCount: number;
  sectionTitle?: string;
  keyPoints: string[];
  /** What the lecture was saying in this section. */
  narration: string;
}

export interface LectureOpeningInput {
  trigger: "mid" | "end";
  subjectName: string;
  topicTitle?: string | null;
  /** Language the lecture is playing in, e.g. "kannada". */
  lectureLanguage?: string | null;
  /** True when the student's AI Teacher language setting is "auto" (so the lecture language is a fair default). */
  replyInLectureLanguage?: boolean;
  context?: LectureAskContext | null;
}

/** Every opening message starts with this tag; the conversation view hides it from the student. */
export const LECTURE_CONTEXT_TAG = "[Lecture context]";
const QUESTION_MARKER = "My first question:";

const NARRATION_MAX = 1200;
const KEY_POINT_MAX = 160;
const KEY_POINTS_MAX = 8;

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const clip = (text: string, max: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The first message the live teacher receives: lecture context plus how to run this short session. */
export function buildLectureOpening(input: LectureOpeningInput): string {
  const { trigger, subjectName, topicTitle, lectureLanguage, replyInLectureLanguage, context } = input;
  const lecture = topicTitle ? `"${topicTitle}" (${subjectName})` : `a ${subjectName} lecture`;
  const lang = lectureLanguage && lectureLanguage.toLowerCase() !== "english" ? capitalise(lectureLanguage) : null;

  const lines: string[] = [];
  if (trigger === "end") {
    lines.push(`${LECTURE_CONTEXT_TAG} I just finished watching the video lecture ${lecture}.`);
  } else {
    const where = context
      ? ` It is paused at ${formatClock(context.currentTime)}${context.sectionTitle ? `, in section ${context.sectionIndex} of ${context.sectionCount}: "${clip(context.sectionTitle, 120)}"` : ""}.`
      : "";
    lines.push(`${LECTURE_CONTEXT_TAG} I am watching the video lecture ${lecture} and I paused it to ask you a doubt.${where}`);
  }
  if (lang) lines.push(`The lecture is in ${lang}.`);

  if (context && trigger === "mid") {
    const points = context.keyPoints.slice(0, KEY_POINTS_MAX).map((p) => clip(p, KEY_POINT_MAX)).filter(Boolean);
    if (points.length) lines.push(`Key points on my screen: ${points.join("; ")}.`);
    const narration = clip(context.narration, NARRATION_MAX);
    if (narration) lines.push(`What the lecture was saying: "${narration}"`);
  }

  const rules: string[] = [`My subject is already chosen (${subjectName}), so never ask which subject I want.`];
  if (trigger === "end") {
    rules.push(
      "Say in one short sentence that the lecture is over and ask if I have any doubts. Offer a quick 3-question quiz on this lecture (one show_quiz question at a time).",
    );
  } else {
    rules.push("Greet me in one short sentence and ask what I am unsure about.");
  }
  rules.push(
    "When I ask, call search_notes first, then answer in a few clear sentences, linking it to what the lecture was saying when that helps.",
  );
  rules.push(
    "Teach the way you normally do on a live class: show a visual with emojis when it helps me understand (show_visual), give me a question to solve (show_quiz or ask_big_question), check my understanding, and make notes if I ask. Keep each spoken turn short.",
  );
  rules.push("If I want to continue the lecture, say a short goodbye and tell me to close this screen.");
  if (lang && replyInLectureLanguage) rules.push(`Talk to me in ${lang} unless I speak English.`);
  lines.push(`Instructions for this short session: ${rules.join(" ")}`);

  return lines.join("\n");
}

/** Opening message plus the first thing the student typed, when they typed before the call was up. */
export function withFirstQuestion(opening: string, question?: string): string {
  const q = question?.trim();
  return q ? `${opening}\n${QUESTION_MARKER} ${q}` : opening;
}

/**
 * What the student should see for one of their own messages: the context tag is plumbing and is hidden
 * (null), but a question typed before the call was up is kept.
 */
export function visibleStudentText(text: string): string | null {
  if (!text.startsWith(LECTURE_CONTEXT_TAG)) return text;
  const at = text.indexOf(QUESTION_MARKER);
  return at === -1 ? null : text.slice(at + QUESTION_MARKER.length).trim() || null;
}

// ---------------------------------------------------------------- orb screen

export type LectureOrbMode = "idle" | "speaking" | "listening" | "thinking" | "error";

/** The slice of useLiveTeacher the orb screen reads. */
export interface LectureLive {
  status: "idle" | "connecting" | "live" | "ended" | "error";
  speaking: boolean;
  muted: boolean;
  micAvailable: boolean;
  micLevel: number;
  teacherName: string;
  transcript: TranscriptItem[];
}

export type LectureCard = Exclude<TranscriptItem, { kind: "text" }>;

export interface LectureView {
  orbMode: LectureOrbMode;
  /** Short line under the orb, or null while the teacher's words are the focus. */
  status: string | null;
  statusTone: "normal" | "hearing";
  /** What the teacher is saying (or last said). */
  teacherCaption: string | null;
  /** What the student is saying right now (`live`) or just asked. */
  studentLine: { text: string; live: boolean } | null;
  /** Quizzes, emoji visuals, slides, questions and notes the teacher put on screen, oldest first. */
  cards: LectureCard[];
  /** Tapping the orb: interrupt the teacher while it speaks, otherwise mute/unmute the mic, restart the call, or nothing yet. */
  orbAction: "interrupt" | "mute" | "restart" | "none";
  orbLabel: string;
  /** The text box works only once the call is live, or when a new call can be started with it. */
  canType: boolean;
}

/** Mic level above which we say the student is being heard. */
const HEARING_LEVEL = 0.2;

export function deriveLectureView(live: LectureLive): LectureView {
  const { status, speaking, muted, micAvailable, micLevel, teacherName, transcript } = live;
  const lastText = [...transcript].reverse().find((m) => m.kind === "text");
  const cards = transcript.filter((m): m is LectureCard => m.kind !== "text");
  const teacherCaption = lastText && lastText.role === "teacher" ? lastText.text : null;
  const studentLine = lastText && lastText.role === "user" ? { text: lastText.text, live: !lastText.done } : null;
  const inCall = status === "live";

  let orbMode: LectureOrbMode = "idle";
  if (status === "error") orbMode = "error";
  else if (status === "connecting" || status === "idle") orbMode = "thinking";
  else if (inCall) orbMode = speaking ? "speaking" : micAvailable && !muted ? "listening" : "idle";

  const hearing = inCall && !speaking && micAvailable && !muted && micLevel >= HEARING_LEVEL;
  let line: string | null = null;
  if (status === "connecting" || status === "idle") line = "Connecting to your teacher…";
  else if (status === "error") line = "Tap the orb to try again, or type below";
  else if (status === "ended") line = "Class ended. Tap the orb to start again";
  else if (inCall && speaking) line = `${teacherName} is speaking · tap the orb to interrupt`;
  else if (inCall && studentLine && !studentLine.live) line = "Thinking…";
  else if (inCall && !micAvailable) line = "Type your question below";
  else if (inCall && muted) line = "Microphone muted. Tap the orb to unmute";
  else if (inCall) line = hearing ? "Listening…" : "Go ahead, I'm listening";

  const orbAction: LectureView["orbAction"] = inCall
    ? speaking
      ? "interrupt"
      : micAvailable
        ? "mute"
        : "none"
    : status === "ended" || status === "error"
      ? "restart"
      : "none";
  const orbLabel =
    orbAction === "interrupt"
      ? "Interrupt the teacher"
      : orbAction === "mute"
        ? muted ? "Unmute microphone" : "Mute microphone"
        : orbAction === "restart"
          ? "Start talking again"
          : "Connecting";

  return {
    orbMode,
    status: line,
    statusTone: hearing ? "hearing" : "normal",
    teacherCaption,
    studentLine,
    cards,
    orbAction,
    orbLabel,
    canType: inCall || status === "ended" || status === "error",
  };
}
