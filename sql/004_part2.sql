-- Step 1 part 2 (idempotent): client tokens for /api/push, laptop-aware
-- lateness for the Pro's scheduled jobs, the Talent'em client-layer agents.

create table if not exists ops.client_tokens (
  project      text primary key check (project ~ '^[a-z0-9-]+$'),
  token_sha256 text not null unique,
  created_at   timestamptz not null default now()
);

-- The Pro's own heartbeat: ops-status pings it every 5 minutes while the Pro is
-- awake. No schedule: a sleeping laptop is normal, not late.
insert into ops.agents (slug, name, project, platform, kind, probe, sort_order)
values ('pro-awake', 'MacBook Pro awake (ops-status heartbeat)', 'personal', 'mac', 'push', 'http', 6)
on conflict (slug) do nothing;

-- The Pro's scheduled jobs are judged by Pro-awake minutes (lib/schedule.ts lastAwakeDue).
update ops.agents set config = config || '{"host": "pro"}'::jsonb
 where slug in ('talentem-slack-collector', 'talentem-raynet-refresh',
                'talentem-signal-ops', 'talentem-signal-health')
   and not config ? 'host';

-- Talent'em client layer: their n8n status workflow pushes these every 15
-- minutes. Paused until its first push; talentem-n8n carries the schedule, so a
-- dead workflow or instance goes late.
insert into ops.agents (slug, name, project, platform, kind, probe, sort_order, paused, schedule_cron, grace_min) values
  ('talentem-n8n',        'Talent''em n8n alive (status workflow)',             'talentem', 'n8n',      'push', 'http', 40, true, '*/15 * * * *', 20),
  ('talentem-n8n-runs',   'Talent''em n8n error and crashed runs',              'talentem', 'n8n',      'push', 'http', 41, true, null, 30),
  ('talentem-n8n-wiring', 'Talent''em n8n active workflows without the error handler', 'talentem', 'n8n', 'push', 'http', 42, true, null, 30),
  ('talentem-supabase',   'Talent''em Supabase (checked from their n8n)',       'talentem', 'supabase', 'push', 'http', 43, true, null, 30),
  ('talentem-lemlist',    'Talent''em lemlist (checked from their n8n)',        'talentem', 'lemlist',  'push', 'http', 44, true, null, 30)
on conflict (slug) do nothing;
