// Keeps the AI Teacher knowledge index (knowledge_chunks + topic_routing_cards) in step with what is
// published. The AI Teacher only offers subjects that have routing cards, so a subject whose published
// lectures were never indexed is invisible to the teacher on the website and in the mobile app.
//
// Admin only (Bearer JWT of a user with the "admin" role). POST { action, ... }
//   index_document { document_id | job_id, force? }  -> index one published lecture (called right after publishing)
//   remove_document { document_id | job_id }         -> drop its index once no published job remains (after unpublishing)
//   index_subject  { subject_id, max_docs?, force?, exclude_ids? }
//                                                    -> index pending lectures of one subject, time-boxed. Call again
//                                                       while `remaining` > 0, passing back every id in `attempted` as
//                                                       exclude_ids. Also prunes entries of lectures no longer published.
//   coverage       {}                                -> per subject: published vs indexed lectures
//
// Source of truth: the document's markdown (ai_assistant_documents.full_content.content_markdown | markdown) of
// every document that has a published, completed video_generation_jobs row. Same rules as
// scripts/build-knowledge-index.mjs, which shares _shared/knowledgeIndex.ts with this function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  chunkEmbedText,
  chunkMarkdown,
  cardEmbedText,
  embedTexts,
  makeRoutingCard,
  vecLiteral,
} from "../_shared/knowledgeIndex.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MD_SELECT = "md:full_content->>content_markdown, md2:full_content->>markdown";
const HAS_MD = "full_content->>content_markdown.neq.,full_content->>markdown.neq.";
const TIME_BUDGET_MS = 90_000; // stop starting new documents after this; the platform limit is higher

// ---------------------------------------------------------------- helpers
async function requireAdmin(req: Request): Promise<Response | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) return json({ error: "Sign in as an admin." }, 401);
  const { data: isAdmin } = await sb.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "Admins only" }, 403);
  return null;
}

/** Reads every row of a paged query (PostgREST caps a response at 1000 rows). */
async function all<T = any>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message || String(error));
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** Runs `fn` over ids in URL-safe batches and concatenates the results. */
async function inBatches<T = any>(ids: string[], fn: (batch: string[]) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await fn(ids.slice(i, i + 100));
    if (error) throw new Error(error.message || String(error));
    out.push(...(data ?? []));
  }
  return out;
}

async function openRouterKey(): Promise<string> {
  const { data } = await sb.from("ai_settings").select("setting_value").eq("setting_key", "ai_api_config").maybeSingle();
  const key = (data?.setting_value as any)?.openrouter_api_key;
  if (!key) throw new Error("No OpenRouter key configured in ai_settings (ai_api_config)");
  return key;
}

/** Latest published+completed job id per document id. */
async function publishedJobs(documentIds?: string[]): Promise<Map<string, string>> {
  const rows = documentIds
    ? await inBatches(documentIds, (b) =>
        sb.from("video_generation_jobs").select("id, document_id, created_at").in("document_id", b).eq("is_published", true).eq("status", "completed"))
    : await all((f, t) =>
        sb.from("video_generation_jobs").select("id, document_id, created_at").eq("is_published", true).eq("status", "completed").not("document_id", "is", null).order("id").range(f, t));
  const latest = new Map<string, { id: string; at: string }>();
  for (const r of rows) {
    const cur = latest.get(r.document_id);
    if (!cur || String(r.created_at) > cur.at) latest.set(r.document_id, { id: r.id, at: String(r.created_at) });
  }
  return new Map([...latest].map(([doc, v]) => [doc, v.id]));
}

async function resolveDocumentId(body: any): Promise<string | null> {
  if (UUID.test(String(body.document_id || ""))) return body.document_id;
  if (UUID.test(String(body.job_id || ""))) {
    const { data } = await sb.from("video_generation_jobs").select("document_id").eq("id", body.job_id).maybeSingle();
    return data?.document_id ?? null;
  }
  return null;
}

// ---------------------------------------------------------------- indexing one document
type DocResult = { document_id: string; status: "indexed" | "unchanged" | "skipped"; chunks?: number; card?: boolean; reason?: string };

async function writeCard(apiKey: string, doc: any, subjectName: string, md: string) {
  const [{ data: ch }, { data: tp }] = await Promise.all([
    doc.chapter_id ? sb.from("subject_chapters").select("title").eq("id", doc.chapter_id).maybeSingle() : Promise.resolve({ data: null as any }),
    sb.from("subject_topics").select("title").eq("id", doc.topic_id).maybeSingle(),
  ]);
  const chapterTitle = ch?.title ?? null;
  const topicTitle = tp?.title ?? null;
  const card = await makeRoutingCard(apiKey, { subject: subjectName, chapter: chapterTitle, topic: topicTitle, markdown: md });
  const [vec] = await embedTexts(apiKey, [cardEmbedText(chapterTitle, topicTitle, card)]);
  const { error } = await sb.from("topic_routing_cards").upsert(
    {
      topic_id: doc.topic_id,
      subject_id: doc.subject_id,
      chapter_id: doc.chapter_id,
      chapter_title: chapterTitle,
      topic_title: topicTitle,
      summary: card.summary,
      keywords: card.keywords,
      sample_questions: card.sample_questions,
      embedding: vecLiteral(vec),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "topic_id" },
  );
  if (error) throw new Error("card upsert: " + error.message);
}

async function indexDocument(documentId: string, opts: { force?: boolean; apiKey?: string } = {}): Promise<DocResult> {
  const { data: doc, error } = await sb
    .from("ai_assistant_documents")
    .select(`id, subject_id, topic_id, chapter_id, ${MD_SELECT}`)
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) return { document_id: documentId, status: "skipped", reason: "document not found" };

  const jobId = (await publishedJobs([documentId])).get(documentId);
  if (!jobId) return { document_id: documentId, status: "skipped", reason: "no published, completed job" };

  const md: string = (doc as any).md?.trim() ? (doc as any).md : (doc as any).md2 ?? "";
  if (!md.trim()) return { document_id: documentId, status: "skipped", reason: "document has no markdown" };
  const chunks = chunkMarkdown(md);
  if (!chunks.length) return { document_id: documentId, status: "skipped", reason: "markdown produced no chunks" };

  const apiKey = opts.apiKey ?? (await openRouterKey());
  const { data: subj } = await sb.from("popular_subjects").select("name").eq("id", doc.subject_id).maybeSingle();
  const subjectName = subj?.name ?? "";

  // Unchanged content: skip the (paid) embedding calls, only make sure the topic has its card.
  const { data: existing } = await sb.from("knowledge_chunks").select("heading_path, content").eq("document_id", documentId).order("chunk_index");
  const unchanged = !opts.force && existing?.length === chunks.length &&
    existing.every((e: any, i: number) => e.heading_path === chunks[i].path && e.content === chunks[i].text);

  let cardOk = false;
  if (doc.topic_id) {
    const { data: card } = await sb.from("topic_routing_cards").select("topic_id").eq("topic_id", doc.topic_id).maybeSingle();
    cardOk = !!card;
  }

  if (unchanged) {
    if (doc.topic_id && !cardOk) { await writeCard(apiKey, doc, subjectName, md); return { document_id: documentId, status: "indexed", chunks: chunks.length, card: true, reason: "card was missing" }; }
    return { document_id: documentId, status: "unchanged", chunks: chunks.length, card: cardOk };
  }

  const vectors = await embedTexts(apiKey, chunks.map(chunkEmbedText));
  const rows = chunks.map((c, i) => ({
    subject_id: doc.subject_id,
    chapter_id: doc.chapter_id,
    topic_id: doc.topic_id,
    document_id: documentId,
    job_id: jobId,
    chunk_index: i,
    heading_path: c.path,
    content: c.text,
    token_estimate: Math.ceil(c.text.length / 4),
    embedding: vecLiteral(vectors[i]),
  }));
  // Replace this document's chunks (embeddings are already computed, so the gap with no rows is short).
  const del = await sb.from("knowledge_chunks").delete().eq("document_id", documentId);
  if (del.error) throw new Error("delete chunks: " + del.error.message);
  for (let i = 0; i < rows.length; i += 25) {
    const ins = await sb.from("knowledge_chunks").insert(rows.slice(i, i + 25));
    if (ins.error) throw new Error("insert chunks: " + ins.error.message);
  }

  let cardWritten = false;
  if (doc.topic_id) { await writeCard(apiKey, doc, subjectName, md); cardWritten = true; }
  return { document_id: documentId, status: "indexed", chunks: chunks.length, card: cardWritten };
}

/** Deletes a document's chunks (and its topic card if the topic has no chunks left). */
async function dropDocumentIndex(documentId: string, topicId: string | null) {
  await sb.from("knowledge_chunks").delete().eq("document_id", documentId);
  if (topicId) {
    const { count } = await sb.from("knowledge_chunks").select("id", { count: "exact", head: true }).eq("topic_id", topicId);
    if (!count) await sb.from("topic_routing_cards").delete().eq("topic_id", topicId);
  }
}

// ---------------------------------------------------------------- subject-level view
interface SubjectState {
  eligible: { id: string; topic_id: string | null }[]; // published + has markdown
  indexedDocIds: Set<string>;                           // documents that have chunks
  cardTopicIds: Set<string>;
  stale: { id: string; topic_id: string | null }[];     // indexed, but no longer published
}

async function subjectState(subjectId: string): Promise<SubjectState> {
  const docs = await all((f, t) => sb.from("ai_assistant_documents").select("id, topic_id").eq("subject_id", subjectId).order("id").range(f, t));
  const withMd = new Set((await all((f, t) => sb.from("ai_assistant_documents").select("id").eq("subject_id", subjectId).or(HAS_MD).order("id").range(f, t))).map((d) => d.id));
  const published = await publishedJobs(docs.map((d) => d.id));
  const indexedRows = await all((f, t) => sb.from("knowledge_chunks").select("document_id").eq("subject_id", subjectId).eq("chunk_index", 0).order("document_id").range(f, t));
  const cards = await all((f, t) => sb.from("topic_routing_cards").select("topic_id").eq("subject_id", subjectId).order("topic_id").range(f, t));
  const indexedDocIds = new Set(indexedRows.map((r) => r.document_id as string));
  const eligible = docs.filter((d) => withMd.has(d.id) && published.has(d.id));
  const eligibleIds = new Set(eligible.map((d) => d.id));
  const topicOf = new Map(docs.map((d) => [d.id, d.topic_id as string | null]));
  const stale = [...indexedDocIds].filter((id) => !eligibleIds.has(id)).map((id) => ({ id, topic_id: topicOf.get(id) ?? null }));
  return { eligible, indexedDocIds, cardTopicIds: new Set(cards.map((c) => c.topic_id as string)), stale };
}

const isPending = (s: SubjectState, d: { id: string; topic_id: string | null }) =>
  !s.indexedDocIds.has(d.id) || (!!d.topic_id && !s.cardTopicIds.has(d.topic_id));

async function handleIndexSubject(body: any) {
  const subjectId = String(body.subject_id || "");
  if (!UUID.test(subjectId)) return json({ error: "Valid subject_id required" }, 400);
  const maxDocs = Math.min(Math.max(parseInt(body.max_docs, 10) || 8, 1), 25);
  const force = !!body.force;
  const started = Date.now();

  const state = await subjectState(subjectId);
  let pruned = 0;
  for (const s of state.stale) { await dropDocumentIndex(s.id, s.topic_id); pruned++; }

  // The caller loops until `remaining` is 0 and passes back every id it has already attempted, so a document
  // that fails or is skipped is reported once and never blocks the ones behind it.
  const exclude = new Set<string>(Array.isArray(body.exclude_ids) ? body.exclude_ids.map(String) : []);
  const queue = state.eligible.filter((d) => !exclude.has(d.id) && (force || isPending(state, d)));
  const apiKey = queue.length ? await openRouterKey() : "";
  const results: DocResult[] = [];
  const failed: { document_id: string; error: string }[] = [];
  const attempted: string[] = [];
  for (const d of queue) {
    if (attempted.length >= maxDocs || Date.now() - started > TIME_BUDGET_MS) break;
    attempted.push(d.id);
    try {
      results.push(await indexDocument(d.id, { force, apiKey }));
    } catch (e) {
      console.error("[ai-teacher-index] index failed", d.id, e);
      failed.push({ document_id: d.id, error: String((e as any)?.message ?? e).slice(0, 300) });
    }
  }
  return json({
    ok: true,
    subject_id: subjectId,
    eligible: state.eligible.length,
    attempted,
    indexed: results.filter((r) => r.status === "indexed").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    skipped: results.filter((r) => r.status === "skipped").map((r) => ({ document_id: r.document_id, reason: r.reason })),
    failed,
    pruned,
    remaining: queue.length - attempted.length,
  });
}

async function handleCoverage() {
  const [subjects, docs, withMdRows, published, indexedRows, cards, links] = await Promise.all([
    all((f, t) => sb.from("popular_subjects").select("id, name").order("id").range(f, t)),
    all((f, t) => sb.from("ai_assistant_documents").select("id, subject_id, topic_id").order("id").range(f, t)),
    all((f, t) => sb.from("ai_assistant_documents").select("id").or(HAS_MD).order("id").range(f, t)),
    publishedJobs(),
    all((f, t) => sb.from("knowledge_chunks").select("document_id, subject_id").eq("chunk_index", 0).order("document_id").range(f, t)),
    all((f, t) => sb.from("topic_routing_cards").select("topic_id, subject_id").order("topic_id").range(f, t)),
    all((f, t) => sb.from("course_subjects").select("subject_id, courses(name)").order("id").range(f, t)),
  ]);
  const withMd = new Set(withMdRows.map((d) => d.id));
  const indexed = new Set(indexedRows.map((r) => r.document_id as string));
  const cardTopics = new Set(cards.map((c) => c.topic_id as string));
  const cardsBySubject = new Map<string, number>();
  for (const c of cards) cardsBySubject.set(c.subject_id, (cardsBySubject.get(c.subject_id) ?? 0) + 1);
  const coursesBySubject = new Map<string, Set<string>>();
  for (const l of links as any[]) {
    const name = Array.isArray(l.courses) ? l.courses[0]?.name : l.courses?.name;
    if (name) (coursesBySubject.get(l.subject_id) ?? coursesBySubject.set(l.subject_id, new Set()).get(l.subject_id)!).add(name);
  }

  const by = new Map<string, { eligible: number; indexed: number; pending: number; unpublished_with_markdown: number; stale: number }>();
  const slot = (id: string) => by.get(id) ?? by.set(id, { eligible: 0, indexed: 0, pending: 0, unpublished_with_markdown: 0, stale: 0 }).get(id)!;
  for (const d of docs) {
    const s = slot(d.subject_id);
    const isEligible = withMd.has(d.id) && published.has(d.id);
    if (isEligible) {
      s.eligible++;
      if (indexed.has(d.id)) s.indexed++;
      if (!indexed.has(d.id) || (d.topic_id && !cardTopics.has(d.topic_id))) s.pending++;
    } else {
      if (withMd.has(d.id)) s.unpublished_with_markdown++;
      if (indexed.has(d.id)) s.stale++;
    }
  }
  const nameOf = new Map(subjects.map((s) => [s.id, String(s.name).trim()]));
  const list = [...by].map(([id, v]) => ({
    subject_id: id,
    name: nameOf.get(id) ?? id,
    courses: [...(coursesBySubject.get(id) ?? [])].sort(),
    topics_indexed: cardsBySubject.get(id) ?? 0,
    ...v,
  })).filter((s) => s.eligible > 0 || s.indexed > 0 || s.topics_indexed > 0 || s.unpublished_with_markdown > 0);
  list.sort((a, b) => a.name.localeCompare(b.name));
  return json({ subjects: list });
}

// ---------------------------------------------------------------- entry
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const denied = await requireAdmin(req);
    if (denied) return denied;
    const body = await req.json().catch(() => ({}));
    switch (String(body.action || "")) {
      case "index_document": {
        const id = await resolveDocumentId(body);
        if (!id) return json({ error: "document_id or job_id required" }, 400);
        return json({ ok: true, ...(await indexDocument(id, { force: !!body.force })) });
      }
      case "remove_document": {
        const id = await resolveDocumentId(body);
        if (!id) return json({ error: "document_id or job_id required" }, 400);
        if ((await publishedJobs([id])).has(id)) return json({ ok: true, status: "kept", reason: "another published job still exists" });
        const { data: doc } = await sb.from("ai_assistant_documents").select("topic_id").eq("id", id).maybeSingle();
        await dropDocumentIndex(id, doc?.topic_id ?? null);
        return json({ ok: true, status: "removed" });
      }
      case "index_subject": return await handleIndexSubject(body);
      case "coverage": return await handleCoverage();
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("[ai-teacher-index] unhandled", e);
    return json({ error: String((e as any)?.message ?? e).slice(0, 300) }, 500);
  }
});
