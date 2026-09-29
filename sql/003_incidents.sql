-- Status hub step 1. Idempotent: scripts/migrate.mjs re-runs every file.

-- project is the client label. Supersedes 002 (same constraint name).
alter table ops.agents drop constraint if exists agents_project_check;
alter table ops.agents add constraint agents_project_check
  check (project ~ '^[a-z0-9-]+$');

-- Scheduled push agents; /api/ping writes last_signal_at.
alter table ops.agents
  add column if not exists schedule_cron  text,
  add column if not exists schedule_tz    text not null default 'Europe/Prague',
  add column if not exists grace_min      integer not null default 30,
  add column if not exists last_signal_at timestamptz;

create table if not exists ops.incidents (
  id              bigserial primary key,
  agent_id        uuid not null references ops.agents(id) on delete cascade,
  kind            text not null check (kind in ('failure', 'late', 'down')),
  reason          text not null,
  opened_at       timestamptz not null default now(),
  acknowledged_at timestamptz,
  closed_at       timestamptz,
  diagnosis       text,
  diagnosed_at    timestamptz,
  fix_class       text check (fix_class in ('A', 'B')),
  last_push_at    timestamptz,
  push_level      smallint check (push_level in (2, 3))
);

-- One open incident per agent: opening is insert ... on conflict do nothing.
create unique index if not exists incidents_one_open
  on ops.incidents (agent_id) where closed_at is null;

-- Retired, not deleted: two dead agents, and four whose workflows Step 1
-- deactivates (an inactive workflow would otherwise open a 'down' incident).
update ops.agents set paused = true
 where slug in ('n8n-talentem-cloud', 'n8n-w7-distributor',
                'n8n-bess-signal-pipeline', 'n8n-reply-intelligence',
                'n8n-salut-helper', 'n8n-w8-reply-router')
   and not paused;

-- Personal n8n behind Caddy with TLS.
update ops.agents
   set config = jsonb_set(config, '{baseUrl}', '"https://n8n.129-212-141-3.sslip.io"')
 where config->>'baseUrl' = 'http://129.212.141.3:5678';
