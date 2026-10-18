import { supabase } from "@/integrations/supabase/client";
import { SUPABASE_DIRECT_URL, SUPABASE_PUBLISHABLE_KEY } from "@/lib/supabaseUrl";

/**
 * Direct call to the `ai-teaching-assistant` edge function — bypasses the Cloudflare Worker proxy (150 s idle
 * timeout) and goes straight to Supabase, which allows the full 400 s edge-function budget.
 *
 * The function has `verify_jwt = true`, so the gateway answers 401 ("Missing authorization header") before it runs
 * when the request carries no bearer token. That used to hit every visitor without a session — the free preview lets
 * them ask a few questions — and the page showed a bare "HTTP 401". A signed-in user whose access token had just
 * expired got the same. So:
 *   - no session  -> send the public anon key as the bearer token, as `supabase.functions.invoke` does;
 *   - 401 with a session -> refresh the session once and retry (the gateway rejects before doing any work, so the
 *     retry cannot run the question twice);
 *   - still 401 -> say so in words the student can act on.
 */
const FUNCTION_URL = `${SUPABASE_DIRECT_URL}/functions/v1/ai-teaching-assistant`;
const TIMEOUT_MS = 420_000;

export const LOGIN_PROBLEM_MESSAGE = "We couldn't verify your login. Please log in again and ask your question once more.";

export interface AiTeachingAssistantError {
  message: string;
  status?: number;
}

export interface AiTeachingAssistantResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  error: AiTeachingAssistantError | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invokeAiTeachingAssistantDirect(body: any): Promise<AiTeachingAssistantResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const send = (bearer: string) =>
    fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session ?? null;

    let res = await send(session?.access_token ?? SUPABASE_PUBLISHABLE_KEY);

    if (res.status === 401 && session) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      const freshToken = refreshed?.session?.access_token;
      if (!refreshError && freshToken && freshToken !== session.access_token) {
        res = await send(freshToken);
      }
    }

    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }

    if (!res.ok) {
      const message =
        res.status === 401 ? LOGIN_PROBLEM_MESSAGE : data?.error || data?.message || `HTTP ${res.status}`;
      return { data, error: { message, status: res.status } };
    }
    return { data, error: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? "Request timed out after 420 seconds" : err?.message || "Network error";
    return { data: null, error: { message } };
  } finally {
    clearTimeout(timeoutId);
  }
}
