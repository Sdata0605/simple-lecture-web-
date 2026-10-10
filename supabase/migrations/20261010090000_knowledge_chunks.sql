-- Knowledge index for fast subject Q&A retrieval.
-- Idempotent: safe to run more than once.
--
-- knowledge_chunks      : heading-based chunks of each published job's markdown,
--                         with a keyword index (fts) and an embedding.
-- topic_routing_cards   : one short card per topic (summary, keywords, sample
--                         questions) used to pick the right topics before
--                         searching chunks.
-- search_knowledge_chunks: hybrid (keyword + vector) search merged with
--                         reciprocal-rank fusion, scoped to one subject.
--
-- Embedding dimension is 768 (e.g. Gemini embeddings with outputDimensionality=768).
-- Changing the embedding model/dimension later means re-creating these columns.

create extension if not exists vector;

create table if not exists public.knowledge_chunks (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null references public.popular_subjects(id) on delete cascade,
  chapter_id    uuid,
  topic_id      uuid,
  document_id   uuid not null references public.ai_assistant_documents(id) on delete cascade,
  job_id        text,
  chunk_index   integer not null,
  heading_path  text not null default '',
  content       text not null,
  token_estimate integer,
  embedding     vector(768),
  fts           tsvector generated always as (
                  to_tsvector('simple', coalesce(heading_path, '') || ' ' || coalesce(content, ''))
                ) stored,
  created_at    timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists knowledge_chunks_subject_idx on public.knowledge_chunks (subject_id);
create index if not exists knowledge_chunks_topic_idx   on public.knowledge_chunks (topic_id);
create index if not exists knowledge_chunks_fts_idx     on public.knowledge_chunks using gin (fts);
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding vector_cosine_ops);

-- array_to_string is only STABLE, which Postgres rejects in generated columns.
-- Wrapping it as IMMUTABLE is safe here because text[] -> text has no locale/time dependence.
create or replace function public.immutable_array_to_string(arr text[], sep text)
returns text
language sql
immutable
parallel safe
as $$ select array_to_string(arr, sep) $$;

create table if not exists public.topic_routing_cards (
  topic_id         uuid primary key,
  subject_id       uuid not null references public.popular_subjects(id) on delete cascade,
  chapter_id       uuid,
  chapter_title    text,
  topic_title      text,
  summary          text,
  keywords         text[] not null default '{}',
  sample_questions text[] not null default '{}',
  embedding        vector(768),
  fts              tsvector generated always as (
                     to_tsvector('simple',
                       coalesce(chapter_title, '') || ' ' || coalesce(topic_title, '') || ' ' ||
                       coalesce(summary, '')       || ' ' || public.immutable_array_to_string(keywords, ' ') || ' ' ||
                       public.immutable_array_to_string(sample_questions, ' '))
                   ) stored,
  updated_at       timestamptz not null default now()
);

create index if not exists topic_routing_cards_subject_idx on public.topic_routing_cards (subject_id);
create index if not exists topic_routing_cards_fts_idx     on public.topic_routing_cards using gin (fts);
create index if not exists topic_routing_cards_embedding_idx
  on public.topic_routing_cards using hnsw (embedding vector_cosine_ops);

-- Service-role only for now (no policies = no access for anon/authenticated).
alter table public.knowledge_chunks    enable row level security;
alter table public.topic_routing_cards enable row level security;

-- Hybrid search: keyword (OR of terms) + vector, merged with reciprocal-rank fusion.
create or replace function public.search_knowledge_chunks(
  p_subject_id      uuid,
  p_query_text      text,
  p_query_embedding vector(768),
  p_match_count     integer default 5,
  p_topic_ids       uuid[]  default null
)
returns table (
  id           uuid,
  topic_id     uuid,
  chapter_id   uuid,
  document_id  uuid,
  heading_path text,
  content      text,
  score        double precision
)
language sql
stable
as $$
  with q as (
    select replace(plainto_tsquery('simple', p_query_text)::text, ' & ', ' | ')::tsquery as tsq
  ),
  kw as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.fts, q.tsq) desc) as rnk
    from public.knowledge_chunks c, q
    where c.subject_id = p_subject_id
      and (p_topic_ids is null or c.topic_id = any (p_topic_ids))
      and c.fts @@ q.tsq
    order by ts_rank_cd(c.fts, q.tsq) desc
    limit 30
  ),
  vec as (
    select c.id,
           row_number() over (order by c.embedding <=> p_query_embedding) as rnk
    from public.knowledge_chunks c
    where c.subject_id = p_subject_id
      and (p_topic_ids is null or c.topic_id = any (p_topic_ids))
      and c.embedding is not null
    order by c.embedding <=> p_query_embedding
    limit 30
  )
  select c.id, c.topic_id, c.chapter_id, c.document_id, c.heading_path, c.content,
         (coalesce(1.0 / (60 + kw.rnk), 0) + coalesce(1.0 / (60 + vec.rnk), 0))::double precision as score
  from kw
  full outer join vec on vec.id = kw.id
  join public.knowledge_chunks c on c.id = coalesce(kw.id, vec.id)
  order by score desc
  limit p_match_count;
$$;

revoke all on function public.search_knowledge_chunks(uuid, text, vector, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.search_knowledge_chunks(uuid, text, vector, integer, uuid[]) to service_role;
