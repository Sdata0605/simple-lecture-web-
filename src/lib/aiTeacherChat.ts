import { teacherApi, TeacherApiError, type ChatResult } from "./aiTeacherApi";
import { personaPayload, type TeacherPrefs } from "./aiTeacherPrefs";
import { loadSubscription } from "./aiTeacherSubscription";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

const KNOWN_EXTERNAL_TOPICS = [
  "computer fundamentals",
  "python",
  "java",
  "c++",
  "c programming",
  "javascript",
  "html",
  "css",
  "machine learning",
  "artificial intelligence",
  "data science",
  "web development",
  "cyber security",
  "cloud computing",
  "database management",
  "sql",
];

export function isExternalTopicQuery(query: string, enrolledSubjectsText: string): boolean {
  const q = query.toLowerCase();
  const enrolled = enrolledSubjectsText.toLowerCase();
  for (const ext of KNOWN_EXTERNAL_TOPICS) {
    const wordPattern = new RegExp(`\\b${ext.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i");
    if (wordPattern.test(q) && !enrolled.includes(ext)) {
      return true;
    }
  }
  return false;
}

export function extractExternalTopicName(query: string): string {
  const q = query.toLowerCase();
  for (const ext of KNOWN_EXTERNAL_TOPICS) {
    const wordPattern = new RegExp(`\\b${ext.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i");
    if (wordPattern.test(q)) {
      return ext.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }
  return "external topics";
}

/**
 * One call for every chat mode. The server answers with the student's own saved Gemini key
 * (it picks the active key and fails over on its own).
 */
export async function teacherChat(
  body: Record<string, unknown>,
  prefs: TeacherPrefs,
  enrolledSubjects?: string
): Promise<ChatResult> {
  const sub = loadSubscription();
  if (!sub) {
    throw new TeacherApiError("Please purchase an AI Teacher plan (Plus Plan ₹500) to chat with your personal AI teacher.");
  }

  const enrolledList = enrolledSubjects || "your enrolled subjects";
  const question = typeof body.question === "string" ? body.question.trim() : "";

  // Enforce purchased courses syllabus boundary
  if (question && isExternalTopicQuery(question, enrolledList)) {
    const topicName = extractExternalTopicName(question);
    return {
      found: false,
      topics: [],
      answer: `I am your personal AI tutor for your enrolled syllabus (${enrolledList}). I cannot answer questions about external topics like ${topicName}. Which of your enrolled subjects would you like to study today?`,
    };
  }

  const common = { ...body, enrolledSubjects: enrolledList, persona: personaPayload(prefs) };
  return teacherApi<ChatResult>("chat", common);
}

/**
 * Quick check of a Gemini key typed in the browser. Used by the guide and settings screens.
 * Kept for those screens; the keys themselves are now saved and tested on the server (aiTeacherKeys.ts).
 */
export async function testOwnKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await fetch(`${GEMINI}/gemini-3.1-flash-lite`, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(15_000) });
    if (r.ok) return { ok: true, message: "Your key works." };
    const b = await r.json().catch(() => ({}));
    if (r.status === 400 || r.status === 401 || r.status === 403) return { ok: false, message: "Google did not accept this key. Check that you copied all of it." };
    return { ok: false, message: String(b?.error?.message ?? `Google answered with status ${r.status}.`).slice(0, 160) };
  } catch {
    return { ok: false, message: "Could not reach Google. Check your internet connection." };
  }
}
