import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Languages, LoaderCircle, Play } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import type { V5Language, V5Presentation, V5SubtitleData } from './types';
import {
  buildSectionTimeline,
  getMergedVideoCandidates,
  getPresentationUrl,
  getSubtitlesUrl,
  getTimelinePosition,
  hasMergedVideo,
} from './utils';
import { V5Controls } from './V5Controls';
import { V5KeyPoints } from './V5KeyPoints';
import './v5-player.css';

interface V5PlayerProps {
  jobId: string;
  initialLanguage?: V5Language;
  onExit: () => void;
  onLanguageChange?: (language: V5Language) => void;
  /** Fires once when the lecture video actually finishes playing (distinct
   * from onExit, which fires when the user closes the player early). Purely
   * an event hook for the parent — does not change anything about how V5
   * itself plays, renders, or controls video. */
  onVideoEnded?: () => void;
  /** When set, shows an "Ask AI" button; clicking it pauses the lecture and
   * calls this so the parent can open its assistant. */
  onAskAI?: () => void;
  /** Whether that assistant is open. When it closes, the lecture resumes if
   * it was playing when "Ask AI" was pressed. */
  askAIOpen?: boolean;
}

export function V5Player({
  jobId,
  initialLanguage = 'english',
  onExit,
  onLanguageChange,
  onVideoEnded,
  onAskAI,
  askAIOpen,
}: V5PlayerProps) {
  const stageRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fullscreenControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPositionRef = useRef<{ ratio: number; resume: boolean } | null>(null);
  const resumeAfterAskRef = useRef(false);
  const [presentation, setPresentation] = useState<V5Presentation | null>(null);
  const [subtitleData, setSubtitleData] = useState<V5SubtitleData | null>(null);
  const [language, setLanguage] = useState<V5Language>(initialLanguage);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [needsTap, setNeedsTap] = useState(false);
  const [keyPointsHidden, setKeyPointsHidden] = useState(false);
  const [fullscreenControlsVisible, setFullscreenControlsVisible] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError('');
    setPresentation(null);
    setSubtitleData(null);

    Promise.all([
      fetch(getPresentationUrl(jobId)).then(async (response) => {
        if (!response.ok) throw new Error(`Presentation request failed (${response.status})`);
        return response.json() as Promise<V5Presentation>;
      }),
      fetch(getSubtitlesUrl(jobId))
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ])
      .then(([nextPresentation, nextSubtitles]) => {
        if (cancelled) return;
        if (!Array.isArray(nextPresentation.sections) || nextPresentation.sections.length === 0) {
          throw new Error('This job has no presentation sections.');
        }
        setPresentation(nextPresentation);
        setSubtitleData(nextSubtitles);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load V5 presentation.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const timeline = useMemo(
    () => buildSectionTimeline(presentation?.sections || [], subtitleData),
    [presentation, subtitleData],
  );
  const sources = useMemo(
    () => (presentation ? getMergedVideoCandidates(presentation, jobId, language) : []),
    [presentation, jobId, language],
  );
  const source = sources[sourceIndex] || '';
  const position = useMemo(
    () => getTimelinePosition(timeline, currentTime, duration),
    [timeline, currentTime, duration],
  );

  useEffect(() => {
    setSourceIndex(0);
  }, [language]);

  useEffect(() => {
    const onFullscreen = () => {
      const nowFullscreen = document.fullscreenElement === stageRef.current;
      setIsFullscreen(nowFullscreen);
      if (fullscreenControlsTimerRef.current) {
        clearTimeout(fullscreenControlsTimerRef.current);
        fullscreenControlsTimerRef.current = null;
      }
      if (nowFullscreen) {
        // Show controls right away on entry (not hidden from frame one) —
        // same as tapping the screen — then auto-hide after a beat.
        setFullscreenControlsVisible(true);
        fullscreenControlsTimerRef.current = setTimeout(() => {
          setFullscreenControlsVisible(false);
          fullscreenControlsTimerRef.current = null;
        }, 1800);
      } else {
        setFullscreenControlsVisible(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (fullscreenControlsTimerRef.current) {
        clearTimeout(fullscreenControlsTimerRef.current);
      }
    };
  }, []);

  const revealFullscreenControls = useCallback(() => {
    if (!isFullscreen) return;
    setFullscreenControlsVisible(true);
    if (fullscreenControlsTimerRef.current) {
      clearTimeout(fullscreenControlsTimerRef.current);
    }
    fullscreenControlsTimerRef.current = setTimeout(() => {
      setFullscreenControlsVisible(false);
      fullscreenControlsTimerRef.current = null;
    }, 1800);
  }, [isFullscreen]);

  // Mirrors V4Player's mobile fullscreen: lock/unlock landscape orientation
  // so tapping fullscreen on a phone rotates and fills the screen
  // horizontally, like YouTube, instead of just letterboxing in portrait.
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        if (isMobile && screen.orientation && 'unlock' in screen.orientation) {
          try {
            screen.orientation.unlock();
          } catch {
            /* noop */
          }
        }
      } else {
        await stageRef.current?.requestFullscreen();
        if (isMobile && screen.orientation && 'lock' in screen.orientation) {
          try {
            await (screen.orientation as ScreenOrientation & { lock: (o: string) => Promise<void> }).lock(
              'landscape',
            );
          } catch {
            /* noop — some browsers (notably iOS Safari) don't support locking */
          }
        }
      }
    } catch {
      /* noop */
    }
  }, [isMobile]);

  const handleAskAI = useCallback(() => {
    const video = videoRef.current;
    resumeAfterAskRef.current = Boolean(video && !video.paused && !video.ended);
    video?.pause();
    onAskAI?.();
  }, [onAskAI]);

  // Read by handleMetadata, which is created once per playbackRate.
  const askAIOpenRef = useRef(Boolean(askAIOpen));
  useEffect(() => {
    askAIOpenRef.current = Boolean(askAIOpen);
    if (askAIOpen || !resumeAfterAskRef.current) return;
    resumeAfterAskRef.current = false;
    videoRef.current?.play().catch(() => setNeedsTap(true));
  }, [askAIOpen]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => {
        setIsPlaying(true);
        setNeedsTap(false);
      }).catch(() => setNeedsTap(true));
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  const selectLanguage = useCallback((nextLanguage: V5Language) => {
    if (nextLanguage === language) return;
    const video = videoRef.current;
    pendingPositionRef.current = {
      ratio: video?.duration ? video.currentTime / video.duration : 0,
      resume: Boolean(video && !video.paused),
    };
    setIsPlaying(false);
    setLanguage(nextLanguage);
    onLanguageChange?.(nextLanguage);
  }, [language, onLanguageChange]);

  const handleMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration || 0);
    video.playbackRate = playbackRate;

    // A source fallback can remount the video while the assistant is open —
    // it must not start the lecture under the overlay (the mic would hear it).
    // It resumes on close via resumeAfterAskRef if it was playing before.
    const holdForAssistant = askAIOpenRef.current;

    const pending = pendingPositionRef.current;
    if (pending && video.duration) {
      video.currentTime = Math.min(video.duration - 0.05, pending.ratio * video.duration);
      pendingPositionRef.current = null;
      if (pending.resume && !holdForAssistant) {
        video.play().then(() => setIsPlaying(true)).catch(() => setNeedsTap(true));
      }
      return;
    }

    if (video.paused && !holdForAssistant) {
      video.play()
        .then(() => {
          setIsPlaying(true);
          setNeedsTap(false);
        })
        .catch(() => setNeedsTap(true));
    }
  }, [playbackRate]);

  if (isLoading) {
    return (
      <div className="v5-state">
        <LoaderCircle className="v5-state__spinner" size={44} />
        <strong>Preparing the merged presentation</strong>
        <span>Loading timeline and key points...</span>
      </div>
    );
  }

  if (error || !presentation) {
    return (
      <div className="v5-state">
        <span className="v5-state__code">V5 / LOAD ERROR</span>
        <strong>{error || 'Presentation unavailable'}</strong>
        <button onClick={onExit} type="button">Choose another job</button>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="v5-state">
        <span className="v5-state__code">V5 / NO MERGED VIDEO</span>
        <strong>No {language} final presentation was found.</strong>
        <button onClick={onExit} type="button">Choose another job</button>
      </div>
    );
  }

  const title = presentation.presentation_title || presentation.title || 'V5 Presentation';
  const canUseKannada = hasMergedVideo(presentation, 'kannada');

  // Shared by both <V5Controls> renders below — the normal bottom bar, and
  // its copy floated inside .v5-stage for fullscreen (see toggleFullscreen's
  // comment: Fullscreen API only shows the fullscreen element's own
  // subtree, so the bar outside .v5-stage would otherwise be invisible).
  const controlsProps = {
    currentTime,
    duration,
    isFullscreen,
    isMuted,
    isPlaying,
    onRateChange: (rate: number) => {
      setPlaybackRate(rate);
      if (videoRef.current) videoRef.current.playbackRate = rate;
    },
    onReplay: () => {
      if (!videoRef.current) return;
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => setNeedsTap(true));
    },
    onSeek: (time: number) => {
      if (!videoRef.current) return;
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    },
    onToggleFullscreen: toggleFullscreen,
    onToggleMute: () => {
      if (!videoRef.current) return;
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    },
    onTogglePlay: togglePlay,
    onAskAI: onAskAI ? handleAskAI : undefined,
    playbackRate,
  };

  return (
    <div className="v5-player">
      <header className="v5-header">
        <button className="v5-header__back" onClick={onExit} title="Choose another job" type="button">
          <ArrowLeft size={19} />
        </button>
        <div className="v5-header__identity">
          <span className="v5-header__version">V5 / MERGED LEARNING</span>
          <h1>{title}</h1>
        </div>
        <div className="v5-header__status">
          <span>{position.active?.section.title || 'Starting lesson'}</span>
          <span className="v5-header__renderer">
            {position.active?.section.renderer || 'merged'}
          </span>
        </div>
        <label className="v5-language">
          <Languages size={16} />
          <select
            aria-label="Presentation language"
            onChange={(event) => selectLanguage(event.target.value as V5Language)}
            value={language}
          >
            <option value="english">English</option>
            {canUseKannada && <option value="kannada">Kannada</option>}
          </select>
        </label>
      </header>

      <main
        className="v5-stage"
        onPointerDown={revealFullscreenControls}
        // Touch doesn't really "leave" the way a mouse does — this only
        // hides-on-leave for mouse/pen so the tap-to-reveal timer isn't
        // fought immediately after every tap on mobile.
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') setFullscreenControlsVisible(false);
        }}
        onPointerMove={revealFullscreenControls}
        ref={stageRef}
      >
        <video
          autoPlay={!askAIOpen}
          className="v5-video"
          key={`${language}-${sourceIndex}`}
          onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
          onEnded={() => {
            setIsPlaying(false);
            onVideoEnded?.();
          }}
          onError={() => {
            if (sourceIndex < sources.length - 1) {
              setSourceIndex((index) => index + 1);
              return;
            }
            setError(`The ${language} merged video could not be played.`);
          }}
          onLoadedMetadata={handleMetadata}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          playsInline
          ref={videoRef}
          src={source}
        />

        <div className="v5-stage__shade" />
        <V5KeyPoints
          active={position.active}
          isHidden={keyPointsHidden}
          onToggle={() => setKeyPointsHidden((hidden) => !hidden)}
          visibleCount={position.visibleCount}
        />

        {needsTap && (
          <button className="v5-tap" onClick={togglePlay} type="button">
            <span><Play size={30} fill="currentColor" /></span>
            Tap to start presentation
          </button>
        )}

        <div className="v5-section-progress" aria-hidden="true">
          {timeline.map((entry) => (
            <span
              className={entry.sectionIndex === position.active?.sectionIndex ? 'is-active' : ''}
              key={entry.section.section_id}
              style={{ flexGrow: entry.duration }}
            />
          ))}
        </div>

        {isFullscreen && (
          <div className={`v5-fullscreen-controls ${fullscreenControlsVisible ? 'is-visible' : ''}`}>
            <V5Controls {...controlsProps} />
          </div>
        )}
      </main>

      <V5Controls {...controlsProps} />
    </div>
  );
}
