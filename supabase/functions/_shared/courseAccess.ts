// Course access check for the AI Teacher.
//
// A student who has an active, unexpired enrollment in any course can use the AI Teacher with
// their own Gemini API keys. No separate plan purchase is needed.
// Pass the service role client. Never log the user id or email.

// deno-lint-ignore-file no-explicit-any
type SbLike = any;

/** True when the user has at least one active, unexpired course enrollment. False on any error. */
export async function hasCourseAccess(sb: SbLike, userId: string): Promise<boolean> {
  try {
    const { data, error } = await sb.from("enrollments")
      .select("expires_at")
      .eq("student_id", userId)
      .eq("is_active", true)
      .limit(100);
    if (error) {
      console.warn("[courseAccess] could not read enrollments");
      return false;
    }
    const now = Date.now();
    return Array.isArray(data) && data.some((r: any) => !r.expires_at || new Date(r.expires_at).getTime() > now);
  } catch {
    console.warn("[courseAccess] course access check failed");
    return false;
  }
}
