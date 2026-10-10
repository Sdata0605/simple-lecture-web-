import { useCallback, useEffect, useState } from "react";
import { safeLocalStorage } from "@/lib/safeStorage";

/** A visitor's own settings. They live only in this browser (localStorage), never on a server. */
export interface TeacherPrefs {
  /** Optional: the visitor's own Google Gemini key. */
  apiKey: string;
  /** Gemini voice name, or "" for the site default. */
  voice: string;
  /** Teacher's name, or "" for the site default. */
  teacherName: string;
  preset: string;
  custom: string;
  language: string;
}

export const DEFAULT_PREFS: TeacherPrefs = { apiKey: "", voice: "", teacherName: "", preset: "friendly", custom: "", language: "auto" };

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
  { id: "hi", label: "हिन्दी (Hindi)" },
  { id: "kn", label: "ಕನ್ನಡ (Kannada)" },
];

const KEY = "aiteacher.prefs.v1";
const EVENT = "aiteacher-prefs-changed";

export function loadPrefs(): TeacherPrefs {
  try {
    const raw = safeLocalStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: TeacherPrefs) {
  safeLocalStorage.setItem(KEY, JSON.stringify(p));
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
