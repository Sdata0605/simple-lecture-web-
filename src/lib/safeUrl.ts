/**
 * Returns the URL only if it parses and uses http: or https:.
 * Use for URLs that come from stored data before rendering them as links,
 * so javascript:, data:, and other schemes are never rendered.
 */
export function safeHttpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}
