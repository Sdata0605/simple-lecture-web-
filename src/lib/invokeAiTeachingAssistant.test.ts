import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));

import { SUPABASE_DIRECT_URL, SUPABASE_PUBLISHABLE_KEY } from "@/lib/supabaseUrl";
import { LOGIN_PROBLEM_MESSAGE, invokeAiTeachingAssistantDirect } from "./invokeAiTeachingAssistant";

const URL = `${SUPABASE_DIRECT_URL}/functions/v1/ai-teaching-assistant`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const bearerOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>).Authorization;

describe("invokeAiTeachingAssistantDirect", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    auth.getSession.mockReset();
    auth.refreshSession.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the public anon key as the bearer token when nobody is signed in", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    fetchMock.mockResolvedValue(json(200, { cached: true }));

    const result = await invokeAiTeachingAssistantDirect({ question: "What is a salt?" });

    expect(result).toEqual({ data: { cached: true }, error: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(URL);
    expect(bearerOf(fetchMock.mock.calls[0])).toBe(`Bearer ${SUPABASE_PUBLISHABLE_KEY}`);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ question: "What is a salt?" });
  });

  it("sends the signed-in user's access token when there is a session", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "user-token" } } });
    fetchMock.mockResolvedValue(json(200, { ok: 1 }));

    await invokeAiTeachingAssistantDirect({ question: "q" });

    expect(bearerOf(fetchMock.mock.calls[0])).toBe("Bearer user-token");
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes the session once and retries when the gateway rejects an expired token", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "old-token" } } });
    auth.refreshSession.mockResolvedValue({ data: { session: { access_token: "new-token" } }, error: null });
    fetchMock
      .mockResolvedValueOnce(json(401, { code: "UNAUTHORIZED_INVALID_JWT_FORMAT", message: "Invalid JWT" }))
      .mockResolvedValueOnce(json(200, { answer: "ok" }));

    const result = await invokeAiTeachingAssistantDirect({ question: "q" });

    expect(result).toEqual({ data: { answer: "ok" }, error: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bearerOf(fetchMock.mock.calls[0])).toBe("Bearer old-token");
    expect(bearerOf(fetchMock.mock.calls[1])).toBe("Bearer new-token");
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("explains a login problem in plain words when the retry is still rejected", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "old-token" } } });
    auth.refreshSession.mockResolvedValue({ data: { session: { access_token: "new-token" } }, error: null });
    fetchMock.mockResolvedValue(json(401, { code: "UNAUTHORIZED_INVALID_JWT_FORMAT", message: "Invalid JWT" }));

    const result = await invokeAiTeachingAssistantDirect({ question: "q" });

    expect(result.data).toEqual({ code: "UNAUTHORIZED_INVALID_JWT_FORMAT", message: "Invalid JWT" });
    expect(result.error).toEqual({ message: LOGIN_PROBLEM_MESSAGE, status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the session cannot be refreshed", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "old-token" } } });
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error("refresh token revoked") });
    fetchMock.mockResolvedValue(json(401, { message: "Invalid JWT" }));

    const result = await invokeAiTeachingAssistantDirect({ question: "q" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error).toEqual({ message: LOGIN_PROBLEM_MESSAGE, status: 401 });
  });

  it("does not try to refresh for a visitor with no session", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    fetchMock.mockResolvedValue(json(401, { message: "Invalid JWT" }));

    const result = await invokeAiTeachingAssistantDirect({ question: "q" });

    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error?.status).toBe(401);
  });

  it("passes the function's own error message through for other failures", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    fetchMock.mockResolvedValue(json(502, { error: "Upstream timed out after 420s", attempts: 3 }));

    const result = await invokeAiTeachingAssistantDirect({ question: "q" });

    expect(result.error).toEqual({ message: "Upstream timed out after 420s", status: 502 });
  });

  it("falls back to the HTTP status when the body has no message", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));

    const result = await invokeAiTeachingAssistantDirect({ question: "q" });

    expect(result.error).toEqual({ message: "HTTP 500", status: 500 });
  });

  it("reports a network failure without throwing", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await invokeAiTeachingAssistantDirect({ question: "q" });

    expect(result).toEqual({ data: null, error: { message: "Failed to fetch" } });
  });
});
