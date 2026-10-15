import { teacherApi, TeacherApiError, type ChatResult, type PreparedChat, type QuizData, type BigQuestionData } from "./aiTeacherApi";
import { personaPayload, type TeacherPrefs } from "./aiTeacherPrefs";
import { loadSubscription } from "./aiTeacherSubscription";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

/** Pulls a JSON object out of a model reply (it may be wrapped in a code fence or extra words). */
function parseJsonObject(text: string): any | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

function validQuiz(j: any): QuizData | null {
  if (!j || typeof j.question !== "string" || !Array.isArray(j.options) || j.options.length !== 4) return null;
  const ci = Number(j.correct_index);
  if (!Number.isInteger(ci) || ci < 0 || ci > 3) return null;
  return { question: j.question.trim(), options: j.options.map((o: unknown) => String(o).trim()), correct_index: ci, explanation: typeof j.explanation === "string" ? j.explanation.trim() : null };
}

function validBigQ(j: any): BigQuestionData | null {
  if (!j || typeof j.question !== "string" || typeof j.model_answer !== "string") return null;
  return { question: j.question.trim(), model_answer: j.model_answer.trim() };
}

/** Calls Gemini straight from the browser with the visitor's own key (same model fallback as the server). */
async function generateWithOwnKey(apiKey: string, prep: PreparedChat["prepare"]): Promise<string> {
  let lastStatus = 0;
  for (const model of prep.models) {
    for (const noThinking of [true, false]) {
      try {
        const r = await fetch(`${GEMINI}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          signal: AbortSignal.timeout(25_000),
          headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: prep.system }] },
            contents: prep.contents,
            generationConfig: {
              temperature: prep.json ? 0.7 : 0.3,
              maxOutputTokens: 2048,
              ...(prep.json ? { responseMimeType: "application/json" } : {}),
              ...(noThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
            },
          }),
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) {
          const text = (body.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
          if (text) return text;
          break;
        }
        lastStatus = r.status;
        if (r.status === 400 && noThinking) {
          // an invalid key is a 400 too: stop right away instead of trying other models
          if (/api key/i.test(body?.error?.message ?? "")) throw new TeacherApiError("Your API key was not accepted by Google. Check it in Settings.", 400);
          continue;
        }
        if (r.status === 401 || r.status === 403) throw new TeacherApiError("Your API key was not accepted by Google. Check it in Settings.", r.status);
        break;
      } catch (e) {
        if (e instanceof TeacherApiError) throw e;
        break; // timeout / network: next model
      }
    }
  }
  throw new TeacherApiError(lastStatus === 429 ? "Your API key has hit its limit. Please try again in a moment." : "The teacher could not answer right now. Please try again.", lastStatus || undefined);
}

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
 * One call for every chat mode. With the student's own key, our server only finds the notes and
 * writes the prompt; the answer comes straight from Google and the key never touches our server.
 */
export async function teacherChat(
  body: Record<string, unknown>,
  prefs: TeacherPrefs,
  enrolledSubjects?: string
): Promise<ChatResult> {
  const sub = loadSubscription();
  if (!sub) {
    throw new TeacherApiError("Please purchase an AI Teacher plan (Plus Plan ₹500 or Pro Plan ₹1000) to chat with your personal AI teacher.");
  }

  const enrolledList = enrolledSubjects || "your enrolled subjects";
  const question = typeof body.question === "string" ? body.question.trim() : "";

  // Enforce purchased courses syllabus boundary
  if (question && isExternalTopicQuery(question, enrolledList)) {
    const topicName = extractExternalTopicName(question);
    return {
      found: false,
      answer: `I am your personal AI tutor for your enrolled syllabus (${enrolledList}). I cannot answer questions about external topics like ${topicName}. Which of your enrolled subjects would you like to study today?`,
    };
  }

  const common = { ...body, enrolledSubjects: enrolledList, persona: personaPayload(prefs) };
  const ownKey = prefs.apiKey?.trim();

  // Plus Plan (₹500): user must provide their own Gemini API key
  if (sub.planId === "byok_500" && !ownKey) {
    throw new TeacherApiError("Your Plus Plan requires your own Google Gemini API key. Please add your key in Settings to chat.");
  }

  // Plus Plan users always use their own key.
  // Pro Plan users use their own key if apiMode is 'own' and key is provided; otherwise Admin key.
  const shouldUseOwnKey = sub.planId === "byok_500" || (prefs.apiMode === "own" && !!ownKey);

  if (shouldUseOwnKey && ownKey) {
    const prep = await teacherApi<PreparedChat>("chat", { ...common, byok: true });
    const text = await generateWithOwnKey(ownKey, prep.prepare);
    const out: ChatResult = { found: prep.found, topics: prep.topics };
    if (prep.mode === "quiz") {
      const quiz = validQuiz(parseJsonObject(text));
      if (!quiz) throw new TeacherApiError("I could not make that question this time. Please try again.");
      return { ...out, quiz };
    }
    if (prep.mode === "bigq") {
      const bigq = validBigQ(parseJsonObject(text));
      if (!bigq) throw new TeacherApiError("I could not make that question this time. Please try again.");
      return { ...out, bigq };
    }
    return { ...out, answer: text };
  }

  // Pro Plan (admin_1000) without own key: runs on Admin's managed API key
  return teacherApi<ChatResult>("chat", common);
}

/** Quick check used by the Settings page. */
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
