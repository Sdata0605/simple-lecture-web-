// Plays the pre-generated assistant voice clips (see assistantAudioManifest)
// one at a time from a queue, exposes the current line as a caption, and a
// per-frame level for the VoiceOrb.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ASSISTANT_CLIPS } from "./assistantAudioManifest";
import type { AssistantClip, AssistantClipCategory } from "./assistantAudioTypes";
import { createClipPicker } from "./clipPicker";

// When autoplay is blocked we still show the line and move the flow on after
// roughly the time it would have taken to say it.
const BLOCKED_CAPTION_MS = 1600;

interface QueuedLine {
  clip: AssistantClip;
  onEnd?: () => void;
}

export interface AssistantVoice {
  /** Queue a random line from `category`; `onEnd` fires when it finishes (or is skipped because audio is blocked). */
  say: (category: AssistantClipCategory, onEnd?: () => void) => void;
  /** Stop talking now and drop anything queued. Pending onEnd callbacks are NOT called. */
  interrupt: () => void;
  speaking: boolean;
  caption: string | null;
  getLevel: () => number;
}

export function useAssistantVoice(): AssistantVoice {
  const picker = useMemo(() => createClipPicker(ASSISTANT_CLIPS), []);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<QueuedLine[]>([]);
  const currentRef = useRef<QueuedLine | null>(null);
  // onEnd callbacks of finished lines, held until the whole queue drains —
  // callers use onEnd to open the mic, which must never happen mid-clip.
  const drainCallbacksRef = useRef<(() => void)[]>([]);
  const blockedTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const analyserTriedRef = useRef(false);
  const startedAtRef = useRef(0);

  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);

  const getAudio = () => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audioRef.current = audio;
    }
    return audioRef.current;
  };

  // Real level metering routes the element through Web Audio — irreversible,
  // and if the context is ever suspended the clip plays silently. Mobile
  // browsers (iOS especially, when speech recognition switches the audio
  // session) can suspend it at any time, so touch devices never attach and
  // use the synthetic envelope; desktop only attaches once it's running.
  const tryAttachAnalyser = useCallback(async (audio: HTMLAudioElement) => {
    if (analyserTriedRef.current) return;
    analyserTriedRef.current = true;
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      if (ctx.state !== "running") await ctx.resume().catch(() => {});
      if (!mountedRef.current || ctx.state !== "running") {
        void ctx.close().catch(() => {});
        return;
      }
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      analyserBufRef.current = new Uint8Array(analyser.fftSize);
    } catch {
      /* fall back to the synthetic envelope */
    }
  }, []);

  const clearBlockedTimer = () => {
    if (blockedTimerRef.current) {
      window.clearTimeout(blockedTimerRef.current);
      blockedTimerRef.current = null;
    }
  };

  const playNextRef = useRef<() => void>(() => {});

  const finishCurrent = useCallback(() => {
    const done = currentRef.current;
    currentRef.current = null;
    clearBlockedTimer();
    if (done?.onEnd) drainCallbacksRef.current.push(done.onEnd);
    if (queueRef.current.length > 0) {
      playNextRef.current();
      return;
    }
    setSpeaking(false);
    const callbacks = drainCallbacksRef.current;
    drainCallbacksRef.current = [];
    callbacks.forEach((cb) => cb());
  }, []);

  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      setSpeaking(false);
      return;
    }
    currentRef.current = next;
    setCaption(next.clip.text);
    setSpeaking(true);
    startedAtRef.current = performance.now();

    const audio = getAudio();
    audio.onended = () => {
      if (currentRef.current === next) finishCurrent();
    };
    audio.onerror = () => {
      if (currentRef.current === next) finishCurrent();
    };
    audio.src = next.clip.src;
    void tryAttachAnalyser(audio);
    // If the context got suspended since attaching, the clip would be silent.
    if (ctxRef.current?.state === "suspended") void ctxRef.current.resume().catch(() => {});
    audio.play().catch(() => {
      // Autoplay blocked or clip failed — keep the conversation moving.
      if (currentRef.current !== next) return;
      clearBlockedTimer();
      blockedTimerRef.current = window.setTimeout(() => {
        if (currentRef.current === next) finishCurrent();
      }, BLOCKED_CAPTION_MS);
    });
  }, [finishCurrent, tryAttachAnalyser]);
  playNextRef.current = playNext;

  const say = useCallback(
    (category: AssistantClipCategory, onEnd?: () => void) => {
      const clip = picker.pick(category);
      if (!clip) {
        if (!onEnd) return;
        if (currentRef.current) drainCallbacksRef.current.push(onEnd);
        else onEnd();
        return;
      }
      queueRef.current.push({ clip, onEnd });
      if (!currentRef.current) playNext();
    },
    [picker, playNext],
  );

  const interrupt = useCallback(() => {
    queueRef.current = [];
    currentRef.current = null;
    drainCallbacksRef.current = [];
    clearBlockedTimer();
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    setSpeaking(false);
  }, []);

  const getLevel = useCallback(() => {
    if (!currentRef.current) return 0;
    const analyser = analyserRef.current;
    const buf = analyserBufRef.current;
    if (analyser && buf) {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / buf.length) * 4);
    }
    // Synthetic syllable-ish envelope while a line is "playing".
    const t = (performance.now() - startedAtRef.current) / 1000;
    const syllables = Math.abs(Math.sin(t * 9.1)) * 0.55 + Math.abs(Math.sin(t * 3.7 + 1.3)) * 0.3;
    return Math.min(1, 0.15 + syllables);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueRef.current = [];
      currentRef.current = null;
      drainCallbacksRef.current = [];
      clearBlockedTimer();
      const audio = audioRef.current;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      void ctxRef.current?.close().catch(() => {});
      // The element is bound to the context we just closed — reusing it (e.g.
      // StrictMode's dev remount) would play silently, so drop both together.
      audioRef.current = null;
      ctxRef.current = null;
      analyserRef.current = null;
      analyserBufRef.current = null;
      analyserTriedRef.current = false;
    };
  }, []);

  return { say, interrupt, speaking, caption, getLevel };
}
