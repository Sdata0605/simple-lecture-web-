// Athena's API never hands back a submitted document's original text — only
// status/chunk-count metadata (confirmed: GET /documents/:id has no content
// field, and there's no /documents/:id/content or /chunks route). So the only
// place the submitted markdown survives after upload is here: a local cache,
// written the moment we submit text we already have client-side (the Import
// dialog's per-topic markdown, or a .md/.txt file picked in the Documents tab).
// Scoped to this browser only — not shared across admins/devices.
import { safeLocalStorage } from "@/lib/safeStorage";

const KEY_PREFIX = "athena-doc-markdown:";
const MAX_ENTRIES = 500; // guard against unbounded localStorage growth

function storageKey(subjectId: string, documentId: string) {
  return `${KEY_PREFIX}${subjectId}:${documentId}`;
}

export function saveDocumentMarkdown(subjectId: string, documentId: string, markdown: string) {
  if (!documentId || !markdown) return;
  try {
    safeLocalStorage.setItem(storageKey(subjectId, documentId), markdown);
    pruneIfNeeded();
  } catch {
    // Storage full/unavailable — the upload itself already succeeded, so just
    // skip caching rather than failing the import over this.
  }
}

export function getDocumentMarkdown(subjectId: string, documentId: string): string | undefined {
  try {
    return safeLocalStorage.getItem(storageKey(subjectId, documentId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function pruneIfNeeded() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < safeLocalStorage.length; i++) {
      const k = safeLocalStorage.key(i);
      if (k?.startsWith(KEY_PREFIX)) keys.push(k);
    }
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) {
        safeLocalStorage.removeItem(k);
      }
    }
  } catch {
    // best-effort
  }
}

// Which app-side subject (popular_subjects.id) an Athena subject was
// imported from — lets "View" recover markdown for documents that predate
// the cache above (or were never cached) by looking the topic up live from
// the app's own DB and matching on title, instead of only trusting the
// local cache. Remembered per Athena subject so it only needs picking once.
const LINK_KEY_PREFIX = "athena-subject-source-link:";

export function saveLinkedSourceSubject(athenaSubjectId: string, appSubjectId: string) {
  try {
    safeLocalStorage.setItem(`${LINK_KEY_PREFIX}${athenaSubjectId}`, appSubjectId);
  } catch {
    // best-effort
  }
}

export function getLinkedSourceSubject(athenaSubjectId: string): string | undefined {
  try {
    return safeLocalStorage.getItem(`${LINK_KEY_PREFIX}${athenaSubjectId}`) ?? undefined;
  } catch {
    return undefined;
  }
}
