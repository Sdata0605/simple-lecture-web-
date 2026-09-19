// Standalone player for a post-lecture Athena answer. Deliberately separate
// from V5Player (own file, own CSS namespace, own state) — styled to feel
// like the same family (same dark palette + fullscreen/orientation
// conventions as v5-player.css) without sharing or touching its code.
//
// Mirrors the mechanics of Athena's own reference player (verified by
// reading /frontend-static/player.js on the Athena server): each "beat"
// (segment) is a GSAP-animated HTML page in a sandboxed iframe, fixed at
// 1920x1080 and scaled to fit via a CSS var; the narration MP3 is the master
// clock — its "ended" event advances to the next beat.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Pause,
  Play,
  Sparkles,
} from "lucide-react";
import type { AthenaSegment, HyperframeVideoStatus } from "@/lib/api/athenaAsk";
import { resolveHyperframeAssetUrl } from "@/lib/api/athenaAsk";
import type { PostLectureAnswerPhase } from "@/hooks/usePostLectureAthenaAnswer";
import "./hyperframe-player.css";

interface HyperframeAnswerPlayerProps {
  answerId: string | null;
  phase: PostLectureAnswerPhase;
  segments: AthenaSegment[];
  video: HyperframeVideoStatus | null;
  errorMessage: string | null;
  questionText: string;
  onClose: () => void;
}

type Voice = "female" | "male";

export function HyperframeAnswerPlayer({
  answerId,
  phase,
  segments,
  video,
  errorMessage,
  questionText,
  onClose,
}: HyperframeAnswerPlayerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const frameEls = useRef<(HTMLIFrameElement | null)[]>([]);
  const femaleAudioEls = useRef<(HTMLAudioElement | null)[]>([]);
  const maleAudioEls = useRef<(HTMLAudioElement | null)[]>([]);
  const frameReady = useRef<boolean[]>([]);
  const advanceTimerRef = useRef<number | null>(null);

  const [voice, setVoice] = useState<Voice>("female");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [beatCount, setBeatCount] = useState(0);

  const currentAudioEls = useCallback(
    (idx: number) => (voice === "female" ? femaleAudioEls.current[idx] : maleAudioEls.current[idx]),
    [voice],
  );

  const getTimeline = (idx: number): any => {
    try {
      const win = frameEls.current[idx]?.contentWindow as any;
      const timelines = win?.__timelines;
      return (timelines && (timelines.main || Object.values(timelines)[0])) || null;
    } catch {
      return null;
    }
  };
  const playFrame = (idx: number) => {
    try {
      getTimeline(idx)?.play(0);
    } catch {
      /* noop */
    }
  };
  const pauseFrame = (idx: number) => {
    try {
      getTimeline(idx)?.pause();
    } catch {
      /* noop */
    }
  };
  const resumeFrame = (idx: number) => {
    try {
      getTimeline(idx)?.play();
    } catch {
      /* noop */
    }
  };
  const stopFrame = (idx: number) => {
    try {
      const tl = getTimeline(idx);
      if (tl) {
        tl.pause();
        tl.progress(0);
      }
    } catch {
      /* noop */
    }
  };

  const clearAdvanceTimer = () => {
    if (advanceTimerRef.current) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  };

  const playBeat = useCallback(
    (idx: number) => {
      const total = video?.html_paths.length ?? 0;
      if (idx < 0 || idx >= total) return;
      clearAdvanceTimer();

      frameEls.current.forEach((f, i) => {
        if (!f) return;
        f.style.opacity = i === idx ? "1" : "0";
        if (i !== idx) stopFrame(i);
      });
      [...femaleAudioEls.current, ...maleAudioEls.current].forEach((a, rawIdx) => {
        const i = rawIdx % total;
        if (a && i !== idx) {
          a.pause();
          a.currentTime = 0;
        }
      });

      setCurrentIdx(idx);
      if (frameReady.current[idx]) playFrame(idx);

      const audio = currentAudioEls(idx);
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        // No audio for this beat — advance on an estimated timer so playback
        // never stalls.
        const seg = segments[idx];
        const secs = Math.max(
          6,
          Math.min(20, seg?.t_end && seg?.t_start ? seg.t_end - seg.t_start : 8),
        );
        advanceTimerRef.current = window.setTimeout(() => onBeatEnded(idx), secs * 1000);
      }
      setPlaying(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [video, segments, currentAudioEls],
  );

  const onBeatEnded = (idx: number) => {
    if (idx !== currentIdxRef.current) return;
    const total = video?.html_paths.length ?? 0;
    if (idx + 1 < total) {
      window.setTimeout(() => playBeat(idx + 1), 400);
    } else {
      setPlaying(false);
    }
  };

  // Keep a ref mirror of currentIdx so the audio "ended" closures (bound
  // once per beat, not re-bound every render) always see the latest value.
  const currentIdxRef = useRef(0);
  useEffect(() => {
    currentIdxRef.current = currentIdx;
  }, [currentIdx]);

  const togglePlayPause = () => {
    if (playing) {
      pauseFrame(currentIdx);
      currentAudioEls(currentIdx)?.pause();
      setPlaying(false);
    } else {
      resumeFrame(currentIdx);
      currentAudioEls(currentIdx)?.play().catch(() => {});
      setPlaying(true);
    }
  };

  const switchVoice = (next: Voice) => {
    if (next === voice) return;
    const prevAudio = voice === "female" ? femaleAudioEls.current[currentIdx] : maleAudioEls.current[currentIdx];
    const at = prevAudio?.currentTime ?? 0;
    prevAudio?.pause();
    setVoice(next);
    const nextAudio = next === "female" ? femaleAudioEls.current[currentIdx] : maleAudioEls.current[currentIdx];
    if (nextAudio) {
      nextAudio.currentTime = at;
      if (playing) nextAudio.play().catch(() => {});
    }
  };

  // Build the beat player once html_paths becomes available.
  useEffect(() => {
    if (!video || !answerId || video.html_paths.length === 0) return;
    const total = video.html_paths.length;
    frameReady.current = new Array(total).fill(false);
    frameEls.current = new Array(total).fill(null);
    femaleAudioEls.current = new Array(total).fill(null);
    maleAudioEls.current = new Array(total).fill(null);
    setBeatCount(total);
    setCurrentIdx(0);
    // playBeat(0) fires from a separate effect once refs are attached
    // (they're null on this same render pass).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, answerId]);

  useEffect(() => {
    if (!video || video.html_paths.length === 0) return;
    const t = window.setTimeout(() => playBeat(0), 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.html_paths.join("|")]);

  // Scale the fixed 1920x1080 iframes to fit the wrapper.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const apply = () => {
      const w = wrapper.clientWidth || 0;
      if (w > 0) wrapper.style.setProperty("--hf-scale", String(w / 1920));
    };
    apply();
    const obs = new ResizeObserver(apply);
    obs.observe(wrapper);
    return () => obs.disconnect();
  }, [beatCount]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      clearAdvanceTimer();
      femaleAudioEls.current.forEach((a) => a?.pause());
      maleAudioEls.current.forEach((a) => a?.pause());
    };
  }, []);

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const hasVideo = !!video && video.html_paths.length > 0;
  const currentSegment = segments[currentIdx];

  return createPortal(
    <div className="hf-player">
      <div className="hf-header">
        <button type="button" className="hf-header__close" onClick={onClose} aria-label="Close">
          <ArrowLeft size={18} />
        </button>
        <div className="hf-header__title">{questionText || "Your question"}</div>
        {hasVideo && <span className="hf-header__badge">HyperFrame</span>}
      </div>

      <div className="hf-stage" ref={stageRef}>
        {(phase === "asking" || phase === "streaming") && segments.length === 0 && (
          <div className="hf-thinking">
            <Sparkles className="h-4 w-4 animate-pulse" />
            Thinking…
          </div>
        )}

        {phase === "out_of_scope" && (
          <div className="hf-notice">
            <p>{errorMessage || "This doesn't seem to be part of this lecture."}</p>
          </div>
        )}

        {phase === "error" && (
          <div className="hf-notice">
            <p>{errorMessage || "Something went wrong answering that."}</p>
          </div>
        )}

        {!hasVideo && segments.length > 0 && phase !== "out_of_scope" && phase !== "error" && (
          <div className="hf-text-cards">
            {segments.map((seg, i) => (
              <div key={i} className="hf-seg-card">
                {seg.type && seg.type !== "concept" && <span className="hf-seg-card__type">{seg.type}</span>}
                <div
                  className="hf-seg-card__text"
                  // Athena-generated HTML (bold/emphasis spans), same trust
                  // boundary as the Doubts tab's markdown renderer.
                  dangerouslySetInnerHTML={{ __html: seg.html || seg.plain || "" }}
                />
              </div>
            ))}
            {phase === "awaiting_video" && (
              <div className="hf-thinking">
                <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                Rendering video…
              </div>
            )}
          </div>
        )}

        {hasVideo && answerId && (
          <>
            <div className="hf-video-wrapper" ref={wrapperRef}>
              <span className="hf-beat-counter">
                {currentIdx + 1} / {beatCount}
              </span>
              {video.html_paths.map((path, i) => (
                <iframe
                  key={i}
                  ref={(el) => (frameEls.current[i] = el)}
                  className="hf-frame"
                  title={`Answer beat ${i + 1}`}
                  sandbox="allow-scripts allow-same-origin"
                  scrolling="no"
                  loading="eager"
                  src={resolveHyperframeAssetUrl(answerId, path)}
                  style={{ opacity: i === currentIdx ? 1 : 0 }}
                  onLoad={() => {
                    frameReady.current[i] = true;
                    if (i === currentIdxRef.current) playFrame(i);
                    else stopFrame(i);
                  }}
                />
              ))}
              {video.audio_female.map((path, i) =>
                path ? (
                  <audio
                    key={`f-${i}`}
                    ref={(el) => (femaleAudioEls.current[i] = el)}
                    src={resolveHyperframeAssetUrl(answerId, path)}
                    preload="auto"
                    onEnded={() => voice === "female" && onBeatEnded(i)}
                  />
                ) : null,
              )}
              {video.audio_male.map((path, i) =>
                path ? (
                  <audio
                    key={`m-${i}`}
                    ref={(el) => (maleAudioEls.current[i] = el)}
                    src={resolveHyperframeAssetUrl(answerId, path)}
                    preload="auto"
                    onEnded={() => voice === "male" && onBeatEnded(i)}
                  />
                ) : null,
              )}
            </div>
            <div className="hf-text-panel">
              {currentSegment?.title && <div className="hf-text-panel__title">{currentSegment.title}</div>}
              <div
                className="hf-text-panel__caption"
                dangerouslySetInnerHTML={{ __html: currentSegment?.html || currentSegment?.plain || "" }}
              />
            </div>
          </>
        )}
      </div>

      {hasVideo && (
        <div className="hf-controls">
          <button
            type="button"
            className="hf-btn"
            disabled={currentIdx === 0}
            onClick={() => playBeat(currentIdx - 1)}
            aria-label="Previous"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="hf-controls__center">
            <div className="hf-voice-toggle">
              <button
                type="button"
                className={`hf-voice-btn${voice === "female" ? " is-active" : ""}`}
                onClick={() => switchVoice("female")}
                title="Female voice"
              >
                ♀
              </button>
              <button
                type="button"
                className={`hf-voice-btn${voice === "male" ? " is-active" : ""}`}
                onClick={() => switchVoice("male")}
                title="Male voice"
              >
                ♂
              </button>
            </div>
            <button type="button" className="hf-btn hf-btn--primary" onClick={togglePlayPause} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <div className="hf-dots">
              {video!.html_paths.map((_, i) => (
                <span
                  key={i}
                  className={`hf-dot${i === currentIdx ? " is-active" : ""}`}
                  onClick={() => playBeat(i)}
                />
              ))}
            </div>
            <button type="button" className="hf-btn hf-fullscreen-btn" onClick={toggleFullscreen} aria-label="Fullscreen">
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          </div>
          <button
            type="button"
            className="hf-btn"
            disabled={currentIdx >= beatCount - 1}
            onClick={() => playBeat(currentIdx + 1)}
            aria-label="Next"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
