/**
 * Central Supabase URL constant. Every browser call (auth, data, functions) goes straight to Supabase.
 * The Cloudflare proxy was removed on request; it is still available at
 * https://supabase-proxy.utuberpraveen.workers.dev if it is needed again.
 */
export const SUPABASE_URL = "https://oxwhqvsoelqqsblmqkxx.supabase.co";

/**
 * Direct Supabase URL — bypasses the Cloudflare Worker proxy.
 * Used ONLY for long-running edge functions (e.g. ai-teaching-assistant)
 * that would otherwise hit the Worker's 150s idle timeout.
 * Supabase Pro allows up to 400s wall-clock on edge functions.
 */
export const SUPABASE_DIRECT_URL = "https://oxwhqvsoelqqsblmqkxx.supabase.co";

/**
 * The project's public anon ("publishable") key — the same value as in integrations/supabase/client.ts, which
 * does not export it. It is public by design (it ships in every page). Hand-written `fetch` calls to edge
 * functions use it as the bearer token when nobody is signed in, exactly as `supabase.functions.invoke` does, and
 * as the `apikey` header. Hardcoded here for the same reason as the URLs above: a build-time VITE_ variable is
 * not reliably present.
 */
export const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94d2hxdnNvZWxxcXNibG1xa3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1MTU4NTgsImV4cCI6MjA3NTA5MTg1OH0.nZbWSb9AQK5uGAQmc7zXAceTHm9GRQJvqkg4-LNo_DM";
