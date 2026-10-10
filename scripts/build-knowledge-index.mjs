#!/usr/bin/env node
/**
 * Build the knowledge index (knowledge_chunks + topic_routing_cards) for one subject.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/build-knowledge-index.mjs \
 *       --subject "Social Science" [--limit 3] [--skip-cards] [--skip-chunks]
 *
 * - Source: published video_generation_jobs -> ai_assistant_documents.full_content markdown
 *   (content_markdown | markdown), heading-based chunks.
 * - Embeddings + routing cards use the OpenRouter key stored in ai_settings
 *   ('ai_api_config'); the key is read into memory only and never printed or written.
 * - Re-runnable: chunks for a document are deleted and re-inserted; cards are upserted.
 */

const REF = "oxwhqvsoelqqsblmqkxx";
const EMBED_MODEL = "openai/text-embedding-3-small";
const EMBED_DIMS = 768;
const CARD_MODEL = "google/gemini-2.5-flash";
const TARGET_MAX = 1400; // chars per chunk (soft max)
const MERGE_BELOW = 250; // sections shorter than this are merged with the following one

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : (args[i + 1]?.startsWith("--") || args[i + 1] === undefined ? true : args[i + 1]); };
const SUBJECT = arg("subject");
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const SKIP_CARDS = !!arg("skip-cards");
const SKIP_CHUNKS = !!arg("skip-chunks");
if (!SUBJECT || SUBJECT === true) { console.error("--subject is required"); process.exit(1); }
if (!process.env.SUPABASE_ACCESS_TOKEN) { console.error("SUPABASE_ACCESS_TOKEN is required"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lit = (s) => "'" + String(s ?? "").replace(/'/g, "''") + "'";

async function sql(query) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.SUPABASE_ACCESS_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (r.ok) return JSON.parse(t);
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * attempt); continue; }
    throw new Error(`SQL ${r.status}: ${t.slice(0, 400)}`);
  }
  throw new Error("SQL failed after retries");
}

// ---------- chunking ----------
function cleanText(s) {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // image tags (incl. base64)
    .replace(/<img[^>]*>/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSections(md) {
  const lines = md.split("\n");
  const stack = []; // [{level,title}]
  const sections = [];
  let cur = { path: "", headLine: "", body: [] };
  const flush = () => {
    const body = cleanText(cur.body.join("\n"));
    if (body.length > 0 || cur.headLine) sections.push({ path: cur.path, headLine: cur.headLine, body });
  };
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (m) {
      flush();
      const level = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: m[2].trim() });
      cur = { path: stack.map((s) => s.title).join(" > "), headLine: line.trim(), body: [] };
    } else cur.body.push(line);
  }
  flush();
  return sections;
}

function splitLong(text, max) {
  if (text.length <= max) return [text];
  const paras = text.split(/\n\s*\n/);
  const out = [];
  let buf = "";
  const push = () => { if (buf.trim()) out.push(buf.trim()); buf = ""; };
  for (const p of paras) {
    if (p.length > max) {
      push();
      // hard split on sentence-ish boundaries
      let rest = p;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(". ", max);
        if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
        if (cut < 1) cut = max;
        out.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1);
      }
      buf = rest;
    } else if ((buf + "\n\n" + p).length > max) { push(); buf = p; }
    else buf = buf ? buf + "\n\n" + p : p;
  }
  push();
  return out;
}

function chunkMarkdown(md) {
  const sections = splitSections(md);
  const chunks = [];
  let pending = null; // merged small sections
  const emit = (path, text) => {
    for (const piece of splitLong(text, TARGET_MAX)) if (piece.replace(/\s/g, "").length >= 30) chunks.push({ path, text: piece });
  };
  for (const s of sections) {
    const text = s.headLine && s.body ? `${s.headLine}\n${s.body}` : s.headLine || s.body;
    if (!text.trim()) continue;
    if (pending) {
      const combined = pending.text + "\n\n" + text;
      if (combined.length <= TARGET_MAX) { pending = { path: pending.path, text: combined, small: combined.length < MERGE_BELOW }; if (!pending.small) { emit(pending.path, pending.text); pending = null; } continue; }
      emit(pending.path, pending.text); pending = null;
    }
    if (text.length < MERGE_BELOW) pending = { path: s.path, text, small: true };
    else emit(s.path, text);
  }
  if (pending) emit(pending.path, pending.text);
  return chunks;
}

// ---------- OpenRouter ----------
let ORKEY;
async function getKey() {
  if (ORKEY) return ORKEY;
  const [row] = await sql("select setting_value->>'openrouter_api_key' as k from ai_settings where setting_key='ai_api_config'");
  if (!row?.k) throw new Error("No OpenRouter key in ai_settings");
  return (ORKEY = row.k);
}

function l2(v) { const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1; return v.map((x) => x / n); }

async function embed(texts) {
  const key = await getKey();
  for (let attempt = 1; attempt <= 5; attempt++) {
    const r = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts, dimensions: EMBED_DIMS }),
    });
    if (r.ok) { const j = await r.json(); return j.data.sort((a, b) => a.index - b.index).map((d) => l2(d.embedding)); }
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * attempt); continue; }
    throw new Error(`embed ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  throw new Error("embed failed after retries");
}

async function chat(prompt) {
  const key = await getKey();
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model: CARD_MODEL, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
    });
    if (r.ok) { const j = await r.json(); return j.choices?.[0]?.message?.content || ""; }
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * attempt); continue; }
    throw new Error(`chat ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  throw new Error("chat failed after retries");
}

const vecLit = (v) => `'[${v.map((x) => +x.toFixed(6)).join(",")}]'::vector`;

// ---------- main ----------
const [subj] = await sql(`select id, name from popular_subjects where name = ${lit(SUBJECT)}`);
if (!subj) throw new Error(`Subject not found: ${SUBJECT}`);

// One published job per document (latest), with markdown pulled server-side.
const docs = await sql(`
  select d.id as document_id, d.chapter_id, d.topic_id, j.job_id,
         c.title as chapter_title, t.title as topic_title,
         coalesce(nullif(d.full_content->>'content_markdown',''), d.full_content->>'markdown') as md
  from ai_assistant_documents d
  join lateral (
    select v.id as job_id from video_generation_jobs v
    where v.document_id = d.id and v.is_published = true and v.status = 'completed'
    order by v.created_at desc limit 1
  ) j on true
  left join subject_chapters c on c.id = d.chapter_id
  left join subject_topics   t on t.id = d.topic_id
  where d.subject_id = ${lit(subj.id)}
  order by c.chapter_number nulls last, t.topic_number nulls last, d.id
`);
const work = docs.filter((d) => d.md && d.md.trim()).slice(0, LIMIT);
console.log(`Subject ${subj.name}: ${docs.length} published docs, processing ${work.length}`);

let totalChunks = 0, totalChars = 0;
if (!SKIP_CHUNKS) {
  for (let i = 0; i < work.length; i++) {
    const d = work[i];
    const chunks = chunkMarkdown(d.md);
    if (!chunks.length) { console.log(`  [${i + 1}/${work.length}] ${d.topic_title}: 0 chunks (skipped)`); continue; }
    const vectors = [];
    for (let b = 0; b < chunks.length; b += 64) {
      const batch = chunks.slice(b, b + 64).map((c) => `${c.path}\n${c.text}`.slice(0, 6000));
      vectors.push(...(await embed(batch)));
    }
    // replace this document's chunks atomically
    const values = chunks.map((c, idx) =>
      `(${lit(subj.id)}, ${d.chapter_id ? lit(d.chapter_id) : "null"}, ${d.topic_id ? lit(d.topic_id) : "null"}, ${lit(d.document_id)}, ${lit(d.job_id)}, ${idx}, ${lit(c.path)}, ${lit(c.text)}, ${Math.ceil(c.text.length / 4)}, ${vecLit(vectors[idx])})`
    );
    for (let s = 0; s < values.length; s += 25) {
      const part = values.slice(s, s + 25);
      const del = s === 0 ? `delete from knowledge_chunks where document_id = ${lit(d.document_id)};` : "";
      await sql(`${del} insert into knowledge_chunks (subject_id, chapter_id, topic_id, document_id, job_id, chunk_index, heading_path, content, token_estimate, embedding) values ${part.join(",")};`);
    }
    totalChunks += chunks.length; totalChars += chunks.reduce((a, c) => a + c.text.length, 0);
    console.log(`  [${i + 1}/${work.length}] ${d.chapter_title ?? "?"} > ${d.topic_title ?? "?"}: ${chunks.length} chunks`);
  }
  console.log(`Chunks written: ${totalChunks} (avg ${Math.round(totalChars / Math.max(1, totalChunks))} chars)`);
}

if (!SKIP_CARDS) {
  let n = 0;
  for (const d of work) {
    if (!d.topic_id) continue;
    n++;
    const excerpt = d.md.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").slice(0, 7000);
    let card;
    try {
      const raw = await chat(
        `You are indexing study notes for a student Q&A search system.\nSubject: ${subj.name}\nChapter: ${d.chapter_title}\nTopic: ${d.topic_title}\n\nNOTES (may be truncated):\n${excerpt}\n\nReturn ONLY JSON: {"summary": "2 plain sentences on what this topic covers", "keywords": ["8-15 key terms, names, dates from the notes"], "sample_questions": ["6-10 questions a student might ask that these notes answer, in simple English"]}`
      );
      card = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
    } catch (e) { console.log(`  card failed for ${d.topic_title}: ${e.message}`); continue; }
    const keywords = (card.keywords || []).map(String).slice(0, 20);
    const qs = (card.sample_questions || []).map(String).slice(0, 12);
    const summary = String(card.summary || "").slice(0, 600);
    const [vec] = await embed([`${d.chapter_title} > ${d.topic_title}\n${summary}\n${keywords.join(", ")}\n${qs.join("\n")}`]);
    const arr = (a) => `array[${a.map(lit).join(",")}]::text[]`;
    await sql(`insert into topic_routing_cards (topic_id, subject_id, chapter_id, chapter_title, topic_title, summary, keywords, sample_questions, embedding, updated_at)
      values (${lit(d.topic_id)}, ${lit(subj.id)}, ${d.chapter_id ? lit(d.chapter_id) : "null"}, ${lit(d.chapter_title)}, ${lit(d.topic_title)}, ${lit(summary)}, ${arr(keywords)}, ${arr(qs)}, ${vecLit(vec)}, now())
      on conflict (topic_id) do update set summary = excluded.summary, keywords = excluded.keywords, sample_questions = excluded.sample_questions,
        chapter_title = excluded.chapter_title, topic_title = excluded.topic_title, embedding = excluded.embedding, updated_at = now();`);
    console.log(`  card ${n}: ${d.topic_title}`);
  }
  console.log(`Routing cards written: ${n}`);
}
console.log("Done.");
