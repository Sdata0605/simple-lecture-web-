-- Athena (the separate RAG/HyperFrame service at 116.202.230.124:8090) has
-- its own subject/chapter/topic UUIDs, entirely distinct from this app's
-- popular_subjects/subject_chapters/subject_topics. Nothing previously
-- recorded which Athena subject/topic corresponds to an app one, so any
-- feature calling Athena's /ask (which is subject-scoped) had no reliable
-- way to pick the right target.
--
-- These columns are the durable link. Populated two ways:
--   1. Going forward: ImportSubjectToAthenaDialog (admin) saves
--      athena_subject_id automatically after a successful import.
--   2. For subjects imported before this existed: an admin sets it once via
--      a linking UI (same pattern as the Notes Report's "link source
--      subject" picker, just the forward direction).
--
-- Nullable and unindexed-by-default beyond the lookup index below — most
-- subjects will have no link until an admin sets one, and that's fine; the
-- student-facing "ask a question" prompt just doesn't show for those.

alter table public.popular_subjects
  add column if not exists athena_subject_id text;

alter table public.subject_topics
  add column if not exists athena_topic_id text;

comment on column public.popular_subjects.athena_subject_id is
  'UUID of the matching subject in the Athena service (separate system, not a DB foreign key — Athena is not in this database).';
comment on column public.subject_topics.athena_topic_id is
  'UUID of the matching topic in the Athena service (separate system, not a DB foreign key — Athena is not in this database).';

create index if not exists idx_popular_subjects_athena_subject_id
  on public.popular_subjects (athena_subject_id)
  where athena_subject_id is not null;

create index if not exists idx_subject_topics_athena_topic_id
  on public.subject_topics (athena_topic_id)
  where athena_topic_id is not null;
