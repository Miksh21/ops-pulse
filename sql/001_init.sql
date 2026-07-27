-- ops-pulse schema. Install it into a Supabase project you control that holds
-- no client data: this database records what you monitor, so it should not sit
-- inside any project it is monitoring.

create schema if not exists ops;

-- One row per monitored thing. `kind` decides how data arrives:
--   pull -> the 5-min driver probes it and writes the tick
--   push -> the thing itself calls /api/ping/<token>/<signal>
create table if not exists ops.agents (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  -- Free-form grouping label (a client, a team, a side project). The UI builds
  -- its filter chips from whatever values actually appear here.
  project           text not null check (project <> ''),
  platform          text not null,
  kind              text not null default 'pull' check (kind in ('pull','push')),
  probe             text not null default 'http',
  config            jsonb not null default '{}'::jsonb,
  ping_token        text not null unique default encode(gen_random_bytes(16),'hex'),
  -- push agents only: how long a silence before we call it down
  expected_every_min integer,
  paused            boolean not null default false,
  sort_order        integer not null default 100,
  created_at        timestamptz not null default now()
);

-- One row per agent per 5-minute bucket. This is what the tick grid renders.
-- ping_ok is the health probe; ran/failed count actual runs observed.
create table if not exists ops.ticks (
  agent_id    uuid not null references ops.agents(id) on delete cascade,
  bucket      timestamptz not null,
  ping_ok     boolean,
  ran         integer not null default 0,
  failed      integer not null default 0,
  latency_ms  integer,
  updated_at  timestamptz not null default now(),
  primary key (agent_id, bucket)
);

create index if not exists ticks_bucket_idx on ops.ticks (bucket desc);

-- Human-readable activity feed for the detail panel.
create table if not exists ops.events (
  id        bigserial primary key,
  agent_id  uuid not null references ops.agents(id) on delete cascade,
  at        timestamptz not null default now(),
  kind      text not null,
  message   text,
  detail    jsonb
);

create index if not exists events_agent_at_idx on ops.events (agent_id, at desc);

-- Records every driver invocation so the UI can tell "everything is healthy"
-- apart from "nothing has checked in 40 minutes and we are showing stale green".
create table if not exists ops.driver_runs (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  bucket       timestamptz not null,
  checked      integer not null default 0,
  ok           integer not null default 0,
  failed       integer not null default 0,
  duration_ms  integer,
  source       text
);

create index if not exists driver_runs_at_idx on ops.driver_runs (at desc);

-- Rolling retention. Ticks are one narrow row per agent per 5 min, so a
-- fortnight is cheap and gives real success-rate math. Events are chattier
-- (one per health check) and only ever read as a short recent feed, so they
-- get 3 days. Both stay comfortably inside the free tier.
create or replace function ops.prune(
  tick_days  integer default 14,
  event_days integer default 3
) returns void language sql as $$
  delete from ops.ticks       where bucket < now() - (tick_days  || ' days')::interval;
  delete from ops.events      where at     < now() - (event_days || ' days')::interval;
  delete from ops.driver_runs where at     < now() - (tick_days  || ' days')::interval;
$$;
