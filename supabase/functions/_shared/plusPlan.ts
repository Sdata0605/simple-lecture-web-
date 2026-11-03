// Plus plan check for the AI Teacher (Rs 500 Plus, or Rs 1000 Pro, which also counts as Plus).
//
// Entitlement comes from public.sales_leads: a row whose email matches the user's auth email
// (case-insensitive) with lead_status 'converted_plan_500' or 'converted_plan_1000'.
// Pass the service role client. Never log the email.

// deno-lint-ignore-file no-explicit-any
type SbLike = any;

const PLUS_STATUSES = ["converted_plan_500", "converted_plan_1000"];

/** Escapes LIKE wildcards so an email is matched literally by ilike (case-insensitive equality). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** True when the user has bought the Plus plan (Rs 500) or Pro (Rs 1000). False on any error. */
export async function hasPlusPlan(sb: SbLike, userId: string): Promise<boolean> {
  try {
    const { data: userRes, error: userErr } = await sb.auth.admin.getUserById(userId);
    if (userErr) {
      console.warn("[plusPlan] could not load user");
      return false;
    }
    const email: string = String(userRes?.user?.email ?? "").trim();
    if (!email) return false;

    const { data, error } = await sb.from("sales_leads")
      .select("id")
      .ilike("email", escapeLike(email))
      .in("lead_status", PLUS_STATUSES)
      .limit(1);
    if (error) {
      console.warn("[plusPlan] could not read sales_leads");
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch {
    console.warn("[plusPlan] plan check failed");
    return false;
  }
}
