/**
 * Headless hands-free speech layer for the "Ask AI" voice assistant.
 *
 * start() opens the mic and listens with no tap; when the student stops talking
 * the utterance detector (./utteranceDetector.ts) decides the utterance is over,
 * the hook STOPS ITSELF (status "off", mic + voiceLock released) and only then
 * invokes onUtterance / onUnclear / onNoSpeechTimeout. Call start() again to
 * listen again. interimText is cleared on start(), not on stop(), so the last
 * transcript stays readable until the next listen.
 *
 * Browser notes:
 *  - Chrome/Edge (desktop + Android): full support. Chrome's recognizer is
 *    cloud-based (needs network) and ends sessions on its own; we auto-restart
 *    with a restart-storm backoff because Android beeps on every start().
 *  - Mobile (coarse pointer): no getUserMedia stream is held (Android mic
 *    contention kills SpeechRecognition); the level meter is synthesized from
 *    recognition events instead.
 *  - iOS Safari: webkitSpeechRecognition exists (14.5+) but is flaky —
 *    requires Siri/Dictation enabled, sessions end on short pauses (handled by
 *    restart), first start may need a user gesture.
 *  - Firefox: no SpeechRecognition → `supported === false`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { voiceLock } from "@/lib/voiceLock";
import {
  collectResults,
  createRestartThrottle,
  createUtteranceDetector,
  joinText,
  type RecognitionResultLike,
  type UtteranceDetector,
} from "./utteranceDetector";

export type HandsFreeStatus = "off" | "starting" | "listening" | "hearing" | "error";

export interface HandsFreeSpeechOptions {
  lang?: string; // default "en-IN"; applied on next start()
  silenceMs?: number; // end-of-utterance silence after speech, default 1400
  noSpeechTimeoutMs?: number; // nothing heard at all since start → give up, default 30000
  minChars?: number; // shorter transcript counts as unclear, default 3
  onUtterance: (text: string) => void;
  onUnclear?: () => void; // speech/noise detected but transcript empty or too short
  onNoSpeechTimeout?: () => void;
}

export interface HandsFreeSpeech {
  supported: boolean;
  status: HandsFreeStatus;
  interimText: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  getLevel: () => number;
}

// ── Tunables ─────────────────────────────────────────────────────────────────
const DEFAULT_LANG = "en-IN";
const DEFAULT_SILENCE_MS = 1400;
const DEFAULT_NO_SPEECH_TIMEOUT_MS = 30_000;
const DEFAULT_MIN_CHARS = 3;
const TICK_MS = 100;
/** "hearing" falls back to "listening" after this long without speech activity. */
const HEARING_HOLD_MS = 900;
/** Consecutive network errors (without a result in between) before giving up. */
const MAX_NETWORK_ERRORS = 3;
/** Consecutive foreign "aborted" errors before giving up (another recognizer fighting us). */
const MAX_FOREIGN_ABORTS = 4;
// Analyser (desktop) level mapping
const NOISE_GATE_RMS = 0.01;
const LEVEL_GAIN = 10;
// Synthetic (mobile) level
const SYNTH_HALF_LIFE_MS = 300;
const OWNER = "askAssistant" as const;

// ── Minimal Web Speech typings (not in TS's DOM lib) ─────────────────────────
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SRAlternative;
}
interface SRResultList {
  readonly length: number;
  [index: number]: SRResult;
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRErrorEvent {
  error: string;
  message?: string;
}
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SR;

function getRecognitionCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function isCoarsePointer(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
  } catch {
    return false;
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

interface AnalyserRig {
  ctx: AudioContext;
  stream: MediaStream;
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
}

async function openAnalyser(): Promise<AnalyserRig> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  try {
    const AC: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    // Called right after a TTS clip: the page has sticky activation, so resume works.
    // Don't await — resume() can stay pending without activation.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser); // not connected to destination — no playback
    return { ctx, stream, analyser, buf: new Float32Array(analyser.fftSize) };
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
}

function closeRig(rig: AnalyserRig | null) {
  if (!rig) return;
  rig.stream.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  });
  if (rig.ctx.state !== "closed") rig.ctx.close().catch(() => {});
}

function detach(r: SR) {
  r.onstart = r.onaudiostart = r.onsoundstart = r.onspeechstart = r.onspeechend = r.onend = null;
  r.onresult = null;
  r.onerror = null;
}

// ── Engine (plain closure; React only mirrors its state) ─────────────────────
interface EngineDeps {
  getOpts: () => HandsFreeSpeechOptions;
  setStatus: (s: HandsFreeStatus) => void;
  setInterim: (t: string) => void;
  setError: (e: string | null) => void;
}

function createEngine(d: EngineDeps) {
  let active = false;
  let runId = 0; // bumps on every start/teardown; invalidates in-flight async work
  let sessionId = 0; // bumps per recognition instance; invalidates stale handlers
  let startPromise: Promise<void> | null = null;
  let status: HandsFreeStatus = "off";

  let rec: SR | null = null;
  let detector: UtteranceDetector | null = null;
  let lang = DEFAULT_LANG;
  let noSpeechTimeoutMs = DEFAULT_NO_SPEECH_TIMEOUT_MS;

  let committed = ""; // text from recognition sessions that already ended (this listen)
  let sessionFinal = "";
  let sessionInterim = "";

  let startedAt = 0;
  let heard = false;
  let lastActivityAt = 0;

  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  const throttle = createRestartThrottle({ baseDelayMs: 150, backoffDelayMs: 1000, windowMs: 5000, maxInWindow: 5 });
  let networkErrors = 0;
  let foreignAborts = 0;
  let audioCaptureRetried = false;
  let forceSynthetic = false; // sticky for the hook's lifetime once audio-capture conflicts

  let levelMode: "off" | "analyser" | "synthetic" = "off";
  let rig: AnalyserRig | null = null;
  let smoothed = 0;
  let synthPeak = 0;
  let synthAt = 0;

  const setStatus = (s: HandsFreeStatus) => {
    if (status === s) return;
    status = s;
    d.setStatus(s);
  };

  // ── level ──
  const bump = () => {
    if (levelMode !== "synthetic") return;
    synthPeak = 0.6 + Math.random() * 0.3;
    synthAt = now();
  };

  const getLevel = (): number => {
    if (!active) return 0;
    if (levelMode === "analyser" && rig) {
      const { analyser, buf } = rig;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const gated = Math.max(0, rms - NOISE_GATE_RMS);
      const target = Math.min(1, Math.pow(gated * LEVEL_GAIN, 0.8));
      // fast attack, slower release
      smoothed += (target - smoothed) * (target > smoothed ? 0.5 : 0.12);
      return smoothed < 0.005 ? 0 : Math.min(1, smoothed);
    }
    if (levelMode === "synthetic") {
      const t = now();
      const v = synthPeak * Math.pow(0.5, (t - synthAt) / SYNTH_HALF_LIFE_MS);
      if (v < 0.01) return 0;
      return Math.min(1, v * (0.9 + 0.1 * Math.sin(t / 45)));
    }
    return 0;
  };

  // ── lifecycle ──
  const clearTimers = () => {
    if (tickTimer) clearInterval(tickTimer);
    if (restartTimer) clearTimeout(restartTimer);
    tickTimer = null;
    restartTimer = null;
  };

  const dropRig = () => {
    closeRig(rig);
    rig = null;
    smoothed = 0;
  };

  const teardown = () => {
    active = false;
    runId++;
    sessionId++;
    startPromise = null;
    clearTimers();
    if (rec) {
      const r = rec;
      rec = null;
      detach(r); // our own abort must not surface as error/end
      try {
        r.abort();
      } catch {
        /* ignore */
      }
    }
    dropRig();
    levelMode = "off";
    synthPeak = 0;
    detector?.reset();
    detector = null;
    voiceLock.release(OWNER);
  };

  const stop = () => {
    const wasActive = active;
    teardown();
    if (wasActive) setStatus("off"); // an existing "error" status survives a redundant stop()
  };

  const fail = (code: string) => {
    teardown();
    d.setError(code);
    setStatus("error");
  };

  const finish = (invoke: () => void) => {
    stop(); // mic released BEFORE the app reacts (it will play clips next)
    try {
      invoke();
    } catch (e) {
      console.error("[useHandsFreeSpeech] callback threw:", e);
    }
  };

  const markActivity = () => {
    heard = true;
    lastActivityAt = now();
    if (status === "listening" || status === "starting") setStatus("hearing");
  };

  const onTick = () => {
    if (!active || !detector) return;
    const t = now();
    const dec = detector.push({ type: "tick", at: t });
    if (dec.kind === "finalize") {
      const text = dec.text;
      finish(() => d.getOpts().onUtterance(text));
      return;
    }
    if (dec.kind === "unclear") {
      finish(() => d.getOpts().onUnclear?.());
      return;
    }
    if (!heard && !detector.inUtterance && t - startedAt >= noSpeechTimeoutMs) {
      finish(() => d.getOpts().onNoSpeechTimeout?.());
      return;
    }
    if (status === "hearing" && t - lastActivityAt > HEARING_HOLD_MS) setStatus("listening");
  };

  const scheduleRestart = () => {
    if (!active || restartTimer) return;
    const delay = throttle.next(now());
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (active && !rec) startRecognition();
    }, delay);
  };

  const handleError = (code: string) => {
    switch (code) {
      case "no-speech": // Chrome's own silence timeout — onend will restart us
        return;
      case "aborted":
        // Our own aborts are detached before abort(), so this is foreign
        // (e.g. another recognizer on the page). Tolerate a few, then give up.
        if (++foreignAborts >= MAX_FOREIGN_ABORTS) fail("aborted");
        return;
      case "network":
        if (++networkErrors >= MAX_NETWORK_ERRORS) fail("network");
        return;
      case "audio-capture":
        if (levelMode === "analyser" && !audioCaptureRetried) {
          // Our analyser stream is probably contending for the mic: drop it,
          // go synthetic, and let onend restart recognition once.
          audioCaptureRetried = true;
          forceSynthetic = true;
          dropRig();
          levelMode = "synthetic";
          return;
        }
        fail("audio-capture");
        return;
      default: // not-allowed, service-not-allowed, language-not-supported, bad-grammar, …
        fail(code || "unknown");
    }
  };

  function startRecognition() {
    if (!active) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      fail("not-supported");
      return;
    }
    const id = ++sessionId;
    let r: SR;
    try {
      r = new Ctor();
    } catch {
      fail("not-supported");
      return;
    }
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    sessionFinal = "";
    sessionInterim = "";
    const live = () => id === sessionId && active;

    const opened = () => {
      if (live() && status === "starting") setStatus("listening");
    };
    r.onstart = opened;
    r.onaudiostart = opened;
    r.onsoundstart = () => {
      if (live()) bump();
    };
    r.onspeechstart = () => {
      if (!live()) return;
      detector?.push({ type: "speechStart", at: now() });
      markActivity();
      bump();
    };
    r.onspeechend = () => {
      if (live() && status === "hearing") setStatus("listening");
    };
    r.onresult = (ev) => {
      if (!live()) return;
      networkErrors = 0;
      foreignAborts = 0;
      const list: RecognitionResultLike[] = [];
      const results = ev.results;
      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        list.push({ isFinal: !!res?.isFinal, transcript: res?.[0]?.transcript ?? "" });
      }
      const { finalText, interimText } = collectResults(list);
      sessionFinal = finalText;
      sessionInterim = interimText;
      const fullFinal = joinText(committed, finalText);
      detector?.push({ type: "result", at: now(), finalText: fullFinal, interimText });
      d.setInterim(joinText(fullFinal, interimText));
      markActivity();
      bump();
    };
    r.onerror = (ev) => {
      if (live()) handleError(ev?.error ?? "unknown");
    };
    r.onend = () => {
      if (id !== sessionId) return;
      detach(r);
      if (rec === r) rec = null;
      if (!active) return;
      // Keep what this session heard — including an interim chunk Chrome never finalized.
      committed = joinText(committed, sessionFinal, sessionInterim);
      sessionFinal = "";
      sessionInterim = "";
      scheduleRestart();
    };

    rec = r;
    try {
      r.start();
    } catch {
      // InvalidStateError etc. — throw this instance away and retry (throttled).
      detach(r);
      if (rec === r) rec = null;
      scheduleRestart();
    }
  }

  const start = (): Promise<void> => {
    if (active) return startPromise ?? Promise.resolve();
    if (!getRecognitionCtor()) {
      d.setError("not-supported");
      setStatus("error");
      return Promise.resolve();
    }

    active = true;
    const myRun = ++runId;
    const o = d.getOpts();
    lang = o.lang || DEFAULT_LANG;
    noSpeechTimeoutMs = o.noSpeechTimeoutMs ?? DEFAULT_NO_SPEECH_TIMEOUT_MS;
    detector = createUtteranceDetector({
      silenceMs: o.silenceMs ?? DEFAULT_SILENCE_MS,
      minChars: o.minChars ?? DEFAULT_MIN_CHARS,
    });
    committed = sessionFinal = sessionInterim = "";
    heard = false;
    lastActivityAt = 0;
    networkErrors = 0;
    foreignAborts = 0;
    audioCaptureRetried = false;
    throttle.reset();
    synthPeak = 0;
    smoothed = 0;
    d.setError(null);
    d.setInterim("");
    setStatus("starting");

    voiceLock.acquire(OWNER); // releases whichever feature held the mic
    voiceLock.onRelease(OWNER, () => {
      if (active) stop();
    });

    const p = (async () => {
      const wantAnalyser =
        !forceSynthetic &&
        !isCoarsePointer() &&
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia;
      if (wantAnalyser) {
        try {
          const r = await openAnalyser();
          if (myRun !== runId || !active) {
            closeRig(r);
            return;
          }
          rig = r;
          levelMode = "analyser";
        } catch (e) {
          if (myRun !== runId || !active) return;
          const name = (e as { name?: string } | null)?.name;
          if (name === "NotAllowedError" || name === "SecurityError") {
            fail("not-allowed");
            return;
          }
          levelMode = "synthetic"; // no analyser (busy/missing device) — recognition may still work
        }
      } else {
        levelMode = "synthetic";
      }
      if (myRun !== runId || !active) return;
      startedAt = now();
      tickTimer = setInterval(onTick, TICK_MS);
      startRecognition();
    })();
    startPromise = p;
    return p;
  };

  return { start, stop, getLevel };
}

type Engine = ReturnType<typeof createEngine>;

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useHandsFreeSpeech(opts: HandsFreeSpeechOptions): HandsFreeSpeech {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [status, setStatus] = useState<HandsFreeStatus>("off");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(false);
  const engineRef = useRef<Engine | null>(null);
  if (!engineRef.current) {
    engineRef.current = createEngine({
      getOpts: () => optsRef.current,
      setStatus: (s) => {
        if (mountedRef.current) setStatus(s);
      },
      setInterim: (t) => {
        if (mountedRef.current) setInterimText(t);
      },
      setError: (e) => {
        if (mountedRef.current) setError(e);
      },
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    const engine = engineRef.current;
    return () => {
      mountedRef.current = false;
      engine?.stop();
    };
  }, []);

  const start = useCallback(() => engineRef.current!.start(), []);
  const stop = useCallback(() => engineRef.current!.stop(), []);
  const getLevel = useCallback(() => engineRef.current!.getLevel(), []);

  return { supported, status, interimText, error, start, stop, getLevel };
}
