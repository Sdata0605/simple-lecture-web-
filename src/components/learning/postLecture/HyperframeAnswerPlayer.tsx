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
  Eye,
  EyeOff,
  Maximize,
  Minimize,
  Pause,
  Play,
  Sparkles,
} from "lucide-react";
import type { AthenaSegment, HyperframeVideoStatus } from "@/lib/api/athenaAsk";
import { resolveHyperframeAssetUrl } from "@/lib/api/athenaAsk";
import type { PostLectureAnswerPhase } from "@/hooks/usePostLectureAthenaAnswer";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
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
  const playerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const frameEls = useRef<(HTMLIFrameElement | null)[]>([]);
  const femaleAudioEls = useRef<(HTMLAudioElement | null)[]>([]);
  const maleAudioEls = useRef<(HTMLAudioElement | null)[]>([]);
  const frameReady = useRef<boolean[]>([]);
  const advanceTimerRef = useRef<number | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);
  const isMobile = useIsMobile();

  const [voice, setVoice] = useState<Voice>("female");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [beatCount, setBeatCount] = useState(0);
  // Narration caption sometimes covers part of the visual (e.g. a diagram
  // it's overlaid on) — let the student turn it off.
  const [showCaption, setShowCaption] = useState(true);
  // In fullscreen, header/controls auto-hide after a few seconds of no mouse
  // movement so they don't block the presentation; always visible otherwise.
  const [controlsVisible, setControlsVisible] = useState(true);
  // Supabase forces `Content-Type: text/plain` + a locked-down CSP on any
  // HTML an Edge Function returns (anti-phishing measure), so pointing an
  // iframe's `src` straight at the proxy URL renders the GSAP page as inert
  // text instead of executing it. Fetching the bytes ourselves and injecting
  // them via `srcdoc` sidesteps that — it's no longer a navigation, so the
  // response headers never apply.
  const [frameHtml, setFrameHtml] = useState<string[]>([]);
  // Explicit pixel size for .hf-video-wrapper, computed to fit-contain inside
  // whatever box the flex layout gives it — see the ResizeObserver effect
  // below. Fixes the video overflowing (and the stage scrolling) on short or
  // landscape screens, where width-only scaling let the 16:9 box run taller
  // than the viewport.
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });

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

  // Fetch each beat's HTML ourselves instead of pointing the iframe `src` at
  // the proxy URL — Supabase forces Content-Type: text/plain + a locked-down
  // CSP on any HTML an Edge Function returns, so a direct `src` navigation
  // renders the GSAP page as inert text. Injecting the fetched text via
  // `srcdoc` isn't a navigation, so that sanitization never kicks in.
  useEffect(() => {
    if (!video || !answerId || video.html_paths.length === 0) return;
    let cancelled = false;
    setFrameHtml([]);
    Promise.all(
      video.html_paths.map((path) => fetch(resolveHyperframeAssetUrl(answerId, path)).then((r) => r.text())),
    ).then((htmls) => {
      if (!cancelled) setFrameHtml(htmls);
    });
    return () => {
      cancelled = true;
    };
  }, [video, answerId]);

  // Fit the fixed 1920x1080 iframes inside whatever box the flex layout
  // gives us — scaling by the smaller of width/height (like object-fit:
  // contain) instead of width alone, and capped so it doesn't blow up on
  // very large desktop screens. This is also what keeps .hf-stage from ever
  // needing to scroll: the wrapper's own box never exceeds its container.
  useEffect(() => {
    const box = wrapperRef.current;
    if (!box) return;
    const MAX_SCALE = 1280 / 1920;
    const apply = () => {
      const w = box.clientWidth || 0;
      const h = box.clientHeight || 0;
      if (w <= 0 || h <= 0) return;
      const scale = Math.min(w / 1920, h / 1080, MAX_SCALE);
      box.style.setProperty("--hf-scale", String(scale));
      setVideoSize({ w: 1920 * scale, h: 1080 * scale });
    };
    apply();
    const obs = new ResizeObserver(apply);
    obs.observe(box);
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
    // Fullscreen the whole player (header + stage + controls), not just the
    // stage — the Fullscreen API only displays the requested element's own
    // subtree, so targeting the stage alone would hide the header and
    // controls entirely instead of just needing a hover to reveal them.
    const el = playerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.()
        .then(() => {
          setIsFullscreen(true);
          // Same as V4/V5: rotate to landscape on entry, like YouTube,
          // instead of just letterboxing a wide presentation in portrait.
          if (isMobile && screen.orientation && "lock" in screen.orientation) {
            (screen.orientation as ScreenOrientation & { lock: (o: string) => Promise<void> })
              .lock("landscape")
              .catch(() => {});
          }
        })
        .catch(() => toast.error("Fullscreen isn't available in this browser"));
    } else {
      document.exitFullscreen?.()
        .then(() => {
          setIsFullscreen(false);
          if (isMobile && screen.orientation && "unlock" in screen.orientation) {
            try {
              screen.orientation.unlock();
            } catch {
              /* noop */
            }
          }
        })
        .catch(() => {});
    }
  };

  // Auto-hide header/controls after a few seconds of no mouse movement while
  // fullscreen, so the student can see (and touch/click through to) every
  // part of the presentation, not just the area controls don't cover.
  useEffect(() => {
    if (!isFullscreen) {
      setControlsVisible(true);
      if (hideControlsTimerRef.current) {
        window.clearTimeout(hideControlsTimerRef.current);
        hideControlsTimerRef.current = null;
      }
      return;
    }
    const root = playerRef.current;
    if (!root) return;
    const reveal = () => {
      setControlsVisible(true);
      if (hideControlsTimerRef.current) window.clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2500);
    };
    reveal();
    root.addEventListener("mousemove", reveal);
    root.addEventListener("touchstart", reveal);
    root.addEventListener("keydown", reveal);
    return () => {
      root.removeEventListener("mousemove", reveal);
      root.removeEventListener("touchstart", reveal);
      root.removeEventListener("keydown", reveal);
      if (hideControlsTimerRef.current) window.clearTimeout(hideControlsTimerRef.current);
    };
  }, [isFullscreen]);

  const hasVideo = !!video && video.html_paths.length > 0;
  const currentSegment = segments[currentIdx];

  const chromeHidden = isFullscreen && !controlsVisible;

  return createPortal(
    <div className={`hf-player${chromeHidden ? " hf-player--idle" : ""}`} ref={playerRef}>
      <div className="hf-header">
        <button type="button" className="hf-header__close" onClick={onClose} aria-label="Close">
          <ArrowLeft size={18} />
        </button>
        <div className="hf-header__title">{questionText || "Your question"}</div>
        {hasVideo && <span className="hf-header__badge">HyperFrame</span>}
      </div>

      <div className={`hf-stage${hasVideo ? " hf-stage--video" : ""}`} ref={stageRef}>
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
          <div className="hf-video-frame-box" ref={wrapperRef}>
            <div
              className="hf-video-wrapper"
              style={videoSize.w ? { width: videoSize.w, height: videoSize.h } : undefined}
            >
              <span className="hf-beat-counter">
                {currentIdx + 1} / {beatCount}
              </span>
              {video.html_paths.map((path, i) =>
                frameHtml[i] ? (
                  <iframe
                    key={i}
                    ref={(el) => (frameEls.current[i] = el)}
                    className="hf-frame"
                    title={`Answer beat ${i + 1}`}
                    sandbox="allow-scripts allow-same-origin"
                    scrolling="no"
                    loading="eager"
                    srcDoc={frameHtml[i]}
                    style={{ opacity: i === currentIdx ? 1 : 0 }}
                    onLoad={() => {
                      frameReady.current[i] = true;
                      if (i === currentIdxRef.current) playFrame(i);
                      else stopFrame(i);
                    }}
                  />
                ) : null,
              )}
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
            {showCaption && (currentSegment?.title || currentSegment?.html || currentSegment?.plain) && (
              <div className="hf-text-panel">
                {currentSegment?.title && <div className="hf-text-panel__title">{currentSegment.title}</div>}
                <div
                  className="hf-text-panel__caption"
                  dangerouslySetInnerHTML={{ __html: currentSegment?.html || currentSegment?.plain || "" }}
                />
              </div>
            )}
          </div>
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
            <button
              type="button"
              className={`hf-btn hf-caption-btn${showCaption ? " is-active" : ""}`}
              onClick={() => setShowCaption((v) => !v)}
              aria-label={showCaption ? "Hide narration text" : "Show narration text"}
              title={showCaption ? "Hide narration text" : "Show narration text"}
            >
              {showCaption ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
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
