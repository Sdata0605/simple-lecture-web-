// Turn-taking for a live voice call on speakers. While the teacher talks, its own voice reaches the
// microphone; Gemini hears that as the student speaking and cuts the teacher off. So the mic is not
// streamed while the teacher is audible (plus a short tail for the room and the speaker's latency), and
// the student can still break in by tapping, which also drops what is left of the cut-off turn.
//
// The mic also stays closed for the whole of a teacher turn, not only while sound is coming out: the teacher
// produces speech several times faster than it plays and often pauses mid-turn (between two chunks, or while a
// card waits for the voice), and a cough or a fan in such a gap made the server cut the teacher off and throw
// away seconds of speech it had queued, which is heard as swallowed words and restarted lines.
// Pure and clock-injected so the rules can be tested without audio hardware.

/** Quiet time after the teacher's last sound before the mic reopens (room reverb + speaker latency). */
export const ECHO_TAIL_MS = 400;
/** After a tap the teacher's sound stops at once, so only a moment is needed. */
export const INTERRUPT_TAIL_MS = 150;
/** Audio from a cut-off turn arrives in one burst; a pause this long means a new turn has started. */
export const FENCE_QUIET_MS = 1500;
/** A turn is assumed finished this long after its last chunk, in case the end-of-turn signal never arrives. */
export const TURN_GRACE_MS = 3000;
/** The longest a card may keep the mic closed while the teacher waits for it to be shown. */
export const TOOL_HOLD_MAX_MS = 35_000;
/** After a card is shown, how long the teacher gets to start speaking again before the mic reopens. */
export const TOOL_RESUME_MS = 3000;

export interface EchoGate {
  /** A chunk of teacher audio arrived. False = it belongs to a turn the student cut off, so drop it. */
  acceptChunk(now: number): boolean;
  /** Teacher audio started playing. */
  playbackStarted(): void;
  /** The last queued teacher audio finished playing naturally. */
  playbackEnded(now: number, tailMs?: number): void;
  /** Playback was cut for some other reason (the server saw the student speak, typing, closing). */
  playbackStopped(now: number): void;
  /** The student tapped to interrupt (or typed something that cuts the teacher off). */
  interrupt(now: number): void;
  /** The server finished (or abandoned) the teacher's turn. */
  turnEnded(): void;
  /** The teacher asked for a card and is waiting for it to be shown. */
  toolStarted(now: number): void;
  /** The card was shown and the teacher has its answer. */
  toolFinished(now: number): void;
  /** True while the teacher is mid-turn: the server is still sending, or a card is on its way. */
  busy(now: number): boolean;
  /** True while the mic must not be streamed. */
  micClosed(now: number): boolean;
}

export function createEchoGate(): EchoGate {
  let playing = false;
  let reopenAt = 0;
  let turnOpen = false; // the server may still be sending audio for the current turn
  let lastChunkAt = 0;
  let fence = false;
  let fenceAt = 0;
  let toolsWaiting = 0;
  let toolSince = 0;
  let resumeBy = 0;

  const busy = (now: number) =>
    (turnOpen && now - lastChunkAt < TURN_GRACE_MS) ||
    (toolsWaiting > 0 && now - toolSince < TOOL_HOLD_MAX_MS) ||
    now < resumeBy;

  return {
    acceptChunk(now) {
      if (fence) {
        if (now - fenceAt <= FENCE_QUIET_MS) {
          fenceAt = now;
          return false;
        }
        fence = false; // quiet for a while: this chunk starts a new turn
      }
      turnOpen = true;
      lastChunkAt = now;
      resumeBy = 0; // the teacher is speaking again
      return true;
    },
    playbackStarted() {
      playing = true;
    },
    playbackEnded(now, tailMs = ECHO_TAIL_MS) {
      playing = false;
      reopenAt = now + tailMs;
    },
    playbackStopped(now) {
      playing = false;
      reopenAt = now + INTERRUPT_TAIL_MS;
    },
    interrupt(now) {
      playing = false;
      reopenAt = now + INTERRUPT_TAIL_MS;
      // Only fence if the server could still be sending the rest of that turn.
      fence = turnOpen;
      fenceAt = now;
      // The student has the floor: nothing the teacher was waiting on keeps the mic shut.
      turnOpen = false;
      toolsWaiting = 0;
      resumeBy = 0;
    },
    turnEnded() {
      turnOpen = false;
      fence = false;
    },
    toolStarted(now) {
      if (toolsWaiting === 0) toolSince = now;
      toolsWaiting += 1;
    },
    toolFinished(now) {
      toolsWaiting = Math.max(0, toolsWaiting - 1);
      if (toolsWaiting === 0) resumeBy = now + TOOL_RESUME_MS;
    },
    busy,
    micClosed(now) {
      return playing || now < reopenAt || busy(now);
    },
  };
}
