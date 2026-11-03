import { useCallback, useEffect, useState } from "react";
import { safeLocalStorage } from "@/lib/safeStorage";

/** Teacher settings. The student's Gemini keys live on the server (see aiTeacherKeys.ts); this is only a cache of the prefs. */
export interface TeacherPrefs {
  /** Gemini voice name, or "" for the site default. */
  voice: string;
  /** Teacher's name, or "" for the site default. */
  teacherName: string;
  preset: string;
  custom: string;
  language: string;
}

export const DEFAULT_PREFS: TeacherPrefs = {
  voice: "",
  teacherName: "",
  preset: "friendly",
  custom: "",
  language: "auto",
};

export const PRESET_OPTIONS = [
  { id: "friendly", emoji: "😊", label: "Friendly", desc: "Warm, patient and encouraging" },
  { id: "strict", emoji: "🧑‍🏫", label: "Strict", desc: "Disciplined, precise, keeps you focused" },
  { id: "fun", emoji: "🎉", label: "Fun", desc: "Energetic, playful, a few jokes" },
  { id: "calm", emoji: "🌿", label: "Calm", desc: "Gentle, never rushed, tiny steps" },
  { id: "storyteller", emoji: "📖", label: "Storyteller", desc: "Explains through stories and scenes" },
  { id: "coach", emoji: "🏆", label: "Exam coach", desc: "Marks, key points and memory tricks" },
];

export const VOICE_OPTIONS = [
  { id: "Kore", desc: "Firm" },
  { id: "Puck", desc: "Upbeat" },
  { id: "Charon", desc: "Informative" },
  { id: "Aoede", desc: "Breezy" },
  { id: "Fenrir", desc: "Excitable" },
  { id: "Leda", desc: "Youthful" },
  { id: "Orus", desc: "Steady" },
  { id: "Zephyr", desc: "Bright" },
];

export const LANGUAGE_OPTIONS = [
  { id: "auto", label: "Match my language" },
  { id: "en", label: "English" },
  { id: "hi", label: "हिन्दी (Hinglish: Hindi + English)" },
  { id: "mr", label: "मराठी (Menglish: Marathi + English)" },
  { id: "kn", label: "ಕನ್ನಡ (Kanglish: Kannada + English)" },
];

const KEY = "aiteacher.prefs.v2";
const LEGACY_KEY = "aiteacher.prefs.v1";
/** Set while an old key from v1 is waiting to be offered for import to the server. */
const LEGACY_FLAG = "aiteacher.legacyKeyPending";
const EVENT = "aiteacher-prefs-changed";

/** The old browser-only key, held in memory only until the import prompt is answered. */
let legacyKeyInMemory: string | null = null;

/**
 * One-time migration from v1. An old key is moved out of localStorage into memory and a flag is kept so the
 * import prompt can offer to save it on the server. The key is never written back to storage.
 */
function migrateLegacyPrefs() {
  try {
    const raw = safeLocalStorage.getItem(LEGACY_KEY);
    if (raw) {
      const old = JSON.parse(raw) ?? {};
      const oldKey = typeof old.apiKey === "string" ? old.apiKey.trim() : "";
      if (oldKey) {
        legacyKeyInMemory = oldKey;
        safeLocalStorage.setItem(LEGACY_FLAG, "1");
      }
      safeLocalStorage.removeItem(LEGACY_KEY);
    }
    // A flag without the key in memory (the page was reloaded before the prompt was answered) is stale.
    if (!legacyKeyInMemory) safeLocalStorage.removeItem(LEGACY_FLAG);
  } catch {
    /* storage unavailable: nothing to migrate */
  }
}
migrateLegacyPrefs();

/** The old own-key from the browser, if the one-time import prompt should still be shown. */
export function getLegacyKeyForImport(): string | null {
  return safeLocalStorage.getItem(LEGACY_FLAG) === "1" ? legacyKeyInMemory : null;
}

/** Call after the import is saved to the server, or after the student dismisses the prompt. */
export function finishLegacyKeyImport() {
  legacyKeyInMemory = null;
  safeLocalStorage.removeItem(LEGACY_FLAG);
}

export function loadPrefs(): TeacherPrefs {
  try {
    const raw = safeLocalStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const { apiKey: _ignoredKey, apiMode: _ignoredMode, ...saved } = JSON.parse(raw) ?? {};
    return { ...DEFAULT_PREFS, ...saved };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: TeacherPrefs) {
  // Keys never go into this cache; they are stored on the server only.
  const { apiKey: _k, apiMode: _m, ...clean } = p as TeacherPrefs & { apiKey?: unknown; apiMode?: unknown };
  safeLocalStorage.setItem(KEY, JSON.stringify(clean));
  window.dispatchEvent(new Event(EVENT));
}

export function usePrefs(): [TeacherPrefs, (patch: Partial<TeacherPrefs>) => void] {
  const [prefs, setPrefs] = useState<TeacherPrefs>(loadPrefs);
  useEffect(() => {
    const sync = () => setPrefs(loadPrefs());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const update = useCallback((patch: Partial<TeacherPrefs>) => savePrefs({ ...loadPrefs(), ...patch }), []);
  return [prefs, update];
}

/** The part of the settings the server uses to write the teacher's instructions. */
export const personaPayload = (p: TeacherPrefs) => ({
  name: p.teacherName,
  preset: p.preset,
  custom: p.custom,
  language: p.language,
  voice: p.voice || undefined,
});
