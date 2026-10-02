import type { PostLectureAnswerPhase } from "@/hooks/usePostLectureAthenaAnswer";
import type { AssistantClipCategory } from "./assistantAudioTypes";

/** A voice clip category to say, or "interrupt" = go silent immediately. */
export type StatusCue = AssistantClipCategory | "interrupt";

export interface AnswerProgress {
  phase: PostLectureAnswerPhase;
  segmentCount: number;
}

/**
 * Which assistant voice cues a change in the live /ask answer state should
 * trigger, in the order to play them. Pure — called on every state update.
 */
export function cuesForAnswerProgress(prev: AnswerProgress, next: AnswerProgress): StatusCue[] {
  const entered = (phase: PostLectureAnswerPhase) => next.phase === phase && prev.phase !== phase;

  // The narrated HyperFrame video is starting — nothing may talk over it.
  if (entered("video_ready")) return ["interrupt"];
  if (entered("out_of_scope")) return ["outOfScope"];
  if (entered("error")) return ["error"];

  // Never announce "found" once the narrated video is playing or the request
  // has already ended in an out-of-scope/error notice.
  const silentPhase = next.phase === "video_ready" || next.phase === "out_of_scope" || next.phase === "error";

  const cues: StatusCue[] = [];
  if (entered("asking")) cues.push("thinking");
  if (prev.segmentCount === 0 && next.segmentCount > 0 && !silentPhase) cues.push("found");
  if (entered("awaiting_video")) cues.push("preparingVisual");
  return cues;
}
