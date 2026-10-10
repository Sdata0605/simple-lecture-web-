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
  chat_model: "gemini-flash-latest",
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
    chat_model: clean(v.chat_model, DEFAULT_CONFIG.chat_model),
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
function voicePrompt(cfg: TeacherConfig, subject: string) {
  return `You are ${cfg.teacher_name}, a warm, patient one-to-one school teacher teaching the subject "${subject}" to a student over a live voice call.

HOW TO TEACH
- Speak naturally in short turns (2 to 4 sentences), then pause so the student can respond. Never read out symbols, markdown, URLs or tool names.
- Reply in the language the student speaks (English, Hindi or Kannada). Default to simple English.
- Before explaining anything or answering a subject question, ALWAYS call the tool search_notes with the student's topic or question, and teach ONLY from the notes it returns. If the notes do not cover it, say so honestly and suggest a related topic.
- While explaining, call present_slide to put a short title and 3 to 5 bullet points on the student's board.
- After you finish explaining an idea, check understanding by calling show_quiz with ONE multiple-choice question (4 options, exactly one correct) based on the notes, then wait. The system will tell you which option the student chose; react kindly, explain why, and move on.
- Encourage the student. Correct mistakes gently. Keep the lesson interactive: ask what they want to learn next when a topic is done.
- If the student says hello, greet them briefly in one sentence and ask what they want to learn today.`;
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
async function geminiGenerate(cfg: TeacherConfig, system: string, contents: any[]) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.chat_model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": cfg.google_api_key, "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("[ai-teacher] generateContent failed", r.status, JSON.stringify(body).slice(0, 400));
    const e: any = new Error("AI request failed");
    e.status = r.status;
    throw e;
  }
  const text = (body.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Empty AI response");
  return text;
}

async function mintLiveToken(cfg: TeacherConfig, apiKey: string, systemInstruction: string) {
  const now = Date.now();
  const expireTime = new Date(now + 20 * 60_000).toISOString();
  const newSessionExpireTime = new Date(now + 90_000).toISOString();
  const attempts: { level: string; versions: string[]; constraints: any }[] = [
    {
      level: "locked",
      versions: ["v1alpha", "v1beta"],
      constraints: {
        model: cfg.live_model,
        config: {
          responseModalities: ["AUDIO"],
          systemInstruction,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice_name } } },
        },
      },
    },
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

async function handleSubjects() {
  const { data } = await sb.from("topic_routing_cards").select("subject_id");
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.subject_id, (counts.get(r.subject_id) ?? 0) + 1);
  const ids = [...counts.keys()];
  if (!ids.length) return json({ subjects: [] });
  const { data: subs } = await sb.from("popular_subjects").select("id, name").in("id", ids).order("name");
  return json({ subjects: (subs ?? []).map((s) => ({ id: s.id, name: s.name, topics: counts.get(s.id) ?? 0 })) });
}

async function handleOutline(subjectId: string) {
  const [{ data: cards }, { data: chapters }, { data: topics }] = await Promise.all([
    sb.from("topic_routing_cards").select("topic_id").eq("subject_id", subjectId),
    sb.from("subject_chapters").select("id, title, chapter_number").eq("subject_id", subjectId).order("chapter_number"),
    sb.from("subject_topics").select("id, title, topic_number, chapter_id"),
  ]);
  const have = new Set((cards ?? []).map((c) => c.topic_id));
  const chIds = new Set((chapters ?? []).map((c) => c.id));
  const byChapter = new Map<string, any[]>();
  for (const t of (topics ?? []).filter((t) => have.has(t.id) && chIds.has(t.chapter_id)).sort((a, b) => a.topic_number - b.topic_number)) {
    (byChapter.get(t.chapter_id) ?? byChapter.set(t.chapter_id, []).get(t.chapter_id)!).push({ id: t.id, title: t.title });
  }
  const outline = (chapters ?? [])
    .map((c) => ({ id: c.id, title: c.title, topics: byChapter.get(c.id) ?? [] }))
    .filter((c) => c.topics.length);
  return json({ chapters: outline });
}

async function handleSession(subjectId: string, ip: string) {
  const cfg = await loadConfig();
  if (!cfg.enabled || !cfg.google_api_key) return json({ error: "AI Teacher voice is not available right now." }, 503);
  const subject = await getSubject(subjectId);
  if (!subject) return json({ error: "Unknown subject" }, 400);
  if (!(await allow("session", ip, subjectId))) return json({ error: "Too many voice sessions. Please try again later." }, 429);
  const systemInstruction = voicePrompt(cfg, subject.name);
  try {
    const t = await mintLiveToken(cfg, cfg.google_api_key, systemInstruction);
    return json({
      token: t.token, apiVersion: t.apiVersion, lockLevel: t.lockLevel, expireTime: t.expireTime,
      model: cfg.live_model, voiceName: cfg.voice_name, teacherName: cfg.teacher_name,
      systemInstruction, subject,
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
  if (!cfg.enabled || !cfg.google_api_key) return json({ error: "AI Teacher is not available right now." }, 503);
  const subject = await getSubject(subjectId);
  if (!subject) return json({ error: "Unknown subject" }, 400);
  if (!(await allow("chat", ip, subjectId))) return json({ error: "Too many questions. Please try again in a while." }, 429);

  const r = await retrieve(subjectId, question, topicId);
  const notes = r.references
    .map((x, i) => `[${i + 1}] ${x.chapter_title ?? ""} > ${x.topic_title ?? ""} > ${x.heading_path}\n${x.content}`)
    .join("\n\n---\n\n");
  const history = (Array.isArray(messages) ? messages : []).slice(-6)
    .filter((m: any) => m && typeof m.content === "string")
    .map((m: any) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content).slice(0, 2000) }] }));
  const userTurn = r.found
    ? `NOTES:\n${notes}\n\nSTUDENT: ${question}`
    : `NOTES: (nothing relevant was found in the study material)\n\nSTUDENT: ${question}`;
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
      const t = await mintLiveToken(cfg, cfg.google_api_key, voicePrompt(cfg, "Test"));
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
    const needSubject = ["outline", "session", "search", "chat"].includes(action);
    if (needSubject && !uuid.test(String(body.subjectId || ""))) return json({ error: "Valid subjectId required" }, 400);
    if (body.topicId && !uuid.test(String(body.topicId))) return json({ error: "Invalid topicId" }, 400);

    switch (action) {
      case "subjects": return await handleSubjects();
      case "outline": return await handleOutline(body.subjectId);
      case "session": return await handleSession(body.subjectId, await ipHash(req));
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
