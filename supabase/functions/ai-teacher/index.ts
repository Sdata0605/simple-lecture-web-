// Public backend for the "AI Teacher 1-to-1" page (/aiteacher). No login required, so:
//  - the Gemini API key (ai_settings.ai_teacher_1to1_config) never leaves this function;
//    the browser only receives a short-lived, single-use Live API token (ephemeral token),
//  - every public action is rate-limited per IP (table ai_teacher_usage),
//  - answers are grounded in the knowledge index (knowledge_chunks / topic_routing_cards).
//
// POST { action, ... }
//   subjects                          -> subjects that have an index
//   outline   { subjectId }           -> chapters/topics available for the subject
//   session   { subjectId }           -> ephemeral Live API token + voice config
//   search    { subjectId, query | topicId } -> references, documents, practice questions
//   chat      { subjectId, question, messages?, topicId? } -> text answer + references
//   test      { apiKey?, liveModel?, chatModel? } (admin only) -> key / model checks

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai@2.28.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------- config
interface TeacherConfig {
  enabled: boolean;
  google_api_key: string;
  live_model: string;
  chat_model: string;
  voice_name: string;
  teacher_name: string;
}
const DEFAULT_CONFIG: TeacherConfig = {
  enabled: false,
  google_api_key: "",
  live_model: "gemini-3.8-live",
  chat_model: "gemini-3.1-flash-lite",
  voice_name: "Kore",
  teacher_name: "AI Teacher",
};

async function loadConfig(): Promise<TeacherConfig> {
  const { data } = await sb.from("ai_settings").select("setting_value").eq("setting_key", "ai_teacher_1to1_config").maybeSingle();
  const v = (data?.setting_value ?? {}) as Partial<TeacherConfig>;
  const clean = (s: unknown, d: string) => (typeof s === "string" && s.trim() ? s.trim() : d);
  return {
    enabled: !!v.enabled,
    google_api_key: clean(v.google_api_key, ""),
    live_model: clean(v.live_model, DEFAULT_CONFIG.live_model),
    // "gemini-flash-latest" was the first default and is a slow thinking model (8-45 s): treat it as "not chosen".
    chat_model: v.chat_model === "gemini-flash-latest" ? DEFAULT_CONFIG.chat_model : clean(v.chat_model, DEFAULT_CONFIG.chat_model),
    voice_name: clean(v.voice_name, DEFAULT_CONFIG.voice_name),
    teacher_name: clean(v.teacher_name, DEFAULT_CONFIG.teacher_name),
  };
}

// ---------------------------------------------------------------- rate limiting
const LIMITS: Record<string, { perHour: number; perDay: number }> = {
  session: { perHour: 6, perDay: 20 },
  chat: { perHour: 60, perDay: 300 },
  search: { perHour: 200, perDay: 1000 },
};

async function ipHash(req: Request): Promise<string> {
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
  const salt = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").slice(-16);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + salt));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** Returns true when the request is allowed (and records it). */
async function allow(action: string, ip: string, subjectId?: string): Promise<boolean> {
  const lim = LIMITS[action];
  if (!lim) return true;
  const now = Date.now();
  const count = async (sinceMs: number) => {
    const { count: c } = await sb
      .from("ai_teacher_usage")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ip).eq("action", action)
      .gte("created_at", new Date(now - sinceMs).toISOString());
    return c ?? 0;
  };
  if ((await count(3600_000)) >= lim.perHour || (await count(86400_000)) >= lim.perDay) return false;
  await sb.from("ai_teacher_usage").insert({ ip_hash: ip, action, subject_id: subjectId ?? null });
  if (Math.random() < 0.02) await sb.from("ai_teacher_usage").delete().lt("created_at", new Date(now - 2 * 86400_000).toISOString());
  return true;
}

// ---------------------------------------------------------------- retrieval
let orKeyCache: { key: string; at: number } | null = null;
async function openRouterKey(): Promise<string | null> {
  if (orKeyCache && Date.now() - orKeyCache.at < 300_000) return orKeyCache.key;
  const { data } = await sb.from("ai_settings").select("setting_value").eq("setting_key", "ai_api_config").maybeSingle();
  const key = (data?.setting_value as any)?.openrouter_api_key;
  if (!key) return null;
  orKeyCache = { key, at: Date.now() };
  return key;
}

// Must match the model/dimensions used by scripts/build-knowledge-index.mjs
const embedCache = new Map<string, string>(); // normalized query -> vector literal (per warm instance)
async function embedQuery(text: string): Promise<string | null> {
  const ck = text.toLowerCase().replace(/\s+/g, " ").trim();
  const hit = embedCache.get(ck);
  if (hit) return hit;
  try {
    const key = await openRouterKey();
    if (!key) return null;
    const r = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text, dimensions: 768 }),
    });
    if (!r.ok) { console.error("[ai-teacher] embed failed", r.status); return null; }
    const v: number[] = (await r.json()).data[0].embedding;
    const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
    const lit = `[${v.map((x) => +(x / n).toFixed(6)).join(",")}]`;
    if (embedCache.size >= 300) embedCache.delete(embedCache.keys().next().value as string);
    embedCache.set(ck, lit);
    return lit;
  } catch (e) {
    console.error("[ai-teacher] embed error", e);
    return null;
  }
}

function formatQuestion(q: any) {
  const first = String(q.question_text || "").split(/\n\s*-?\s*\(?A[).]/)[0].trim();
  const opts = q.options && typeof q.options === "object"
    ? Object.entries(q.options as Record<string, any>).map(([key, v]) => ({ key, text: String(v?.text ?? v ?? "") }))
    : [];
  return { id: q.id, text: first, options: opts, correct: String(q.correct_answer || "").trim(), explanation: q.explanation ?? null };
}

async function retrieve(subjectId: string, query: string, topicId?: string) {
  const T: Record<string, number> = {};
  const t0 = Date.now();
  let chunks: any[] = [];
  let routedTopics: any[] = [];

  if (topicId) {
    // Lesson mode: the whole topic, in reading order.
    const { data } = await sb.from("knowledge_chunks")
      .select("id, topic_id, chapter_id, document_id, heading_path, content, chunk_index")
      .eq("subject_id", subjectId).eq("topic_id", topicId)
      .order("document_id").order("chunk_index").limit(14);
    chunks = (data ?? []).map((c) => ({ ...c, score: 1 }));
  } else {
    const emb = await embedQuery(query);
    T.embed = Date.now() - t0;
    const cards = await sb.rpc("search_topic_cards", { p_subject_id: subjectId, p_query_text: query, p_query_embedding: emb, p_match_count: 4 });
    T.cards = Date.now() - t0 - T.embed;
    routedTopics = cards.data ?? [];
    const ids = routedTopics.map((c: any) => c.topic_id);
    if (ids.length) {
      const r = await sb.rpc("search_knowledge_chunks", { p_subject_id: subjectId, p_query_text: query, p_query_embedding: emb, p_match_count: 6, p_topic_ids: ids });
      chunks = r.data ?? [];
    }
    if (chunks.length < 3) {
      // Never hard-drop content: widen to the whole subject.
      const r = await sb.rpc("search_knowledge_chunks", { p_subject_id: subjectId, p_query_text: query, p_query_embedding: emb, p_match_count: 6, p_topic_ids: null });
      chunks = r.data ?? [];
    }
  }

  T.chunks = Date.now() - t0;
  const topicIds = [...new Set(chunks.map((c) => c.topic_id).filter(Boolean))] as string[];
  const docIds = [...new Set(chunks.map((c) => c.document_id).filter(Boolean))] as string[];
  const chapterIds = [...new Set(chunks.map((c) => c.chapter_id).filter(Boolean))] as string[];

  const [cardsRes, docsRes, chRes, qRes] = await Promise.all([
    topicIds.length ? sb.from("topic_routing_cards").select("topic_id, chapter_title, topic_title, summary").in("topic_id", topicIds) : Promise.resolve({ data: [] as any[] }),
    docIds.length ? sb.from("ai_assistant_documents").select("id, display_name, source_type, source_url").in("id", docIds) : Promise.resolve({ data: [] as any[] }),
    chapterIds.length ? sb.from("subject_chapters").select("id, title, pdf_url").in("id", chapterIds) : Promise.resolve({ data: [] as any[] }),
    topicIds.length ? sb.from("questions").select("id, question_text, options, correct_answer, explanation, topic_id").in("topic_id", topicIds.slice(0, 3)).eq("question_type", "mcq").limit(4) : Promise.resolve({ data: [] as any[] }),
  ]);

  const topicInfo = new Map<string, any>((cardsRes.data ?? []).map((c: any) => [c.topic_id, c]));
  const references = chunks.map((c) => ({
    id: c.id,
    topic_id: c.topic_id,
    heading_path: c.heading_path,
    content: String(c.content || "").slice(0, 1600),
    chapter_title: topicInfo.get(c.topic_id)?.chapter_title ?? null,
    topic_title: topicInfo.get(c.topic_id)?.topic_title ?? null,
    score: c.score,
  }));

  // Only public http(s) links are exposed; private storage paths are not.
  const isHttp = (u?: string | null) => !!u && /^https?:\/\//i.test(u);
  const documents: { title: string; url: string; kind: string }[] = [];
  for (const d of docsRes.data ?? []) {
    if (isHttp(d.source_url) && /\.pdf(\?|$)/i.test(d.source_url)) documents.push({ title: d.display_name || "Document", url: d.source_url, kind: "pdf" });
  }
  for (const c of chRes.data ?? []) {
    if (isHttp(c.pdf_url)) documents.push({ title: `${c.title} (chapter PDF)`, url: c.pdf_url, kind: "pdf" });
  }

  T.total = Date.now() - t0;
  return {
    timing: T,
    found: references.length > 0,
    references,
    topics: topicIds.map((id) => topicInfo.get(id)).filter(Boolean),
    documents,
    questions: (qRes.data ?? []).map(formatQuestion).filter((q) => q.text && q.options.length >= 2),
    routed: routedTopics.map((t: any) => ({ topic_id: t.topic_id, topic_title: t.topic_title })),
  };
}

// ---------------------------------------------------------------- prompts
function voicePrompt(cfg: TeacherConfig, catalog: CatSubject[]) {
  const list = catalog.length ? catalog.map((s) => s.name).join(", ") : "none yet";
  return `You are ${cfg.teacher_name}, a warm, patient one-to-one school teacher on a live voice call with a student.

SUBJECTS YOU CAN TEACH: ${list}.

YOU KNOW THE FULL SYLLABUS (below). Topic numbers are written <chapter>.<topic>, so "chapter 31 topic 1" means topic 31.1.
Never ask the student for a topic's name or details that you can find in the syllabus.

${catalogText(catalog)}

START OF THE CALL
- First greet the student in one short sentence and ask: "How can I help you today? Which subject would you like to study?" Then wait for the answer.
- When the student names a subject, call select_subject with that subject's exact name. If it is not in the list, say which subjects you can teach and ask them to pick one.
- If the student asks for a specific lesson (by chapter and topic number, or by a name you can find in the syllabus) call start_lesson straight away with the subject name, chapter_number and topic_number. This also selects the subject. If the same chapter number exists in more than one subject and they did not say which, ask which subject.
- If they name only a chapter, start with its first topic and mention how many topics the chapter has.
- Do not teach other subject content until a subject is selected. If they ask a general question first, ask which subject it is for, then call select_subject and answer it.
- After a subject is selected, ask what they would like to learn, unless they already told you.
- If the student wants to change subject, ask which one and call select_subject again.

HOW TO TEACH
- Speak naturally in short turns (2 to 4 sentences), then pause so the student can respond. Never read out symbols, markdown, URLs or tool names.
- Reply in the language the student speaks (English, Hindi or Kannada). Default to simple English.
- start_lesson returns the notes for the whole topic: teach it section by section from those notes, one part at a time. For follow-up questions or other topics call search_notes. Teach ONLY from the notes you receive; if they do not cover something, say so honestly and suggest a related topic.
- While explaining, call present_slide to put a short title and 3 to 5 bullet points on the student's board.
- After you finish explaining an idea, check understanding by calling show_quiz with ONE multiple-choice question (4 options, exactly one correct) based on the notes, then wait. The system will tell you which option the student chose; react kindly, explain why, and move on.
- Encourage the student. Correct mistakes gently. Keep the lesson interactive: ask what they want to learn next when a topic is done.
- Keep every spoken turn short; the student can interrupt you at any time.`;
}

function chatPrompt(cfg: TeacherConfig, subject: string) {
  return `You are ${cfg.teacher_name}, a friendly one-to-one school teacher for the subject "${subject}". A student is chatting with you in writing.

RULES
- Answer ONLY from the NOTES provided with the question. If the NOTES do not contain the answer, say so briefly and suggest a related topic; do not invent facts.
- Reply in the language of the student's question (English, Hindi or Kannada).
- Teach step by step in simple words: short paragraphs and bullet points. Use Markdown. Use LaTeX with $...$ only when needed for formulas.
- If the student asks you to teach a lesson, teach it in clear parts, covering the important points from the NOTES, then end with one short question to check understanding.
- Do not mention the words "NOTES" or "retrieval". End with a line like "Source: Chapter > Topic" naming the chapter and topic you used.`;
}

// ---------------------------------------------------------------- Gemini helpers
/**
 * Fast answers matter for a tutor: thinking is switched off (it adds 4-8 s), each attempt has a
 * 20 s limit, and an overloaded/slow/retired model falls through to the next one.
 */
async function geminiGenerate(cfg: TeacherConfig, system: string, contents: any[]) {
  const chain = [...new Set([cfg.chat_model, "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-flash-latest"])];
  let lastStatus = 0;
  for (const model of chain) {
    for (const noThinking of [true, false]) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          signal: AbortSignal.timeout(20_000),
          headers: { "x-goog-api-key": cfg.google_api_key, "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: { temperature: 0.3, maxOutputTokens: 2048, ...(noThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
          }),
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) {
          const text = (body.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
          if (text) return text;
          break; // empty reply: try the next model
        }
        lastStatus = r.status;
        console.error(`[ai-teacher] generateContent ${model} failed`, r.status, JSON.stringify(body).slice(0, 300));
        if (r.status === 400 && noThinking) continue; // this model may not accept thinkingConfig: retry it without
        break; // 404 / 429 / 5xx: next model
      } catch (e) {
        console.error(`[ai-teacher] generateContent ${model} error`, String((e as any)?.message ?? e));
        break; // timeout / network: next model
      }
    }
  }
  const e: any = new Error("AI request failed");
  e.status = lastStatus;
  throw e;
}

/**
 * The tools the voice teacher can use. They MUST be locked into the ephemeral token: a Live session
 * made with a token ignores tools the browser adds itself (tested), so the browser reuses this list.
 */
const LIVE_TOOLS = [{
  functionDeclarations: [
    {
      name: "select_subject",
      description: "Select the subject the student wants to study. Call it as soon as the student names a subject.",
      parameters: { type: "OBJECT", properties: { subject: { type: "STRING", description: "The exact subject name from the list of subjects you can teach." } }, required: ["subject"] },
    },
    {
      name: "start_lesson",
      description: "Open a lesson from the syllabus by chapter and topic number and get its full notes. Use it when the student asks for a chapter/topic by number or by a name found in the syllabus. This also selects the subject.",
      parameters: {
        type: "OBJECT",
        properties: {
          subject: { type: "STRING", description: "Exact subject name from the syllabus." },
          chapter_number: { type: "INTEGER", description: "The chapter number, e.g. 31." },
          topic_number: { type: "INTEGER", description: "The topic number within the chapter, e.g. 1 for topic 31.1. Omit to start with the first topic." },
        },
        required: ["subject", "chapter_number"],
      },
    },
    {
      name: "search_notes",
      description: "Search the study notes of the selected subject. Call this before answering any follow-up question or teaching a topic that was not opened with start_lesson.",
      parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "The topic or question to look up, in English." } }, required: ["query"] },
    },
    {
      name: "present_slide",
      description: "Show a slide on the student's board while you explain.",
      parameters: {
        type: "OBJECT",
        properties: { title: { type: "STRING" }, bullets: { type: "ARRAY", items: { type: "STRING" }, description: "3 to 5 short bullet points" } },
        required: ["title", "bullets"],
      },
    },
    {
      name: "show_quiz",
      description: "Show ONE multiple-choice question on the board to check the student's understanding.",
      parameters: {
        type: "OBJECT",
        properties: {
          question: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" }, description: "Exactly 4 options" },
          correct_index: { type: "INTEGER", description: "0-based index of the correct option" },
          explanation: { type: "STRING", description: "One-sentence explanation of the answer" },
        },
        required: ["question", "options", "correct_index", "explanation"],
      },
    },
  ],
}];

async function mintLiveToken(cfg: TeacherConfig, apiKey: string, systemInstruction: string) {
  const now = Date.now();
  const expireTime = new Date(now + 20 * 60_000).toISOString();
  const newSessionExpireTime = new Date(now + 90_000).toISOString();
  const core = {
    responseModalities: ["AUDIO"],
    systemInstruction,
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice_name } } },
  };
  const attempts: { level: string; versions: string[]; constraints: any }[] = [
    { level: "locked+tools", versions: ["v1alpha", "v1beta"], constraints: { model: cfg.live_model, config: { ...core, tools: LIVE_TOOLS } } },
    { level: "locked", versions: ["v1alpha", "v1beta"], constraints: { model: cfg.live_model, config: core } },
    { level: "model-only", versions: ["v1alpha", "v1beta"], constraints: { model: cfg.live_model, config: { responseModalities: ["AUDIO"] } } },
  ];
  let lastErr: unknown = null;
  for (const a of attempts) {
    for (const apiVersion of a.versions) {
      try {
        const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion } });
        const tok = await ai.authTokens.create({
          config: { uses: 1, expireTime, newSessionExpireTime, liveConnectConstraints: a.constraints, httpOptions: { apiVersion } },
        });
        if (tok?.name) return { token: tok.name, apiVersion, lockLevel: a.level, expireTime };
      } catch (e) {
        lastErr = e;
        console.error(`[ai-teacher] token mint failed (${a.level}/${apiVersion}):`, String((e as any)?.message ?? e).slice(0, 300));
      }
    }
  }
  const err: any = new Error("Could not create a voice session token");
  err.cause = lastErr;
  throw err;
}

// ---------------------------------------------------------------- handlers
async function getSubject(subjectId: string) {
  const { data } = await sb.from("popular_subjects").select("id, name").eq("id", subjectId).maybeSingle();
  return data as { id: string; name: string } | null;
}

/** Subjects that have an index, with how many topics each has. */
async function listSubjects() {
  const { data } = await sb.from("topic_routing_cards").select("subject_id");
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.subject_id, (counts.get(r.subject_id) ?? 0) + 1);
  const ids = [...counts.keys()];
  if (!ids.length) return [] as { id: string; name: string; topics: number }[];
  const { data: subs } = await sb.from("popular_subjects").select("id, name").in("id", ids).order("name");
  return (subs ?? []).map((s) => ({ id: s.id, name: String(s.name).trim(), topics: counts.get(s.id) ?? 0 }));
}

async function handleSubjects() {
  return json({ subjects: await listSubjects() });
}

// ---------------------------------------------------------------- syllabus catalog
interface CatTopic { id: string; label: string; title: string }
interface CatChapter { id: string; number: number; title: string; topics: CatTopic[] }
interface CatSubject { id: string; name: string; chapters: CatChapter[] }

const cleanTitle = (s: string) => String(s ?? "").replace(/^[\s:–—-]+/, "").replace(/\s+/g, " ").trim();
/** "31.2" < "31.10"; falls back to plain text compare. */
const naturalCompare = (a: string, b: string) => {
  const pa = String(a).split(".").map((x) => parseInt(x, 10));
  const pb = String(b).split(".").map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    if (Number.isNaN(x) || Number.isNaN(y) || x === undefined || y === undefined) return String(a).localeCompare(String(b));
    if (x !== y) return (x ?? -1) - (y ?? -1);
  }
  return 0;
};

let catalogCache: { at: number; data: CatSubject[] } | null = null;
/** Every indexed subject with its numbered chapters and topics (cached for 10 minutes). */
async function loadCatalog(): Promise<CatSubject[]> {
  if (catalogCache && Date.now() - catalogCache.at < 600_000) return catalogCache.data;
  const subjects = await listSubjects();
  if (!subjects.length) return [];
  const [{ data: cards }, { data: chapters }] = await Promise.all([
    sb.from("topic_routing_cards").select("topic_id"),
    sb.from("subject_chapters").select("id, title, chapter_number, subject_id").in("subject_id", subjects.map((s) => s.id)),
  ]);
  const have = new Set((cards ?? []).map((c) => c.topic_id));
  const { data: topics } = await sb.from("subject_topics").select("id, title, topic_number, chapter_id").in("chapter_id", (chapters ?? []).map((c) => c.id));
  const byChapter = new Map<string, CatTopic[]>();
  for (const t of (topics ?? []).filter((t) => have.has(t.id)).sort((a, b) => naturalCompare(a.topic_number, b.topic_number))) {
    (byChapter.get(t.chapter_id) ?? byChapter.set(t.chapter_id, []).get(t.chapter_id)!).push({ id: t.id, label: String(t.topic_number), title: cleanTitle(t.title) });
  }
  const data: CatSubject[] = subjects.map((s) => ({
    id: s.id,
    name: s.name,
    chapters: (chapters ?? [])
      .filter((c) => c.subject_id === s.id)
      .sort((a, b) => a.chapter_number - b.chapter_number)
      .map((c) => ({ id: c.id, number: c.chapter_number, title: cleanTitle(c.title), topics: byChapter.get(c.id) ?? [] }))
      .filter((c) => c.topics.length),
  }));
  catalogCache = { at: Date.now(), data };
  return data;
}

/** Plain-text syllabus for the teacher's instructions. */
function catalogText(catalog: CatSubject[]): string {
  return catalog
    .map((s) =>
      `== Subject: ${s.name} ==\n` +
      s.chapters.map((c) => `Chapter ${c.number}: ${c.title}\n` + c.topics.map((t) => `  ${t.label} ${t.title}`).join("\n")).join("\n"),
    )
    .join("\n\n");
}

/** "chapter 31 topic 1" / "31 chapter and 1 topic" -> that lesson (chapter only -> its first topic). */
function parseLessonRef(text: string): { chapter: number; topic?: number } | null {
  const ch = text.match(/\bchapter\s*(?:no\.?|number|#)?\s*(\d{1,3})\b/i) || text.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s*chapter\b/i);
  if (!ch) return null;
  const tp = text.match(/\b(?:topic|lesson|section)\s*(?:no\.?|number|#)?\s*(\d{1,3})\b/i) || text.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s*(?:topic|lesson|section)\b/i);
  return { chapter: parseInt(ch[1], 10), topic: tp ? parseInt(tp[1], 10) : undefined };
}

function findLesson(subject: CatSubject, chapterNo: number, topicNo?: number) {
  const chapter = subject.chapters.find((c) => c.number === chapterNo);
  if (!chapter) return null;
  const topic = topicNo === undefined
    ? chapter.topics[0]
    : chapter.topics.find((t) => t.label === `${chapterNo}.${topicNo}`) ?? chapter.topics.find((t) => parseInt(t.label.split(".").pop() ?? "", 10) === topicNo);
  return topic ? { chapter, topic } : null;
}

async function handleOutline(subjectId: string) {
  const subject = (await loadCatalog()).find((s) => s.id === subjectId);
  return json({
    chapters: (subject?.chapters ?? []).map((c) => ({
      id: c.id, number: c.number, title: c.title,
      topics: c.topics.map((t) => ({ id: t.id, label: t.label, title: t.title })),
    })),
  });
}

async function handleSession(ip: string) {
  const cfg = await loadConfig();
  if (!cfg.enabled) return json({ error: "AI Teacher is switched off. An admin can turn it on in Admin > Settings > AI Teacher 1-to-1." }, 503);
  if (!cfg.google_api_key) return json({ error: "AI Teacher has no API key yet. An admin can add one in Admin > Settings > AI Teacher 1-to-1." }, 503);
  if (!(await allow("session", ip))) return json({ error: "Too many voice sessions. Please try again later." }, 429);
  const catalog = await loadCatalog();
  const subjects = catalog.map((s) => ({ id: s.id, name: s.name, topics: s.chapters.reduce((n, c) => n + c.topics.length, 0) }));
  const systemInstruction = voicePrompt(cfg, catalog);
  try {
    const t = await mintLiveToken(cfg, cfg.google_api_key, systemInstruction);
    return json({
      token: t.token, apiVersion: t.apiVersion, lockLevel: t.lockLevel, expireTime: t.expireTime,
      model: cfg.live_model, voiceName: cfg.voice_name, teacherName: cfg.teacher_name,
      systemInstruction, subjects, catalog, tools: LIVE_TOOLS,
    });
  } catch (e) {
    return json({ error: "Voice teacher is temporarily unavailable. Please use chat mode or try again soon." }, 503);
  }
}

async function handleChat(body: any, ip: string) {
  const { subjectId, question, messages, topicId } = body;
  if (!subjectId || !question || typeof question !== "string") return json({ error: "subjectId and question are required" }, 400);
  if (question.length > 1500) return json({ error: "Question is too long" }, 400);
  const cfg = await loadConfig();
  if (!cfg.enabled || !cfg.google_api_key) return json({ error: "AI Teacher is switched off or has no API key. An admin can fix this in Admin > Settings > AI Teacher 1-to-1." }, 503);
  const subject = await getSubject(subjectId);
  if (!subject) return json({ error: "Unknown subject" }, 400);
  if (!(await allow("chat", ip, subjectId))) return json({ error: "Too many questions. Please try again in a while." }, 429);

  // "chapter 31 topic 1" (or a lesson tapped in the list) -> teach that exact topic from its full notes.
  const subjCatalog = (await loadCatalog()).find((x) => x.id === subjectId);
  let lessonTopicId: string | undefined = topicId;
  let lessonNote = "";
  const ref = lessonTopicId ? null : parseLessonRef(question);
  if (ref && subjCatalog) {
    const hit = findLesson(subjCatalog, ref.chapter, ref.topic);
    if (hit) lessonTopicId = hit.topic.id;
    else {
      const first = subjCatalog.chapters[0]?.number;
      const last = subjCatalog.chapters[subjCatalog.chapters.length - 1]?.number;
      lessonNote = `(Chapter ${ref.chapter}${ref.topic ? ` topic ${ref.topic}` : ""} does not exist in ${subject.name}. It has chapters ${first}-${last}.)\n\n`;
    }
  }
  if (lessonTopicId && subjCatalog) {
    for (const c of subjCatalog.chapters) {
      const t = c.topics.find((x) => x.id === lessonTopicId);
      if (t) {
        lessonNote =
          `LESSON REQUESTED: Chapter ${c.number}: ${c.title}, topic ${t.label} ${t.title}.\n` +
          `All topics in this chapter: ${c.topics.map((x) => `${x.label} ${x.title}`).join("; ")}.\n` +
          `The NOTES below are this topic's full notes; teach it clearly, part by part.\n\n`;
        break;
      }
    }
  }

  const r = await retrieve(subjectId, question, lessonTopicId);
  const notes = r.references
    .map((x, i) => `[${i + 1}] ${x.chapter_title ?? ""} > ${x.topic_title ?? ""} > ${x.heading_path}\n${x.content}`)
    .join("\n\n---\n\n");
  const history = (Array.isArray(messages) ? messages : []).slice(-6)
    .filter((m: any) => m && typeof m.content === "string")
    .map((m: any) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content).slice(0, 2000) }] }));
  const userTurn = r.found
    ? `${lessonNote}NOTES:\n${notes}\n\nSTUDENT: ${question}`
    : `${lessonNote}NOTES: (nothing relevant was found in the study material)\n\nSTUDENT: ${question}`;
  try {
    const answer = await geminiGenerate(cfg, chatPrompt(cfg, subject.name), [...history, { role: "user", parts: [{ text: userTurn }] }]);
    return json({ answer, found: r.found, references: r.references, topics: r.topics, documents: r.documents, questions: r.questions });
  } catch (e: any) {
    const status = e?.status === 429 ? 429 : 503;
    return json({ error: status === 429 ? "The teacher is busy. Please try again in a moment." : "The teacher could not answer right now. Please try again." }, status);
  }
}

async function handleTest(req: Request, body: any) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) return json({ error: "Sign in as an admin to run this test." }, 401);
  const { data: isAdmin } = await sb.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "Admins only" }, 403);

  const stored = await loadConfig();
  const cfg: TeacherConfig = {
    ...stored,
    google_api_key: (body.apiKey || stored.google_api_key || "").trim(),
    live_model: (body.liveModel || stored.live_model).trim(),
    chat_model: (body.chatModel || stored.chat_model).trim(),
  };
  if (!cfg.google_api_key) return json({ error: "Enter a Gemini API key first." }, 400);

  const checkModel = async (model: string) => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, { headers: { "x-goog-api-key": cfg.google_api_key } });
    if (r.ok) return { ok: true };
    const b = await r.json().catch(() => ({}));
    return { ok: false, status: r.status, message: String(b?.error?.message ?? "request failed").slice(0, 200) };
  };
  const [chatModel, liveModel] = await Promise.all([checkModel(cfg.chat_model), checkModel(cfg.live_model)]);
  let token_check: any = { ok: false, skipped: true };
  if (liveModel.ok || liveModel.status === 404) {
    try {
      const t = await mintLiveToken(cfg, cfg.google_api_key, voicePrompt(cfg, []));
      token_check = { ok: true, lockLevel: t.lockLevel, apiVersion: t.apiVersion };
    } catch (e) {
      token_check = { ok: false, message: String((e as any)?.cause?.message ?? (e as any)?.message ?? e).slice(0, 200) };
    }
  }
  return json({ chatModel: { model: cfg.chat_model, ...chatModel }, liveModel: { model: cfg.live_model, ...liveModel }, token: token_check });
}

// ---------------------------------------------------------------- entry
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const needSubject = ["outline", "search", "chat"].includes(action);
    if (needSubject && !uuid.test(String(body.subjectId || ""))) return json({ error: "Valid subjectId required" }, 400);
    if (body.topicId && !uuid.test(String(body.topicId))) return json({ error: "Invalid topicId" }, 400);

    switch (action) {
      case "subjects": return await handleSubjects();
      case "outline": return await handleOutline(body.subjectId);
      case "session": return await handleSession(await ipHash(req));
      case "chat": return await handleChat(body, await ipHash(req));
      case "search": {
        const query = String(body.query || "").slice(0, 500).trim();
        if (!query && !body.topicId) return json({ error: "query or topicId required" }, 400);
        if (!(await allow("search", await ipHash(req), body.subjectId))) return json({ error: "Too many requests" }, 429);
        return json(await retrieve(body.subjectId, query, body.topicId));
      }
      case "test": return await handleTest(req, body);
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("[ai-teacher] unhandled", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
