/**
 * The name shown for a student: their full name, or, if they have none, the part of their
 * login email before the @ (the domain is never shown).
 */
export function withDisplayName<T extends { full_name: string | null; email_name?: string | null }>(profile: T): T {
  return { ...profile, full_name: profile.full_name || profile.email_name || null };
}
