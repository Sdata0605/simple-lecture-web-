/**
 * Voice Lock Utility
 * Ensures only one feature can use the microphone at a time.
 * Prevents conflicts between AITeachingAssistant and SalesAssistant.
 */

type VoiceOwner = 'teaching' | 'sales' | 'doubts' | 'askAssistant' | null;

let currentOwner: VoiceOwner = null;
let onReleaseCallbacks: Map<VoiceOwner, () => void> = new Map();

export const voiceLock = {
  /**
   * Get current owner of the voice lock
   */
  getOwner(): VoiceOwner {
    return currentOwner;
  },

  /**
   * Register a callback to be called when this owner loses the lock
   */
  onRelease(owner: VoiceOwner, callback: () => void): void {
    if (owner) {
      onReleaseCallbacks.set(owner, callback);
    }
  },

  /**
   * Acquire the voice lock for a feature.
   * If another feature has the lock, their release callback is called first.
   */
  acquire(owner: VoiceOwner): boolean {
    if (!owner) return false;
    
    // If same owner, already has lock
    if (currentOwner === owner) {
      console.log(`[VoiceLock] ${owner} already owns the lock`);
      return true;
    }

    // If another owner has it, release them first
    if (currentOwner && currentOwner !== owner) {
      console.log(`[VoiceLock] Releasing ${currentOwner} to give lock to ${owner}`);
      const releaseCallback = onReleaseCallbacks.get(currentOwner);
      if (releaseCallback) {
        try {
          releaseCallback();
        } catch (e) {
          console.error('[VoiceLock] Error in release callback:', e);
        }
      }
    }

    currentOwner = owner;
    console.log(`[VoiceLock] ${owner} acquired the lock`);
    return true;
  },

  /**
   * Release the voice lock
   */
  release(owner: VoiceOwner): void {
    if (currentOwner === owner) {
      console.log(`[VoiceLock] ${owner} released the lock`);
      currentOwner = null;
    }
  },

  /**
   * Force release any lock (for cleanup)
   */
  forceRelease(): void {
    if (currentOwner) {
      const releaseCallback = onReleaseCallbacks.get(currentOwner);
      if (releaseCallback) {
        try {
          releaseCallback();
        } catch (e) {
          console.error('[VoiceLock] Error in force release callback:', e);
        }
      }
      console.log(`[VoiceLock] Force released lock from ${currentOwner}`);
      currentOwner = null;
    }
  }
};

/**
 * Stops every other voice on the page: any video or audio that is playing (a lecture, a podcast) and any
 * browser text-to-speech. Used when the live AI teacher starts, so the student never hears two teachers at once.
 */
export function silenceOtherAudio(): void {
  if (typeof document !== 'undefined') {
    document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((media) => {
      try {
        // Only what can be heard: a muted background video keeps playing.
        if (!media.paused && !media.muted && media.volume > 0) media.pause();
      } catch {
        // a media element that cannot be paused is not worth failing over
      }
    });
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // no speech synthesis here
  }
}
