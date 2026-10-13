#!/usr/bin/env node
/**
 * Build the knowledge index (knowledge_chunks + topic_routing_cards) so the AI Teacher can teach a subject.
 * The AI Teacher only offers subjects that have routing cards, so every subject must be indexed once.
 * New publishes are indexed automatically by the ai-teacher-index edge function; this script is for backfills.
 *
 * Usage (Node >= 22.18; the token needs database read + write permission):
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/build-knowledge-index.mjs --all --dry-run
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/build-knowledge-index.mjs --all
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/build-knowledge-index.mjs --course "SSLC"
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/build-knowledge-index.mjs --subject "Science" --subject "Maths" [--limit 3]
 *
 *   --subject NAME   a subject (case-insensitive, repeatable)
 *   --course TEXT    every subject linked to a course whose name contains TEXT (repeatable)
 *   --all            every subject that has at least one published lecture
 *   --dry-run        only report what would be indexed (no embeddings, no writes, no paid calls)
 *   --force          re-embed documents even when their indexed content is identical
 *   --limit N        at most N documents per subject
 *   --skip-cards / --skip-chunks
 *
 * - Source: published video_generation_jobs -> ai_assistant_documents.full_content markdown
 *   (content_markdown | markdown), heading-based chunks (shared with the edge function).
 * - Embeddings + routing cards use the OpenRouter key stored in ai_settings
 *   ('ai_api_config'); the key is read into memory only and never printed or written.
 * - Re-runnable: unchanged documents are skipped; changed ones have their chunks deleted and re-inserted;
 *   cards are upserted.
 */

import {
  EMBED_DIMS,
  chunkEmbedText,
  chunkMarkdown,
  cardEmbedText,
  embedTexts,
  makeRoutingCard,
  vecLiteral,
} from "../supabase/functions/_shared/knowledgeIndex.ts";

const REF = "oxwhqvsoelqqsblmqkxx";

const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const values = (n) => args.flatMap((a, i) => (a === "--" + n && args[i + 1] && !args[i + 1].startsWith("--") ? [args[i + 1]] : []));
const SUBJECTS = values("subject");
const COURSES = values("course");
const ALL = flag("all");
const DRY = flag("dry-run");
const FORCE = flag("force");
const LIMIT = values("limit")[0] ? Number(values("limit")[0]) : Infinity;
const SKIP_CARDS = flag("skip-cards");
const SKIP_CHUNKS = flag("skip-chunks");
if (!ALL && !SUBJECTS.length && !COURSES.length) { console.error("Choose what to index: --all, --course TEXT or --subject NAME (add --dry-run to preview)"); process.exit(1); }
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

// ---------- OpenRouter key (read into memory only) ----------
let ORKEY;
async function getKey() {
  if (ORKEY) return ORKEY;
  const [row] = await sql("select setting_value->>'openrouter_api_key' as k from ai_settings where setting_key='ai_api_config'");
  if (!row?.k) throw new Error("No OpenRouter key in ai_settings");
  return (ORKEY = row.k);
}

// ---------- which subjects ----------
const PUBLISHED_DOC = `exists (select 1 from ai_assistant_documents d join video_generation_jobs v on v.document_id = d.id
  where d.subject_id = s.id and v.is_published = true and v.status = 'completed')`;
const conds = [];
if (!ALL) {
  const parts = [];
  if (SUBJECTS.length) parts.push(`lower(trim(s.name)) in (${SUBJECTS.map((n) => lit(n.trim().toLowerCase())).join(",")})`);
  if (COURSES.length) parts.push(`exists (select 1 from course_subjects cs join courses c on c.id = cs.course_id where cs.subject_id = s.id and (${COURSES.map((c) => `c.name ilike ${lit("%" + c + "%")}`).join(" or ")}))`);
  conds.push(`(${parts.join(" or ")})`);
}
const subjects = await sql(`
  select s.id, trim(s.name) as name,
         (select string_agg(distinct c.name, '; ') from course_subjects cs join courses c on c.id = cs.course_id where cs.subject_id = s.id) as courses,
         ${PUBLISHED_DOC} as has_published
  from popular_subjects s
  ${conds.length ? "where " + conds.join(" and ") : ""}
  order by s.name`);
for (const n of SUBJECTS) if (!subjects.some((s) => s.name.toLowerCase() === n.trim().toLowerCase())) console.warn(`  ! subject not found: ${n}`);
if (!subjects.length) { console.error("No matching subjects."); process.exit(1); }

// One published job per document (latest), with markdown pulled server-side.
const docsFor = (subjectId) => sql(`
  select d.id as document_id, d.chapter_id, d.topic_id, j.job_id,
         c.title as chapter_title, t.title as topic_title,
         coalesce(nullif(d.full_content->>'content_markdown',''), d.full_content->>'markdown') as md,
         (select count(*)::int from knowledge_chunks k where k.document_id = d.id and k.chunk_index = 0) as indexed,
         (select count(*)::int from topic_routing_cards r where r.topic_id = d.topic_id) as has_card
  from ai_assistant_documents d
  join lateral (
    select v.id as job_id from video_generation_jobs v
    where v.document_id = d.id and v.is_published = true and v.status = 'completed'
    order by v.created_at desc limit 1
  ) j on true
  left join subject_chapters c on c.id = d.chapter_id
  left join subject_topics   t on t.id = d.topic_id
  where d.subject_id = ${lit(subjectId)}
  order by c.chapter_number nulls last, t.topic_number nulls last, d.id
`);

const unpublishedWithMd = (subjectId) => sql(`
  select count(*)::int as n from ai_assistant_documents d
  where d.subject_id = ${lit(subjectId)}
    and coalesce(nullif(d.full_content->>'content_markdown',''), d.full_content->>'markdown') is not null
    and not exists (select 1 from video_generation_jobs v where v.document_id = d.id and v.is_published = true and v.status = 'completed')`);

// ---------- dry run ----------
if (DRY) {
  console.log("Dry run: nothing is written and no paid API is called.\n");
  let pendingTotal = 0;
  for (const s of subjects) {
    const docs = (await docsFor(s.id)).filter((d) => d.md && d.md.trim());
    const pending = docs.filter((d) => !d.indexed || (d.topic_id && !d.has_card));
    const [{ n: unpublished }] = await unpublishedWithMd(s.id);
    pendingTotal += pending.length;
    console.log(`${s.name.padEnd(34)} published=${String(docs.length).padStart(3)}  indexed=${String(docs.length - pending.length).padStart(3)}  pending=${String(pending.length).padStart(3)}  unpublished-with-markdown=${unpublished}  [${s.courses ?? "no course"}]`);
  }
  console.log(`\nPending documents: ${pendingTotal}. Unpublished lectures are never indexed; publishing them indexes them automatically.`);
  process.exit(0);
}

// ---------- index ----------
const arr = (a) => `array[${a.map(lit).join(",")}]::text[]`;
let grand = { docs: 0, unchanged: 0, chunks: 0, cards: 0, failed: 0 };

for (const subj of subjects) {
  const docs = await docsFor(subj.id);
  const work = docs.filter((d) => d.md && d.md.trim()).slice(0, LIMIT);
  console.log(`\nSubject ${subj.name}: ${docs.length} published docs, processing ${work.length}`);
  if (!work.length) continue;

  for (let i = 0; i < work.length; i++) {
    const d = work[i];
    const label = `[${i + 1}/${work.length}] ${d.chapter_title ?? "?"} > ${d.topic_title ?? "?"}`;
    try {
      const chunks = chunkMarkdown(d.md);
      if (!chunks.length) { console.log(`  ${label}: 0 chunks (skipped)`); continue; }

      // Same content already indexed -> no paid calls (unless --force).
      let unchanged = false;
      if (!FORCE && d.indexed) {
        const existing = await sql(`select heading_path, content from knowledge_chunks where document_id = ${lit(d.document_id)} order by chunk_index`);
        unchanged = existing.length === chunks.length && existing.every((e, k) => e.heading_path === chunks[k].path && e.content === chunks[k].text);
      }

      if (!SKIP_CHUNKS && !unchanged) {
        const vectors = await embedTexts(await getKey(), chunks.map(chunkEmbedText));
        // replace this document's chunks
        const values = chunks.map((c, idx) =>
          `(${lit(subj.id)}, ${d.chapter_id ? lit(d.chapter_id) : "null"}, ${d.topic_id ? lit(d.topic_id) : "null"}, ${lit(d.document_id)}, ${lit(d.job_id)}, ${idx}, ${lit(c.path)}, ${lit(c.text)}, ${Math.ceil(c.text.length / 4)}, '${vecLiteral(vectors[idx])}'::vector)`
        );
        for (let s = 0; s < values.length; s += 25) {
          const part = values.slice(s, s + 25);
          const del = s === 0 ? `delete from knowledge_chunks where document_id = ${lit(d.document_id)};` : "";
          await sql(`${del} insert into knowledge_chunks (subject_id, chapter_id, topic_id, document_id, job_id, chunk_index, heading_path, content, token_estimate, embedding) values ${part.join(",")};`);
        }
        grand.chunks += chunks.length;
      }
      if (unchanged) grand.unchanged++; else if (!SKIP_CHUNKS) grand.docs++;

      let cardNote = "";
      if (!SKIP_CARDS && d.topic_id && (!unchanged || !d.has_card)) {
        const key = await getKey();
        const card = await makeRoutingCard(key, { subject: subj.name, chapter: d.chapter_title, topic: d.topic_title, markdown: d.md });
        const [vec] = await embedTexts(key, [cardEmbedText(d.chapter_title, d.topic_title, card)]);
        await sql(`insert into topic_routing_cards (topic_id, subject_id, chapter_id, chapter_title, topic_title, summary, keywords, sample_questions, embedding, updated_at)
          values (${lit(d.topic_id)}, ${lit(subj.id)}, ${d.chapter_id ? lit(d.chapter_id) : "null"}, ${lit(d.chapter_title)}, ${lit(d.topic_title)}, ${lit(card.summary)}, ${arr(card.keywords)}, ${arr(card.sample_questions)}, '${vecLiteral(vec)}'::vector, now())
          on conflict (topic_id) do update set summary = excluded.summary, keywords = excluded.keywords, sample_questions = excluded.sample_questions,
            chapter_title = excluded.chapter_title, topic_title = excluded.topic_title, embedding = excluded.embedding, updated_at = now();`);
        grand.cards++;
        cardNote = " + card";
      }
      console.log(`  ${label}: ${unchanged ? "unchanged" : chunks.length + " chunks"}${cardNote}`);
    } catch (e) {
      grand.failed++;
      console.log(`  ${label}: FAILED - ${String(e.message).slice(0, 200)}`);
    }
  }
}
console.log(`\nDone. documents indexed=${grand.docs} unchanged=${grand.unchanged} chunks written=${grand.chunks} cards=${grand.cards} failed=${grand.failed} (embedding dims ${EMBED_DIMS})`);
if (grand.failed) process.exitCode = 1;
