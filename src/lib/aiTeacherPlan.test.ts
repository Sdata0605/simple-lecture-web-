import { describe, expect, it } from "vitest";
import { resolvePlanState } from "./aiTeacherPlan";

const cacheActive = { active: true, checkedAt: 1 };
const cacheInactive = { active: false, checkedAt: 1 };

describe("resolvePlanState", () => {
  it("server says active -> active", () => {
    expect(resolvePlanState({ serverActive: true })).toBe("active");
    expect(resolvePlanState({ serverActive: true, cached: cacheInactive })).toBe("active");
  });

  it("server says inactive (a real answer) -> inactive", () => {
    expect(resolvePlanState({ serverActive: false })).toBe("inactive");
    expect(resolvePlanState({ serverActive: false, cached: cacheActive })).toBe("inactive");
  });

  it("error with an active cache -> active", () => {
    expect(resolvePlanState({ error: true, cached: cacheActive })).toBe("active");
  });

  it("error with an inactive cache -> inactive", () => {
    expect(resolvePlanState({ error: true, cached: cacheInactive })).toBe("inactive");
  });

  it("error with no cache -> unknown", () => {
    expect(resolvePlanState({ error: true })).toBe("unknown");
    expect(resolvePlanState({ error: true, cached: null })).toBe("unknown");
  });

  it("missing plan field (null or undefined) falls back to the cache, or unknown without one", () => {
    expect(resolvePlanState({ serverActive: null, cached: cacheActive })).toBe("active");
    expect(resolvePlanState({ serverActive: undefined, cached: cacheInactive })).toBe("inactive");
    expect(resolvePlanState({ serverActive: undefined })).toBe("unknown");
  });

  it("loading before any answer -> loading, never the purchase offer", () => {
    expect(resolvePlanState({ loading: true })).toBe("loading");
    expect(resolvePlanState({ loading: true, cached: cacheInactive })).toBe("loading");
  });

  it("a server answer ends loading", () => {
    expect(resolvePlanState({ loading: true, serverActive: false })).toBe("inactive");
  });
});
