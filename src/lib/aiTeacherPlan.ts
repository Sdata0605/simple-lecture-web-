// Plan state for the AI Teacher Plus plan. The server's answer (settings.plan.active from ai-teacher-keys 'get')
// is the source of truth. The web never shows the purchase offer while the state is 'loading' or 'unknown'.
// A last known server answer is cached per user so a failed check can fall back to it.

export type PlanState = "loading" | "active" | "inactive" | "unknown";

export interface PlanCache {
  active: boolean;
  checkedAt: number;
}

export interface ResolvePlanInput {
  /** settings.plan.active from the server. Undefined or null when there is no real answer. */
  serverActive?: boolean | null;
  /** True when the last check failed. */
  error?: boolean;
  /** The last server answer saved for this user, if any. */
  cached?: PlanCache | null;
  /** True while the first server answer is still pending. Ignored once the check has failed or answered. */
  loading?: boolean;
}

export function resolvePlanState(input: ResolvePlanInput): PlanState {
  const { serverActive, error, cached, loading } = input;
  // A real server answer always wins.
  if (serverActive === true) return "active";
  if (serverActive === false) return "inactive";
  // Nothing from the server yet: wait, never offer the purchase.
  if (loading && !error) return "loading";
  // The check failed or returned no plan field: fall back to the last known answer.
  if (cached) return cached.active ? "active" : "inactive";
  return "unknown";
}

const CACHE_PREFIX = "aiteacher.plan.v1:";

export function readPlanCache(userId: string): PlanCache | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.active === "boolean" && typeof parsed.checkedAt === "number") {
      return { active: parsed.active, checkedAt: parsed.checkedAt };
    }
    return null;
  } catch {
    return null;
  }
}

export function writePlanCache(userId: string, active: boolean): void {
  try {
    const value: PlanCache = { active, checkedAt: Date.now() };
    localStorage.setItem(CACHE_PREFIX + userId, JSON.stringify(value));
  } catch {
    // Storage is full or blocked: the cache is optional.
  }
}
