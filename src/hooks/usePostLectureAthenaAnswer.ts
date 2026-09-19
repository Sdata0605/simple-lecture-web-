// Orchestrates one post-lecture question: stream /ask for the live text
// answer, then poll /answers/{id}/video for the HyperFrame (animated,
// narrated) presentation once generation finishes. Mirrors the reference
// HyperframeVideoPlayer's flow (show text immediately, poll every 3s, give
// up after 5 minutes and stay on text) — see athenaAsk.ts for where that was
// verified from.
import { useCallback, useRef, useState } from "react";
import {
  AthenaAskMeta,
  AthenaSegment,
  AthenaSource,
  HyperframeVideoStatus,
  askAthenaQuestion,
  pollHyperframeVideo,
} from "@/lib/api/athenaAsk";

const VIDEO_POLL_MS = 3000;
const VIDEO_TIMEOUT_MS = 5 * 60 * 1000;

export type PostLectureAnswerPhase =
  | "idle"
  | "asking"
  | "streaming"
  | "awaiting_video"
  | "video_ready"
  | "text_only"
  | "out_of_scope"
  | "error";

export interface PostLectureAnswerState {
  phase: PostLectureAnswerPhase;
  segments: AthenaSegment[];
  meta: AthenaAskMeta | null;
  sources: AthenaSource[];
  video: HyperframeVideoStatus | null;
  errorMessage: string | null;
}

const INITIAL_STATE: PostLectureAnswerState = {
  phase: "idle",
  segments: [],
  meta: null,
  sources: [],
  video: null,
  errorMessage: null,
};

export function usePostLectureAthenaAnswer() {
  const [state, setState] = useState<PostLectureAnswerState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    stopPolling();
    setState(INITIAL_STATE);
  }, [stopPolling]);

  const pollVideo = useCallback((answerId: string) => {
    stopPolling();
    pollDeadlineRef.current = Date.now() + VIDEO_TIMEOUT_MS;

    const tick = async () => {
      try {
        const video = await pollHyperframeVideo(answerId);
        if (video.ready === true && video.html_paths.length > 0) {
          setState((prev) => ({ ...prev, phase: "video_ready", video }));
          return;
        }
        if (video.ready === false) {
          setState((prev) => ({ ...prev, phase: "text_only" }));
          return;
        }
      } catch {
        // Transient poll failure — keep trying until the timeout.
      }
      if (Date.now() >= pollDeadlineRef.current) {
        setState((prev) => (prev.phase === "video_ready" ? prev : { ...prev, phase: "text_only" }));
        return;
      }
      pollTimerRef.current = window.setTimeout(tick, VIDEO_POLL_MS);
    };
    pollTimerRef.current = window.setTimeout(tick, VIDEO_POLL_MS);
  }, [stopPolling]);

  const ask = useCallback(
    async (params: { question: string; subjectId: string; chapterId?: string; topicId?: string }) => {
      abortRef.current?.abort();
      stopPolling();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ ...INITIAL_STATE, phase: "asking" });

      try {
        await askAthenaQuestion({ ...params, signal: controller.signal }, (event) => {
          if (controller.signal.aborted) return;
          switch (event.type) {
            case "thinking":
              setState((prev) => (prev.phase === "asking" ? { ...prev, phase: "streaming" } : prev));
              break;
            case "meta":
              setState((prev) => ({ ...prev, phase: "streaming", meta: event.meta }));
              break;
            case "segment":
              setState((prev) => ({ ...prev, segments: [...prev.segments, event.segment] }));
              break;
            case "done":
              setState((prev) => {
                const hfEnabled = prev.meta?.hf_enabled ?? false;
                if (hfEnabled && event.answerId) {
                  pollVideo(event.answerId);
                  return { ...prev, phase: "awaiting_video", sources: event.sources };
                }
                return { ...prev, phase: "text_only", sources: event.sources };
              });
              break;
            case "out_of_scope":
              setState((prev) => ({ ...prev, phase: "out_of_scope", errorMessage: event.message ?? null }));
              break;
            case "error":
              setState((prev) => ({ ...prev, phase: "error", errorMessage: event.message }));
              break;
          }
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setState((prev) => ({ ...prev, phase: "error", errorMessage: (err as Error).message }));
        }
      }
    },
    [pollVideo, stopPolling],
  );

  return { state, ask, reset };
}
