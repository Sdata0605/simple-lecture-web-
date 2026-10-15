import { useCallback, useEffect, useRef, useState } from "react";
import {
  teacherApi,
  type CatalogSubject,
  type LiveSession,
  type RetrievalResult,
  type TeacherSubject,
} from "@/lib/aiTeacherApi";
import { matchSubjectByName } from "@/lib/aiTeacherSubjects";
import { personaPayload, type TeacherPrefs } from "@/lib/aiTeacherPrefs";
import { loadSubscription } from "@/lib/aiTeacherSubscription";
import type { DocData } from "@/lib/aiTeacherExport";
import type { QuizItem } from "./QuizCard";
import type { VisualData } from "./Cards";
import { ECHO_TAIL_MS, createEchoGate } from "./echoGate";
import { createStepPacer, waitUntilIdle } from "./stepPacing";

export type LiveStatus = "idle" | "connecting" | "live" | "ended" | "error";

/** Everything the student sees is one conversation: spoken text, plus slide and quiz cards inline. */
export type TranscriptItem =
  | { kind: "text"; id: number; role: "user" | "teacher"; text: string; done: boolean }
  | { kind: "slide"; id: number; title: string; bullets: string[] }
  | { kind: "quiz"; id: number; quiz: QuizItem }
  | { kind: "visual"; id: number; visual: VisualData }
  | { kind: "bigq"; id: number; question: string; hint?: string }
  | { kind: "understand"; id: number; topic?: string }
  | { kind: "document"; id: number; format: "pdf" | "word" | "both"; doc: DocData };

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type CardInput = DistOmit<Exclude<TranscriptItem, { kind: "text" }>, "id">;

/** 16 kHz mono PCM16 capture worklet (inlined so no extra build config is needed). */
const WORKLET_SRC = `
class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0; this.acc = 0; this.cnt = 0;
    this.out = new Int16Array(1600); this.n = 0; this.sumSq = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.cnt++; this.pos += 1;
      if (this.pos >= this.ratio) {
        const v = this.acc / this.cnt;
        this.pos -= this.ratio; this.acc = 0; this.cnt = 0;
        const s = Math.max(-1, Math.min(1, v));
        this.sumSq += s * s;
        this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === 1600) {
          this.port.postMessage({ pcm: this.out.buffer.slice(0), rms: Math.sqrt(this.sumSq / 1600) });
          this.n = 0; this.sumSq = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
`;

const b64FromBuffer = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const pcm16Base64ToFloat32 = (b64: string) => {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
};

/** Added to the reply of a shown step so the teacher carries on instead of ending its turn. */
const KEEP_GOING =
  "Shown on the student's screen. Now explain this step aloud properly: 3 to 5 clear sentences in simple words, saying what we are doing, how, and why, like teaching a beginner. Do this before anything else. Only when you have finished speaking, go on to the next step (call its tool). Never show a step without explaining it, and do not stop or ask whether to continue until the Answer step has been shown. After you have explained the Answer step, ask me aloud in one short sentence whether I would like to solve a practice question on this, then wait: never show or ask a question unless I say yes.";

/** Tools that put a card on the student's screen; with keepGoing they are paced to the teacher's voice. */
const PACED_TOOLS = new Set(["present_slide", "show_visual", "show_quiz", "ask_big_question", "check_understanding", "create_document"]);

const GREETING = "Hello! I have just joined the class. Greet me with: 'Namaste! How can I help you today? Which subject would you like to study?' and ask which subject I want to study.";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useLiveTeacher({
  subject,
  subjects,
  onSubject,
  prefs,
  enrolledSubjects,
  echoGuard = false,
  keepGoing = false,
  sessionMode,
  playbackRate = 1,
}: {
  subject: TeacherSubject | null;
  subjects: TeacherSubject[];
  onSubject: (s: TeacherSubject) => void;
  prefs: TeacherPrefs;
  enrolledSubjects?: string;
  /** "ask" = the Ask AI screen: the server tells the teacher to offer practice questions instead of asking them. */
  sessionMode?: "ask";
  /** Speed of the teacher's voice (1 = as generated; a little under 1 sounds slower). */
  playbackRate?: number;
  /** For speakers: keep the mic closed while the teacher talks (so it cannot hear itself) and let the
   * student break in with interrupt(). Off by default, which keeps the mic open all the time. */
  echoGuard?: boolean;
  /** For a lesson that explains in steps: tell the teacher, in each tool reply, to carry straight on to the
   * next step instead of ending its turn and waiting for the student. */
  keepGoing?: boolean;
}) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [micAvailable, setMicAvailable] = useState(true);
  const [teacherName, setTeacherName] = useState(prefs.teacherName.trim() || "AI Teacher");
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  /** How many of the teacher's turns have finished (the server's "turn complete" signal). */
  const [turnsCompleted, setTurnsCompleted] = useState(0);

  const sessionRef = useRef<any>(null);
  const mutedRef = useRef(false);
  const statusRef = useRef<LiveStatus>("idle");
  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playNextRef = useRef(0);
  const playingRef = useRef(new Set<AudioBufferSourceNode>());
  const echoGuardRef = useRef(echoGuard);
  echoGuardRef.current = echoGuard;
  const keepGoingRef = useRef(keepGoing);
  keepGoingRef.current = keepGoing;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const sessionModeRef = useRef(sessionMode);
  sessionModeRef.current = sessionMode;
  const gateRef = useRef(createEchoGate());
  const speakTailRef = useRef<number | null>(null);
  const pacerRef = useRef(createStepPacer());
  const msgIdRef = useRef(1);
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const catalogRef = useRef<CatalogSubject[]>([]);
  const subjectsRef = useRef(subjects);
  subjectsRef.current = subjects;
  const onSubjectRef = useRef(onSubject);
  onSubjectRef.current = onSubject;
  const pendingTextRef = useRef<string | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const enrolledSubjectsRef = useRef(enrolledSubjects);
  enrolledSubjectsRef.current = enrolledSubjects;

  const setStatusBoth = (s: LiveStatus) => { statusRef.current = s; setStatus(s); };

  // ---------------------------------------------------------------- transcript
  const closeAll = (items: TranscriptItem[]): TranscriptItem[] =>
    items.map((m) => (m.kind === "text" && !m.done ? { ...m, done: true } : m));

  const appendTranscript = useCallback((role: "user" | "teacher", text: string) => {
    if (!text) return;
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.kind === "text" && last.role === role && !last.done) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      // a new speaker (or a card) closes any open bubble
      return [...closeAll(prev), { kind: "text", id: msgIdRef.current++, role, text: text.trimStart(), done: false }];
    });
  }, []);

  const closeOpenBubbles = useCallback(() => {
    setTranscript((prev) => (prev.some((m) => m.kind === "text" && !m.done) ? closeAll(prev) : prev));
  }, []);

  /** Slides and quiz questions appear inside the conversation itself. */
  const pushCard = useCallback((card: CardInput) => {
    setTranscript((prev) => [...closeAll(prev), { ...card, id: msgIdRef.current++ } as TranscriptItem]);
  }, []);

  // ---------------------------------------------------------------- playback
  const ensurePlayCtx = () => {
    if (!playCtxRef.current) playCtxRef.current = new AudioContext({ sampleRate: 24000 });
    if (playCtxRef.current.state === "suspended") void playCtxRef.current.resume();
    return playCtxRef.current;
  };

  const clearSpeakTail = useCallback(() => {
    if (speakTailRef.current !== null) { window.clearTimeout(speakTailRef.current); speakTailRef.current = null; }
  }, []);

  const stopPlayback = useCallback(() => {
    playingRef.current.forEach((s) => { try { s.onended = null; s.stop(); } catch { /* already stopped */ } });
    playingRef.current.clear();
    playNextRef.current = 0;
    clearSpeakTail();
    gateRef.current.playbackStopped(performance.now());
    setSpeaking(false);
  }, [clearSpeakTail]);

  /** The queue ran dry. With the echo guard, "speaking" (and the closed mic) lasts a short tail longer. */
  const playbackDrained = useCallback(() => {
    if (!echoGuardRef.current) { setSpeaking(false); return; }
    // Bluetooth and some speakers play a moment after the audio is handed over.
    const latency = Math.min(600, Math.round(((playCtxRef.current as (AudioContext & { outputLatency?: number }) | null)?.outputLatency ?? 0) * 1000));
    const tail = ECHO_TAIL_MS + latency;
    gateRef.current.playbackEnded(performance.now(), tail);
    clearSpeakTail();
    speakTailRef.current = window.setTimeout(() => { speakTailRef.current = null; setSpeaking(false); }, tail);
  }, [clearSpeakTail]);

  const enqueueAudio = useCallback((b64: string) => {
    // A turn the student cut off by tapping: the server may still be sending its last words.
    if (echoGuardRef.current && !gateRef.current.acceptChunk(performance.now())) return;
    const ctx = ensurePlayCtx();
    const data = pcm16Base64ToFloat32(b64);
    if (!data.length) return;
    const buf = ctx.createBuffer(1, data.length, 24000);
    buf.copyToChannel(data, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // A rate under 1 plays the same audio more slowly, so it also takes longer on the clock.
    const rate = playbackRateRef.current;
    src.playbackRate.value = rate;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.03, playNextRef.current);
    src.start(startAt);
    const playSeconds = buf.duration / rate;
    playNextRef.current = startAt + playSeconds;
    pacerRef.current.spoke(playSeconds * 1000);
    playingRef.current.add(src);
    clearSpeakTail();
    gateRef.current.playbackStarted();
    setSpeaking(true);
    src.onended = () => {
      playingRef.current.delete(src);
      if (playingRef.current.size === 0) playbackDrained();
    };
  }, [clearSpeakTail, playbackDrained]);

  /** The student taps to break in: the teacher stops now and the mic opens. */
  const interrupt = useCallback(() => {
    stopPlayback();
    gateRef.current.interrupt(performance.now());
  }, [stopPlayback]);

  // ---------------------------------------------------------------- tools
  const handleToolCalls = useCallback(async (calls: any[]) => {
    const responses: any[] = [];
    for (const fc of calls) {
      const args = fc.args ?? {};
      try {
        // A lesson in steps: keep the board and the voice together (see stepPacing.ts).
        if (keepGoingRef.current && PACED_TOOLS.has(fc.name)) {
          if (fc.name === "present_slide" || fc.name === "show_visual") {
            const verdict = pacerRef.current.request(String(args.title ?? ""));
            if (!verdict.allow) {
              responses.push({ id: fc.id, name: fc.name, response: { status: "not_shown", instruction: verdict.instruction ?? "Explain the previous step aloud first." } });
              continue;
            }
          }
          // The teacher's speech is generated faster than it plays: show the card once the voice has caught up.
          await waitUntilIdle({ isIdle: () => playingRef.current.size === 0, isAborted: () => statusRef.current !== "live" });
        }
        if (fc.name === "search_notes") {
          const sub = subjectRef.current;
          if (!sub) {
            responses.push({ id: fc.id, name: fc.name, response: { found: false, instruction: "No subject is selected yet. Ask the student which subject they want to study, then call select_subject." } });
            continue;
          }
          const r = await teacherApi<RetrievalResult>("search", { subjectId: sub.id, query: String(args.query ?? "") });
          responses.push({
            id: fc.id, name: fc.name,
            response: {
              found: r.found,
              notes: r.references.slice(0, 5).map((x) => ({
                source: [x.chapter_title, x.topic_title, x.heading_path].filter(Boolean).join(" > "),
                text: x.content.slice(0, 1000),
              })),
              instruction: r.found ? "Teach only from these notes." : "Nothing relevant found. Tell the student it is not in their notes.",
            },
          });
        } else if (fc.name === "select_subject") {
          const list = subjectsRef.current;
          const m = matchSubjectByName(String(args.subject ?? ""), list);
          if (m) {
            subjectRef.current = m;
            onSubjectRef.current(m);
            responses.push({ id: fc.id, name: fc.name, response: { status: "selected", subject: m.name, instruction: "Subject selected. Now ask what they would like to learn, or answer their question using search_notes." } });
          } else {
            responses.push({ id: fc.id, name: fc.name, response: { status: "unknown_subject", available: list.map((x) => x.name), instruction: "Tell the student which subjects are available and ask them to choose one." } });
          }
        } else if (fc.name === "start_lesson") {
          const cat = catalogRef.current;
          const hint = String(args.subject ?? "").trim();
          const current = subjectRef.current;
          const subj =
            (hint ? matchSubjectByName(hint, cat) : null) ??
            (current ? cat.find((c) => c.id === current.id) ?? null : null) ??
            (cat.length === 1 ? cat[0] : null);
          const chapterNo = Number(args.chapter_number);
          const topicNo = args.topic_number === undefined || args.topic_number === null || args.topic_number === "" ? undefined : Number(args.topic_number);
          const chapter = subj?.chapters.find((c) => c.number === chapterNo);
          const topic = !chapter
            ? undefined
            : topicNo === undefined
              ? chapter.topics[0]
              : chapter.topics.find((t) => t.label === `${chapterNo}.${topicNo}`) ??
                chapter.topics.find((t) => parseInt(t.label.split(".").pop() ?? "", 10) === topicNo);
          if (!subj) {
            responses.push({ id: fc.id, name: fc.name, response: { status: "need_subject", available: cat.map((c) => c.name), instruction: "Ask the student which subject." } });
          } else if (!chapter) {
            const nums = subj.chapters.map((c) => c.number);
            responses.push({ id: fc.id, name: fc.name, response: { status: "chapter_not_found", subject: subj.name, chapters: `${Math.min(...nums)} to ${Math.max(...nums)}`, instruction: "Tell the student that chapter does not exist and offer a valid one." } });
          } else if (!topic) {
            responses.push({ id: fc.id, name: fc.name, response: { status: "topic_not_found", topics_in_chapter: chapter.topics.map((t) => `${t.label} ${t.title}`), instruction: "Tell the student which topics this chapter has and ask which one." } });
          } else {
            const ts: TeacherSubject = { id: subj.id, name: subj.name, topics: subj.chapters.reduce((n, c) => n + c.topics.length, 0) };
            subjectRef.current = ts;
            onSubjectRef.current(ts);
            const r = await teacherApi<RetrievalResult>("search", { subjectId: subj.id, topicId: topic.id });
            responses.push({
              id: fc.id, name: fc.name,
              response: {
                status: "ok",
                subject: subj.name,
                chapter: `${chapter.number}: ${chapter.title}`,
                topic: `${topic.label} ${topic.title}`,
                topics_in_chapter: chapter.topics.map((t) => `${t.label} ${t.title}`),
                notes: r.references.slice(0, 10).map((x) => ({ source: x.heading_path, text: x.content.slice(0, 1000) })),
                more_notes_available: r.references.length > 10,
                instruction: "Start teaching this topic now, section by section from these notes. Say the chapter and topic name in one short sentence first.",
              },
            });
          }
        } else if (fc.name === "present_slide") {
          const bullets = (Array.isArray(args.bullets) ? args.bullets : []).map(String).slice(0, 7);
          pushCard({ kind: "slide", title: String(args.title ?? ""), bullets });
          pacerRef.current.shown(); responses.push({ id: fc.id, name: fc.name, response: keepGoingRef.current ? { status: "shown", instruction: KEEP_GOING } : { status: "shown" } });
        } else if (fc.name === "show_quiz") {
          const options = (Array.isArray(args.options) ? args.options : []).map(String).slice(0, 6);
          const correctIndex = Number(args.correct_index);
          if (options.length < 2 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
            responses.push({ id: fc.id, name: fc.name, response: { status: "error", message: "Provide 2-6 options and a valid correct_index." } });
          } else {
            const quiz: QuizItem = { id: `q${Date.now()}`, question: String(args.question ?? ""), options, correctIndex, explanation: args.explanation ? String(args.explanation) : null };
            pushCard({ kind: "quiz", quiz });
            responses.push({ id: fc.id, name: fc.name, response: { status: "shown", note: "Wait for the student's answer; the system will tell you their choice." } });
          }
        } else if (fc.name === "show_visual") {
          const kinds = ["scene", "timeline", "steps", "compare", "keyterms"];
          const items = (Array.isArray(args.items) ? args.items : []).slice(0, 8).map((i: any) => ({
            emoji: String(i?.emoji ?? "").slice(0, 8),
            title: String(i?.title ?? "").slice(0, 60),
            text: i?.text ? String(i.text).slice(0, 160) : undefined,
            group: i?.group ? String(i.group).slice(0, 40) : undefined,
          })).filter((i: any) => i.title);
          if (!kinds.includes(args.kind) || items.length < 2) {
            responses.push({ id: fc.id, name: fc.name, response: { status: "error", message: "Use a valid kind and at least 2 items." } });
          } else {
            pushCard({ kind: "visual", visual: { kind: args.kind, title: String(args.title ?? "").slice(0, 100), items, caption: args.caption ? String(args.caption).slice(0, 200) : undefined } });
            pacerRef.current.shown(); responses.push({ id: fc.id, name: fc.name, response: keepGoingRef.current ? { status: "shown", instruction: KEEP_GOING } : { status: "shown", note: "The visual is on the student's screen. Describe it in a few words." } });
          }
        } else if (fc.name === "ask_big_question") {
          const q = String(args.question ?? "").slice(0, 500);
          if (!q) {
            responses.push({ id: fc.id, name: fc.name, response: { status: "error", message: "A question is required." } });
          } else {
            pushCard({ kind: "bigq", question: q, hint: args.hint ? String(args.hint).slice(0, 200) : undefined });
            responses.push({ id: fc.id, name: fc.name, response: { status: "shown", note: "Ask the question aloud, then wait for the student's spoken or typed answer. Judge it against your model answer." } });
          }
        } else if (fc.name === "check_understanding") {
          pushCard({ kind: "understand", topic: args.topic ? String(args.topic).slice(0, 80) : undefined });
          responses.push({ id: fc.id, name: fc.name, response: { status: "shown", note: "Ask them aloud if they understood, then wait for their tap or answer." } });
        } else if (fc.name === "create_document") {
          const strs = (v: unknown, n: number) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => String(x).slice(0, 400));
          const sections = (Array.isArray(args.sections) ? args.sections : []).slice(0, 8)
            .map((s: any) => ({ heading: String(s?.heading ?? "").slice(0, 100), points: strs(s?.points, 12) }))
            .filter((s: any) => s.heading);
          const mcqs = (Array.isArray(args.mcqs) ? args.mcqs : []).slice(0, 8)
            .map((q: any) => ({ question: String(q?.question ?? "").slice(0, 400), options: strs(q?.options, 6), correct_index: Number(q?.correct_index), explanation: q?.explanation ? String(q.explanation).slice(0, 300) : undefined }))
            .filter((q: any) => q.question && q.options.length >= 2 && Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index < q.options.length);
          const big = (Array.isArray(args.big_questions) ? args.big_questions : []).slice(0, 4)
            .map((q: any) => ({ question: String(q?.question ?? "").slice(0, 500), answer: String(q?.answer ?? "").slice(0, 1000) }))
            .filter((q: any) => q.question);
          if (!sections.length) {
            responses.push({ id: fc.id, name: fc.name, response: { status: "error", message: "Provide at least one section with a heading." } });
          } else {
            const format = ["pdf", "word", "both"].includes(args.format) ? args.format : "both";
            pushCard({ kind: "document", format, doc: { title: String(args.title ?? "Study notes").slice(0, 120), sections, mcqs, big_questions: big } });
            responses.push({ id: fc.id, name: fc.name, response: { status: "created", note: "The notes are ready on the student's screen. Tell them they can download them from the card." } });
          }
        } else {
          responses.push({ id: fc.id, name: fc.name, response: { status: "error", message: "unknown tool" } });
        }
      } catch (e) {
        responses.push({ id: fc.id, name: fc.name, response: { status: "error", message: errMsg(e).slice(0, 120) } });
      }
    }
    try { sessionRef.current?.sendToolResponse({ functionResponses: responses }); } catch { /* session closed */ }
  }, [pushCard]);

  // ---------------------------------------------------------------- teardown
  const cleanup = useCallback(() => {
    clearSpeakTail();
    gateRef.current = createEchoGate();
    pacerRef.current = createStepPacer();
    try { sessionRef.current?.close(); } catch { /* ignore */ }
    sessionRef.current = null;
    try { workletRef.current?.disconnect(); workletRef.current?.port.close(); } catch { /* ignore */ }
    workletRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    void micCtxRef.current?.close().catch(() => {});
    micCtxRef.current = null;
    stopPlayback();
    void playCtxRef.current?.close().catch(() => {});
    playCtxRef.current = null;
    setMicLevel(0);
  }, [stopPlayback, clearSpeakTail]);

  const disconnect = useCallback(() => {
    cleanup();
    if (statusRef.current !== "error") setStatusBoth("ended");
  }, [cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  // ---------------------------------------------------------------- connect
  const sendText = useCallback((text: string, opts?: { silent?: boolean }) => {
    const t = text.trim();
    if (!t) return;
    if (!sessionRef.current || statusRef.current !== "live") { pendingTextRef.current = t; return; }
    if (!opts?.silent) {
      closeOpenBubbles();
      setTranscript((prev) => [...closeAll(prev), { kind: "text", id: msgIdRef.current++, role: "user", text: t, done: true }]);
    }
    stopPlayback(); // typing barges in on the teacher
    sessionRef.current.sendRealtimeInput({ text: t });
  }, [closeOpenBubbles, stopPlayback]);

  const connect = useCallback(async (firstMessage?: string) => {
    if (statusRef.current === "connecting" || statusRef.current === "live") return;
    setError(null); setNotice(null); setStatusBoth("connecting");
    if (firstMessage) pendingTextRef.current = firstMessage;
    try {
      const sub = loadSubscription();
      if (!sub) {
        setError("Please purchase an AI Teacher plan (Plus Plan ₹500 or Pro Plan ₹1000) to start your 1-to-1 voice class.");
        setStatusBoth("error");
        return;
      }

      const isByok500 = sub.planId === "byok_500";
      const own = prefsRef.current.apiKey.trim();

      if (isByok500 && !own) {
        setError("Your Plus Plan requires your own Google Gemini API key. Please add your key in Settings to start the class.");
        setStatusBoth("error");
        return;
      }

      // Plus Plan users always use their own key (byok: true).
      // Pro Plan users use their own key if apiMode is 'own' and key is provided; otherwise they use the Admin key.
      const shouldUseOwnKey = isByok500 || (prefsRef.current.apiMode === "own" && !!own);
      const s = await teacherApi<LiveSession>("session", {
        persona: personaPayload(prefsRef.current),
        byok: shouldUseOwnKey,
        enrolledSubjects: enrolledSubjectsRef.current,
        mode: sessionModeRef.current,
      });
      setTeacherName(s.teacherName);
      if (s.subjects?.length) subjectsRef.current = s.subjects;
      catalogRef.current = s.catalog ?? [];

      // Play-context must be created from a user gesture (this call is).
      ensurePlayCtx();

      // Microphone is optional: without it the student can still type and listen.
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        setMicAvailable(true);
      } catch {
        setMicAvailable(false);
        setNotice("Microphone is blocked, so you can type your questions and the teacher will answer by voice.");
      }

      const { GoogleGenAI, Modality } = await import("@google/genai");
      // If student provided their own key, connect straight to Google; otherwise use one-use token from Admin key.
      const ai = shouldUseOwnKey
        ? new GoogleGenAI({ apiKey: own })
        : new GoogleGenAI({ apiKey: s.token, httpOptions: { apiVersion: s.apiVersion } });

      const session = await ai.live.connect({
        model: s.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: s.systemInstruction,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voiceName } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: { slidingWindow: {} },
          // The tools were locked into the token by the server; this is the same list.
          tools: s.tools as any,
        },
        callbacks: {
          onopen: () => { setStatusBoth("live"); },
          onmessage: (m: any) => {
            const sc = m.serverContent;
            if (sc?.modelTurn?.parts) {
              for (const p of sc.modelTurn.parts) if (p.inlineData?.data) enqueueAudio(p.inlineData.data);
            }
            if (sc?.interrupted) { stopPlayback(); gateRef.current.turnEnded(); }
            if (sc?.inputTranscription?.text) appendTranscript("user", sc.inputTranscription.text);
            if (sc?.outputTranscription?.text) appendTranscript("teacher", sc.outputTranscription.text);
            if (sc?.turnComplete) { closeOpenBubbles(); gateRef.current.turnEnded(); setTurnsCompleted((n) => n + 1); }
            if (m.toolCall?.functionCalls?.length) void handleToolCalls(m.toolCall.functionCalls);
            if (m.goAway) setNotice("This session is about to end. You can start a new class right after.");
          },
          onerror: (e: any) => {
            setError(e?.message || "The voice connection had a problem.");
          },
          onclose: (e: any) => {
            const wasLive = statusRef.current === "live";
            cleanup();
            if (statusRef.current === "connecting") { setError(e?.reason || "Could not start the voice session."); setStatusBoth("error"); }
            else if (wasLive) { setNotice(e?.reason ? `Session ended: ${e.reason}` : "Session ended."); setStatusBoth("ended"); }
          },
        },
      });
      sessionRef.current = session;
      if ((statusRef.current as LiveStatus) === "connecting") setStatusBoth("live");

      // First message: the lesson/question the student asked for, or a short greeting request.
      const first = pendingTextRef.current ?? GREETING;
      pendingTextRef.current = null;
      sendText(first, { silent: first === GREETING });

      // Start streaming the microphone.
      if (stream) {
        micStreamRef.current = stream;
        const ctx = new AudioContext();
        micCtxRef.current = ctx;
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const node = new AudioWorkletNode(ctx, "pcm-capture");
        workletRef.current = node;
        node.port.onmessage = (ev) => {
          // Only re-render when the level visibly changes (this state lives in the page component).
          setMicLevel((prev) => { const next = prev * 0.6 + Math.min(1, ev.data.rms * 6) * 0.4; return Math.abs(next - prev) < 0.08 ? prev : Math.round(next * 10) / 10; });
          if (mutedRef.current || !sessionRef.current || statusRef.current !== "live") return;
          if (echoGuardRef.current && gateRef.current.micClosed(performance.now())) return; // do not let the mic hear the teacher
          try {
            sessionRef.current.sendRealtimeInput({ audio: { data: b64FromBuffer(ev.data.pcm), mimeType: "audio/pcm;rate=16000" } });
          } catch { /* socket closing */ }
        };
        ctx.createMediaStreamSource(stream).connect(node);
      }
    } catch (e) {
      cleanup();
      setError(errMsg(e));
      setStatusBoth("error");
    }
  }, [appendTranscript, cleanup, closeOpenBubbles, enqueueAudio, handleToolCalls, sendText, stopPlayback]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (mutedRef.current) { try { sessionRef.current?.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* ignore */ } }
  }, []);

  /** The student picked an option on a quiz card in the conversation. */
  const reportQuizAnswer = useCallback((quiz: QuizItem, optionIndex: number) => {
    const correct = optionIndex === quiz.correctIndex;
    sendText(
      `[Quiz result] My answer: option ${"ABCDEFGH"[optionIndex]} "${quiz.options[optionIndex]}". That is ${correct ? "correct" : `wrong; the right answer is "${quiz.options[quiz.correctIndex]}"`}. Please react to my answer and continue.`,
      { silent: true },
    );
  }, [sendText]);

  /** The student's typed answer to a big question card. */
  const answerBigQuestion = useCallback((answer: string) => {
    sendText(`[Big question answer] ${answer}`, { silent: true });
  }, [sendText]);

  /** The student tapped Got it / Somewhat / Confused on an understanding card. */
  const reportUnderstanding = useCallback((choice: "got_it" | "somewhat" | "confused") => {
    const text =
      choice === "got_it" ? "[Understanding check] I feel: Got it. Please praise me briefly and continue."
      : choice === "somewhat" ? "[Understanding check] I feel: Somewhat. Please clarify the tricky part and give one more example."
      : "[Understanding check] I feel: Confused. Please explain again more simply with a new real-life example and a new visual.";
    sendText(text, { silent: true });
  }, [sendText]);

  const reset = useCallback(() => {
    setTranscript([]);
    setError(null); setNotice(null); setStatusBoth("idle");
  }, []);

  return {
    status, error, notice, speaking, micLevel, muted, micAvailable, teacherName,
    transcript,
    turnsCompleted,
    connect, disconnect, toggleMute, interrupt, sendText, reportQuizAnswer, answerBigQuestion, reportUnderstanding, reset,
  };
}
