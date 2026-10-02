-- Meal Prep: sync + reminders schema
-- Run once in the Supabase dashboard: SQL Editor > New query > paste > Run.

-- 1) Key-value sync table (one row per checklist item, log entry, or setting)
create table if not exists public.mp_kv (
  user_id    uuid   not null default auth.uid() references auth.users on delete cascade,
  key        text   not null,
  value      jsonb,
  updated_ms bigint not null,                      -- device time of the change (last write wins)
  server_ts  timestamptz not null default clock_timestamp(),  -- pull cursor
  primary key (user_id, key)
);
create index if not exists mp_kv_user_ts on public.mp_kv (user_id, server_ts);

alter table public.mp_kv enable row level security;

drop policy if exists "own rows" on public.mp_kv;
create policy "own rows" on public.mp_kv
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Batched write that only replaces a row when the incoming change is newer.
create or replace function public.kv_put(items jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.mp_kv as t (user_id, key, value, updated_ms, server_ts)
  select auth.uid(), i->>'key', i->'value', (i->>'updated_ms')::bigint, clock_timestamp()
  from jsonb_array_elements(items) as i
  on conflict (user_id, key) do update
    set value = excluded.value,
        updated_ms = excluded.updated_ms,
        server_ts = clock_timestamp()
    where t.updated_ms < excluded.updated_ms;
$$;

revoke all on function public.kv_put(jsonb) from public, anon;
grant execute on function public.kv_put(jsonb) to authenticated;

-- 2) Push subscriptions (one row per device)
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  device_label text,
  remind_at    time not null default '20:30',
  tz           text not null default 'America/Los_Angeles',
  plan_start   date not null default '2026-09-21',
  last_sent_on date,
  created_at   timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
