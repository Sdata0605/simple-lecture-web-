-- Student-owned Gemini keys. Keys are AES-GCM encrypted by the ai-teacher-keys edge function; clients never see ciphertext.

-- ---------------------------------------------------------------------------
-- 1. Key storage
-- ---------------------------------------------------------------------------
create table if not exists public.ai_teacher_user_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'My key' check (char_length(label) <= 40),
  key_ciphertext text not null,
  key_iv text not null,
  key_last4 text not null,
  key_hash text not null,
  position smallint not null check (position between 0 and 9),
  status text not null default 'untested' check (status in ('active', 'rate_limited', 'invalid', 'untested')),
  last_error text,
  last_error_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key_hash),
  unique (user_id, position)
);

create index if not exists ai_teacher_user_keys_user_position_idx
  on public.ai_teacher_user_keys (user_id, position);

-- Max 10 keys per user, enforced at insert time.
create or replace function public.ai_teacher_user_keys_enforce_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.ai_teacher_user_keys where user_id = new.user_id) >= 10 then
    raise exception 'You can store at most 10 AI teacher keys. Delete one before adding another.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ai_teacher_user_keys_limit on public.ai_teacher_user_keys;
create trigger trg_ai_teacher_user_keys_limit
  before insert on public.ai_teacher_user_keys
  for each row execute function public.ai_teacher_user_keys_enforce_limit();

-- ---------------------------------------------------------------------------
-- 2. Per-user preferences
-- ---------------------------------------------------------------------------
create table if not exists public.ai_teacher_user_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  teacher_name text,
  preset text default 'friendly',
  custom text,
  voice text,
  language text default 'auto',
  active_key_id uuid references public.ai_teacher_user_keys(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ai_teacher_user_keys_updated_at on public.ai_teacher_user_keys;
create trigger trg_ai_teacher_user_keys_updated_at
  before update on public.ai_teacher_user_keys
  for each row execute function public.set_updated_at();

drop trigger if exists trg_ai_teacher_user_prefs_updated_at on public.ai_teacher_user_prefs;
create trigger trg_ai_teacher_user_prefs_updated_at
  before update on public.ai_teacher_user_prefs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS and grants
-- ---------------------------------------------------------------------------
alter table public.ai_teacher_user_keys enable row level security;
alter table public.ai_teacher_user_prefs enable row level security;

-- Keys: clients may read only non-secret columns. All writes go through the
-- ai-teacher-keys edge function (service role), so no insert/update/delete policies.
revoke all on public.ai_teacher_user_keys from anon;
revoke all on public.ai_teacher_user_keys from authenticated;
grant select (
  id,
  label,
  key_last4,
  position,
  status,
  last_error,
  last_error_at,
  last_used_at,
  created_at,
  updated_at
) on public.ai_teacher_user_keys to authenticated;

drop policy if exists own_keys_select on public.ai_teacher_user_keys;
create policy own_keys_select on public.ai_teacher_user_keys
  for select to authenticated
  using (user_id = auth.uid());

-- Prefs: owner-only read, insert and update.
revoke all on public.ai_teacher_user_prefs from anon;
grant select, insert, update on public.ai_teacher_user_prefs to authenticated;

drop policy if exists own_prefs_select on public.ai_teacher_user_prefs;
create policy own_prefs_select on public.ai_teacher_user_prefs
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists own_prefs_insert on public.ai_teacher_user_prefs;
create policy own_prefs_insert on public.ai_teacher_user_prefs
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists own_prefs_update on public.ai_teacher_user_prefs;
create policy own_prefs_update on public.ai_teacher_user_prefs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
