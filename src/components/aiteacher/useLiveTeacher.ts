import { useCallback, useEffect, useRef, useState } from "react";
import {
  teacherApi,
  type BankQuestion,
  type LiveSession,
  type RetrievalResult,
  type TeacherDocument,
  type TeacherReference,
  type TeacherSubject,
} from "@/lib/aiTeacherApi";
import { matchSubjectByName } from "@/lib/aiTeacherSubjects";
import type { QuizItem } from "./QuizCard";

export type LiveStatus = "idle" | "connecting" | "live" | "ended" | "error";

export interface TranscriptMessage { id: number; role: "user" | "teacher"; text: string; done: boolean }
export type BoardItem =
  | { kind: "slide"; id: string; title: string; bullets: string[] }
  | { kind: "quiz"; id: string; quiz: QuizItem };

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

const GREETING = "Hello! I have just joined the class. Greet me and ask which subject I want to study.";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useLiveTeacher({
  subject,
  subjects,
  onSubject,
}: {
  subject: TeacherSubject | null;
  subjects: TeacherSubject[];
  onSubject: (s: TeacherSubject) => void;
}) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [micAvailable, setMicAvailable] = useState(true);
  const [teacherName, setTeacherName] = useState("AI Teacher");
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [board, setBoard] = useState<BoardItem[]>([]);
  const [references, setReferences] = useState<TeacherReference[]>([]);
  const [documents, setDocuments] = useState<TeacherDocument[]>([]);
  const [practice, setPractice] = useState<BankQuestion[]>([]);

  const sessionRef = useRef<any>(null);
  const mutedRef = useRef(false);
  const statusRef = useRef<LiveStatus>("idle");
  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playNextRef = useRef(0);
  const playingRef = useRef(new Set<AudioBufferSourceNode>());
  const msgIdRef = useRef(1);
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const subjectsRef = useRef(subjects);
  subjectsRef.current = subjects;
  const onSubjectRef = useRef(onSubject);
  onSubjectRef.current = onSubject;
  const pendingTextRef = useRef<string | null>(null);

  const setStatusBoth = (s: LiveStatus) => { statusRef.current = s; setStatus(s); };

  // ---------------------------------------------------------------- transcript
  const appendTranscript = useCallback((role: "user" | "teacher", text: string) => {
    if (!text) return;
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && !last.done) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      // a new speaker closes any open bubble of the other speaker
      const closed = prev.map((m) => (m.done ? m : { ...m, done: true }));
      return [...closed, { id: msgIdRef.current++, role, text: text.trimStart(), done: false }];
    });
  }, []);

  const closeOpenBubbles = useCallback(() => {
    setTranscript((prev) => (prev.some((m) => !m.done) ? prev.map((m) => (m.done ? m : { ...m, done: true })) : prev));
  }, []);

  // ---------------------------------------------------------------- playback
  const ensurePlayCtx = () => {
    if (!playCtxRef.current) playCtxRef.current = new AudioContext({ sampleRate: 24000 });
    if (playCtxRef.current.state === "suspended") void playCtxRef.current.resume();
    return playCtxRef.current;
  };

  const stopPlayback = useCallback(() => {
    playingRef.current.forEach((s) => { try { s.onended = null; s.stop(); } catch { /* already stopped */ } });
    playingRef.current.clear();
    playNextRef.current = 0;
    setSpeaking(false);
  }, []);

  const enqueueAudio = useCallback((b64: string) => {
    const ctx = ensurePlayCtx();
    const data = pcm16Base64ToFloat32(b64);
    if (!data.length) return;
    const buf = ctx.createBuffer(1, data.length, 24000);
    buf.copyToChannel(data, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.03, playNextRef.current);
    src.start(startAt);
    playNextRef.current = startAt + buf.duration;
    playingRef.current.add(src);
    setSpeaking(true);
    src.onended = () => {
      playingRef.current.delete(src);
      if (playingRef.current.size === 0) setSpeaking(false);
    };
  }, []);

  // ---------------------------------------------------------------- tools
  const applyRetrieval = useCallback((r: RetrievalResult) => {
    setReferences(r.references);
    setDocuments(r.documents);
    setPractice(r.questions);
  }, []);

  const handleToolCalls = useCallback(async (calls: any[]) => {
    const responses: any[] = [];
    for (const fc of calls) {
      const args = fc.args ?? {};
      try {
        if (fc.name === "search_notes") {
          const sub = subjectRef.current;
          if (!sub) {
            responses.push({ id: fc.id, name: fc.name, response: { found: false, instruction: "No subject is selected yet. Ask the student which subject they want to study, then call select_subject." } });
            continue;
          }
          const r = await teacherApi<RetrievalResult>("search", { subjectId: sub.id, query: String(args.query ?? "") });
          applyRetrieval(r);
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
            if (subjectRef.current?.id !== m.id) { setReferences([]); setDocuments([]); setPractice([]); }
            subjectRef.current = m;
            onSubjectRef.current(m);
            responses.push({ id: fc.id, name: fc.name, response: { status: "selected", subject: m.name, instruction: "Subject selected. Now ask what they would like to learn, or answer their question using search_notes." } });
          } else {
            responses.push({ id: fc.id, name: fc.name, response: { status: "unknown_subject", available: list.map((x) => x.name), instruction: "Tell the student which subjects are available and ask them to choose one." } });
          }
        } else if (fc.name === "present_slide") {
          const bullets = (Array.isArray(args.bullets) ? args.bullets : []).map(String).slice(0, 7);
          setBoard((b) => [...b, { kind: "slide", id: `s${Date.now()}`, title: String(args.title ?? ""), bullets }]);
          responses.push({ id: fc.id, name: fc.name, response: { status: "shown" } });
        } else if (fc.name === "show_quiz") {
          const options = (Array.isArray(args.options) ? args.options : []).map(String).slice(0, 6);
          const correctIndex = Number(args.correct_index);
          if (options.length < 2 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
            responses.push({ id: fc.id, name: fc.name, response: { status: "error", message: "Provide 2-6 options and a valid correct_index." } });
          } else {
            const quiz: QuizItem = { id: `q${Date.now()}`, question: String(args.question ?? ""), options, correctIndex, explanation: args.explanation ? String(args.explanation) : null };
            setBoard((b) => [...b, { kind: "quiz", id: quiz.id, quiz }]);
            responses.push({ id: fc.id, name: fc.name, response: { status: "shown", note: "Wait for the student's answer; the system will tell you their choice." } });
          }
        } else {
          responses.push({ id: fc.id, name: fc.name, response: { status: "error", message: "unknown tool" } });
        }
      } catch (e) {
        responses.push({ id: fc.id, name: fc.name, response: { status: "error", message: errMsg(e).slice(0, 120) } });
      }
    }
    try { sessionRef.current?.sendToolResponse({ functionResponses: responses }); } catch { /* session closed */ }
  }, [applyRetrieval]);

  // ---------------------------------------------------------------- teardown
  const cleanup = useCallback(() => {
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
  }, [stopPlayback]);

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
      setTranscript((prev) => [...prev, { id: msgIdRef.current++, role: "user", text: t, done: true }]);
    }
    stopPlayback(); // typing barges in on the teacher
    sessionRef.current.sendRealtimeInput({ text: t });
  }, [closeOpenBubbles, stopPlayback]);

  const connect = useCallback(async (firstMessage?: string) => {
    if (statusRef.current === "connecting" || statusRef.current === "live") return;
    setError(null); setNotice(null); setStatusBoth("connecting");
    if (firstMessage) pendingTextRef.current = firstMessage;
    try {
      const s = await teacherApi<LiveSession>("session");
      setTeacherName(s.teacherName);
      if (s.subjects?.length) subjectsRef.current = s.subjects;

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

      const { GoogleGenAI, Modality, Type } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: s.token, httpOptions: { apiVersion: s.apiVersion } });

      const tools = [{
        functionDeclarations: [
          {
            name: "select_subject",
            description: "Select the subject the student wants to study. Call it as soon as the student names a subject.",
            parameters: { type: Type.OBJECT, properties: { subject: { type: Type.STRING, description: "The exact subject name from the list of subjects you can teach." } }, required: ["subject"] },
          },
          {
            name: "search_notes",
            description: "Search the study notes of this subject. Call this before teaching or answering any subject question.",
            parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "The topic or question to look up, in English." } }, required: ["query"] },
          },
          {
            name: "present_slide",
            description: "Show a slide on the student's board while you explain.",
            parameters: {
              type: Type.OBJECT,
              properties: { title: { type: Type.STRING }, bullets: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3 to 5 short bullet points" } },
              required: ["title", "bullets"],
            },
          },
          {
            name: "show_quiz",
            description: "Show ONE multiple-choice question on the board to check the student's understanding.",
            parameters: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Exactly 4 options" },
                correct_index: { type: Type.INTEGER, description: "0-based index of the correct option" },
                explanation: { type: Type.STRING, description: "One-sentence explanation of the answer" },
              },
              required: ["question", "options", "correct_index", "explanation"],
            },
          },
        ],
      }];

      const session = await ai.live.connect({
        model: s.model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: s.systemInstruction,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voiceName } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: { slidingWindow: {} },
          tools,
        },
        callbacks: {
          onopen: () => { setStatusBoth("live"); },
          onmessage: (m: any) => {
            const sc = m.serverContent;
            if (sc?.modelTurn?.parts) {
              for (const p of sc.modelTurn.parts) if (p.inlineData?.data) enqueueAudio(p.inlineData.data);
            }
            if (sc?.interrupted) stopPlayback();
            if (sc?.inputTranscription?.text) appendTranscript("user", sc.inputTranscription.text);
            if (sc?.outputTranscription?.text) appendTranscript("teacher", sc.outputTranscription.text);
            if (sc?.turnComplete) closeOpenBubbles();
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
          setMicLevel((prev) => prev * 0.6 + Math.min(1, ev.data.rms * 6) * 0.4);
          if (mutedRef.current || !sessionRef.current || statusRef.current !== "live") return;
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

  /** The student picked an option on a board quiz or a practice question. */
  const reportQuizAnswer = useCallback((quiz: QuizItem, optionIndex: number) => {
    const correct = optionIndex === quiz.correctIndex;
    sendText(
      `[Quiz result] My answer: option ${"ABCDEFGH"[optionIndex]} "${quiz.options[optionIndex]}". That is ${correct ? "correct" : `wrong; the right answer is "${quiz.options[quiz.correctIndex]}"`}. Please react to my answer and continue.`,
      { silent: true },
    );
  }, [sendText]);

  /** Preload the lesson's notes into the side panel; the teacher fetches them itself via search_notes. */
  const preloadTopic = useCallback(async (topicId: string) => {
    const sub = subjectRef.current;
    if (!sub) return;
    try { applyRetrieval(await teacherApi<RetrievalResult>("search", { subjectId: sub.id, topicId })); } catch { /* panel stays as is */ }
  }, [applyRetrieval]);

  const reset = useCallback(() => {
    setTranscript([]); setBoard([]); setReferences([]); setDocuments([]); setPractice([]);
    setError(null); setNotice(null); setStatusBoth("idle");
  }, []);

  return {
    status, error, notice, speaking, micLevel, muted, micAvailable, teacherName,
    transcript, board, references, documents, practice,
    connect, disconnect, toggleMute, sendText, reportQuizAnswer, preloadTopic, reset,
  };
}
