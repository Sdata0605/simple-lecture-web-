/**
 * Course / checkout / purchase analytics for GA4 (gtag) and the Meta Pixel (fbq).
 *
 * - Only sends from the live hosts (same list as index.html, which is where gtag/fbq are created).
 * - Never sends on admin / instructor / auth / payment-callback paths.
 * - gtag and fbq are injected by index.html on window load, so calls made earlier are queued
 *   and flushed when they appear (checked every 300 ms, dropped after 15 s).
 * - Localhost testing: open any page with ?analytics_debug=1 on a NON-live host. The flag is kept
 *   in sessionStorage for the tab, and every event is console.logged instead of sent.
 */

export const LIVE_HOSTS = ['simplelecture.com', 'www.simplelecture.com'];

const EXCLUDED_PATH_PREFIXES = ['/admin', '/instructor', '/payment-callback', '/auth'];

const DEBUG_PARAM = 'analytics_debug';
const DEBUG_STORAGE_KEY = 'sl_analytics_debug';
const ONCE_STORAGE_PREFIX = 'sl_analytics_once:';

const FLUSH_INTERVAL_MS = 300;
const FLUSH_TIMEOUT_MS = 15_000;

/** Meta standard events we use; anything else must go through trackCustom. */
type MetaStandardEvent = 'ViewContent' | 'InitiateCheckout' | 'Purchase';

export type AnalyticsParams = Record<string, unknown>;

export interface TrackEventInput {
  /** GA4 event name (sent with gtag('event', ga4, params)). */
  ga4?: string;
  /** Meta standard event (fbq('track', ...)). */
  meta?: MetaStandardEvent;
  /** Meta custom event (fbq('trackCustom', ...)). Ignored when `meta` is set. */
  metaCustom?: string;
  params: AnalyticsParams;
  /** Optional per-call params override for Meta (defaults to `params`). */
  metaParams?: AnalyticsParams;
  /** Meta eventID, for dedupe with a future server-side (CAPI) event. */
  eventId?: string;
}

// gtag / fbq are declared on Window by useGoogleAnalytics / useFacebookPixel; they may still be
// undefined at runtime until index.html injects them, so always check with typeof.
type Tracker = (...args: unknown[]) => void;
const getGtag = (): Tracker | null =>
  typeof window !== 'undefined' && typeof window.gtag === 'function' ? (window.gtag as Tracker) : null;
const getFbq = (): Tracker | null =>
  typeof window !== 'undefined' && typeof window.fbq === 'function' ? (window.fbq as Tracker) : null;

export const isLiveHost = (): boolean =>
  typeof window !== 'undefined' && LIVE_HOSTS.includes(window.location.hostname);

export const isExcludedPath = (path: string): boolean => {
  // React Router matches paths case-insensitively, so /Admin must be excluded too.
  const p = path.toLowerCase();
  return EXCLUDED_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
};

/** Debug (console-only) mode: non-live host AND ?analytics_debug=1 seen in this tab. */
const isDebugMode = (): boolean => {
  if (typeof window === 'undefined' || isLiveHost()) return false;
  try {
    const flag = new URLSearchParams(window.location.search).get(DEBUG_PARAM);
    if (flag === '1') sessionStorage.setItem(DEBUG_STORAGE_KEY, '1');
    if (flag === '0') sessionStorage.removeItem(DEBUG_STORAGE_KEY);
    return sessionStorage.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Course slug -> event-name prefix. Keep every special case in this one table.
 * Matched with startsWith on the slug.
 */
const COURSE_PREFIX_TABLE: ReadonlyArray<{ slugPrefix: string; eventPrefix: string }> = [
  { slugPrefix: 'class-10-sslc', eventPrefix: 'Class_10th' },
];

/**
 * Event-name prefix for a course. Uses COURSE_PREFIX_TABLE, otherwise the slug (or name) with
 * every run of non-alphanumerics turned into "_", trimmed, and cut to 20 chars so that
 * `${prefix}_Free_Chapter_views` stays within GA4's 40-char event-name limit. GA4 names must
 * start with a letter, so a leading digit gets "C_" in front.
 */
export const courseEventPrefix = (slug: string | null | undefined, name?: string | null): string => {
  const s = (slug ?? '').toLowerCase();
  const mapped = COURSE_PREFIX_TABLE.find((row) => s.startsWith(row.slugPrefix));
  if (mapped) return mapped.eventPrefix;
  let prefix = (slug || name || 'Course').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!prefix) prefix = 'Course';
  if (/^[0-9]/.test(prefix)) prefix = `C_${prefix}`;
  return prefix.slice(0, 20).replace(/_+$/, '');
};

/**
 * Returns true the first time it is called for `key` in this browser session (sessionStorage),
 * false afterwards. If sessionStorage is unavailable, falls back to an in-memory set.
 */
const memoryOnce = new Set<string>();
export const onceKey = (key: string): boolean => {
  const storageKey = ONCE_STORAGE_PREFIX + key;
  try {
    if (sessionStorage.getItem(storageKey)) return false;
    sessionStorage.setItem(storageKey, '1');
    return true;
  } catch {
    if (memoryOnce.has(storageKey)) return false;
    memoryOnce.add(storageKey);
    return true;
  }
};

/**
 * Like onceKey, but remembered across browser sessions and devices' local storage
 * (same browser). Use for purchases, so reopening a receipt in a new session never
 * sends the same purchase twice.
 */
export const onceForever = (key: string): boolean => {
  const storageKey = ONCE_STORAGE_PREFIX + key;
  try {
    if (localStorage.getItem(storageKey)) return false;
    localStorage.setItem(storageKey, '1');
    return true;
  } catch {
    if (memoryOnce.has(storageKey)) return false;
    memoryOnce.add(storageKey);
    return true;
  }
};

// ---- queue for calls made before gtag / fbq exist ----

interface QueuedCall {
  vendor: 'gtag' | 'fbq';
  args: unknown[];
  queuedAt: number;
}

const queue: QueuedCall[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

const flushQueue = () => {
  const now = Date.now();
  for (let i = 0; i < queue.length; ) {
    const call = queue[i];
    const fn = call.vendor === 'gtag' ? getGtag() : getFbq();
    if (fn) {
      fn(...call.args);
      queue.splice(i, 1);
    } else if (now - call.queuedAt > FLUSH_TIMEOUT_MS) {
      console.warn(`[analytics] ${call.vendor} not available after 15s; dropped`, call.args[1]);
      queue.splice(i, 1);
    } else {
      i += 1;
    }
  }
  if (queue.length === 0 && flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
};

const send = (vendor: 'gtag' | 'fbq', args: unknown[]) => {
  const fn = vendor === 'gtag' ? getGtag() : getFbq();
  if (fn) {
    fn(...args);
    return;
  }
  queue.push({ vendor, args, queuedAt: Date.now() });
  if (!flushTimer) flushTimer = setInterval(flushQueue, FLUSH_INTERVAL_MS);
};

/** Send one event to GA4 and/or Meta. No-op off the live hosts (except debug logging). */
export const trackEvent = ({ ga4, meta, metaCustom, params, metaParams, eventId }: TrackEventInput): void => {
  if (typeof window === 'undefined') return;
  if (isExcludedPath(window.location.pathname)) return;

  const fbParams = metaParams ?? params;
  const fbOptions = eventId ? { eventID: eventId } : undefined;
  const calls: Array<{ vendor: 'gtag' | 'fbq'; args: unknown[] }> = [];
  if (ga4) calls.push({ vendor: 'gtag', args: ['event', ga4, params] });
  if (meta) calls.push({ vendor: 'fbq', args: fbOptions ? ['track', meta, fbParams, fbOptions] : ['track', meta, fbParams] });
  else if (metaCustom)
    calls.push({ vendor: 'fbq', args: fbOptions ? ['trackCustom', metaCustom, fbParams, fbOptions] : ['trackCustom', metaCustom, fbParams] });

  if (!isLiveHost()) {
    if (isDebugMode()) {
      for (const call of calls) console.log(`[analytics debug] ${call.vendor}`, ...call.args);
    }
    return;
  }

  for (const call of calls) send(call.vendor, call.args);
};
