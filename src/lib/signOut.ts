import { supabase } from "@/integrations/supabase/client";

/**
 * Signs the user out even when the sign-out request cannot reach the auth server (for example when the
 * Cloudflare auth proxy is unreachable). supabase.auth.signOut() keeps the saved session when that request
 * fails, so the saved session is removed here too, and the page is reloaded so no signed-in state stays
 * in memory.
 */
export async function signOutEverywhere(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {
    // Handled below: the saved session is removed even when the server could not be told.
  }
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing saved to remove.
  }
  window.location.replace("/");
}
