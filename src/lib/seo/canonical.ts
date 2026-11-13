/**
 * Canonical URL rule for the whole site: every page URL ends with "/" except the
 * homepage, because Apache redirects folder URLs without the slash (for example
 * /programs -> /programs/). Canonicals, og:url and sitemap entries must use the
 * same form as the URL the page is finally served on.
 *
 * Keep this in sync with scripts/prerender-static.mjs (canonicalFor) and
 * supabase/functions/dynamic-sitemap/index.ts (siteLoc).
 */
export function withTrailingSlash(url: string): string {
  const match = url.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  const base = match ? match[1] : url;
  const rest = match ? (match[2] || "") + (match[3] || "") : "";
  // Homepage and URLs that point at a file (for example .png) are left alone.
  const isRoot = /^https?:\/\/[^/]+\/?$/.test(base);
  const hasFileExtension = /\/[^/]+\.[a-z0-9]+$/i.test(base);
  if (isRoot || hasFileExtension || base.endsWith("/")) return base + rest;
  return base + "/" + rest;
}
