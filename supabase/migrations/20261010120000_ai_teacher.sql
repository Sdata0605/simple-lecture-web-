-- AI Teacher 1-to-1 support objects. Idempotent.
--
-- ai_teacher_usage       : request log used for per-IP rate limiting of the public page.
-- search_topic_cards()   : hybrid search over topic routing cards (picks the right topics).
-- search_knowledge_chunks: re-declared so the vector side is skipped when no embedding is given
--                          (keyword-only fallback).

create table if not exists public.ai_teacher_usage (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  action     text not null,
  subject_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists ai_teacher_usage_rate_idx
  on public.ai_teacher_usage (ip_hash, action, created_at desc);
create index if not exists ai_teacher_usage_created_idx
  on public.ai_teacher_usage (created_at);

-- Service-role only (no policies): the public page talks to the edge function, never the table.
alter table public.ai_teacher_usage enable row level security;

create or replace function public.search_topic_cards(
  p_subject_id      uuid,
  p_query_text      text,
  p_query_embedding vector(768) default null,
  p_match_count     integer default 5
)
returns table (
  topic_id      uuid,
  chapter_id    uuid,
  chapter_title text,
  topic_title   text,
  summary       text,
  score         double precision
)
language sql
stable
as $$
  with q as (
    select replace(plainto_tsquery('simple', p_query_text)::text, ' & ', ' | ')::tsquery as tsq
  ),
  kw as (
    select c.topic_id,
           row_number() over (order by ts_rank_cd(c.fts, q.tsq) desc) as rnk
    from public.topic_routing_cards c, q
    where c.subject_id = p_subject_id
      and c.fts @@ q.tsq
    order by ts_rank_cd(c.fts, q.tsq) desc
    limit 20
  ),
  vec as (
    select c.topic_id,
           row_number() over (order by c.embedding <=> p_query_embedding) as rnk
    from public.topic_routing_cards c
    where c.subject_id = p_subject_id
      and p_query_embedding is not null
      and c.embedding is not null
    order by c.embedding <=> p_query_embedding
    limit 20
  )
  select c.topic_id, c.chapter_id, c.chapter_title, c.topic_title, c.summary,
         (coalesce(1.0 / (60 + kw.rnk), 0) + coalesce(1.0 / (60 + vec.rnk), 0))::double precision as score
  from kw
  full outer join vec on vec.topic_id = kw.topic_id
  join public.topic_routing_cards c on c.topic_id = coalesce(kw.topic_id, vec.topic_id)
  order by score desc
  limit p_match_count;
$$;

revoke all on function public.search_topic_cards(uuid, text, vector, integer) from public, anon, authenticated;
grant execute on function public.search_topic_cards(uuid, text, vector, integer) to service_role;

-- Same function as before, but the vector branch is skipped when p_query_embedding is null.
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
      and p_query_embedding is not null
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
