import type { AssistantClip, AssistantClipCategory } from "./assistantAudioTypes";

export interface ClipPicker {
  pick(category: AssistantClipCategory): AssistantClip | null;
}

/**
 * Shuffle-bag picker: every clip in a category plays once before any repeats,
 * and the same clip never plays twice in a row (including across refills), so
 * the assistant sounds different each time the student opens it.
 */
export function createClipPicker(
  clips: readonly AssistantClip[],
  random: () => number = Math.random,
): ClipPicker {
  const byCategory = new Map<AssistantClipCategory, AssistantClip[]>();
  for (const clip of clips) {
    const list = byCategory.get(clip.category) ?? [];
    list.push(clip);
    byCategory.set(clip.category, list);
  }

  const bags = new Map<AssistantClipCategory, AssistantClip[]>();
  const lastPicked = new Map<AssistantClipCategory, AssistantClip>();

  // Index in [0, n) even if an injected random() misbehaves and returns 1.
  const randomIndex = (n: number) => Math.min(n - 1, Math.max(0, Math.floor(random() * n)));

  const refill = (category: AssistantClipCategory, pool: AssistantClip[]) => {
    const bag = [...pool];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // Clips are taken from the end — make sure the first one out of the new
    // bag isn't the one that just played at the end of the previous bag.
    const last = lastPicked.get(category);
    const top = bag.length - 1;
    if (last && bag.length > 1 && bag[top].id === last.id) {
      const j = randomIndex(top);
      [bag[top], bag[j]] = [bag[j], bag[top]];
    }
    bags.set(category, bag);
    return bag;
  };

  return {
    pick(category) {
      const pool = byCategory.get(category);
      if (!pool || pool.length === 0) return null;
      let bag = bags.get(category);
      if (!bag || bag.length === 0) bag = refill(category, pool);
      const clip = bag.pop()!;
      lastPicked.set(category, clip);
      return clip;
    },
  };
}
