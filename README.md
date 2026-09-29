# Ops Pulse

Health and run monitoring for everything you run across several projects at once:
Vercel deployments, n8n workflows, Supabase projects, lemlist.

Live: <https://ops-pulse-one.vercel.app> (gated, see *Access* below)

Each agent renders a 4-hour strip of 48 five-minute cells:
green = health check passed, blue = a run happened, red = a check or run failed,
dark = no data.

---

## Architecture

```
n8n droplet (self-hosted)            Vercel (ops-pulse)              Supabase (own project)
  Schedule Trigger, every 5 min  ->  POST /api/tick             ->   ops.ticks     (one row per agent per bucket)
                                       fans out to 25 probes         ops.events    (activity feed)
                                       concurrency 8, ~4s            ops.driver_runs (stall detection)

anything that can't be polled    ->  GET/POST /api/ping/<token>/<signal>
(VPN-only, laptop jobs, CI)          heartbeat | ok | fail | start
```

### Why n8n drives the tick

Vercel's **Hobby plan runs Cron once per day**, so native `vercel.json` crons
cannot produce a 5-minute tick. The n8n droplet is already paid for, always on,
and outside the VPN, so it drives the schedule instead. If it stops, the
dashboard shows a **"Tick driver stalled"** banner rather than leaving stale
green tiles that look healthy.

Moving to Vercel Pro later needs no code change — `/api/tick` already accepts
Vercel Cron's `Authorization: Bearer` header.

### Why some things push instead of being polled

One of the monitored n8n instances resolves to a private address and is
**VPN-only** — a Vercel function can never reach it. Anything in that position
uses the push endpoints instead, where the URL token is the credential.
Every agent has push URLs available whether or not it uses them.

---

## Probes

| Probe | Signal | Notes |
|---|---|---|
| `vercel` | production alias responds (`< 500`); deployments finished/errored since last tick | Needs `projectId` + `teamId` + `VERCEL_API_TOKEN` |
| `n8n` | workflow is **active**; executions succeeded/failed since last tick | An inactive workflow reports **degraded** — silently-off automation is the exact failure this exists to catch |
| `supabase` | `/auth/v1/health` with the **anon** key | Deliberately not `/rest/v1/`, which only accepts `service_role`; a monitor should not hold a write key |
| `lemlist` | `/api/team` over HTTP Basic (`:apiKey`) | |
| `http` | generic URL + optional expected status | Escape hatch for anything else |

Credentials are referenced from agent config **by env-var name only** — the
database stores `{"apiKeyEnv": "N8N_PERSONAL_API_KEY"}`, never a key. A leaked
row reveals what is monitored, not how to reach it.

### Health is not "the last check failed"

One failed probe is usually a blip. Calling that "down" trains you to ignore the
dashboard, which is the only failure mode that really matters.

- **down** — an open incident (a failed run, two consecutive failed checks, a scheduled push agent that missed its run), red until the incident closes; or an unscheduled push agent silent for more than 2× its expected interval
- **degraded** — the latest check failed but the previous passed
- **operational** — everything else that has reported
- **unknown** — no data, or data older than 4 ticks (stale never renders green)

---

## Access

The whole app is gated on `OPS_DASHBOARD_KEY` (Vercel password protection is a
Pro feature, and this page is a map of every project and endpoint you run).

Open once with `?k=<OPS_DASHBOARD_KEY>` — the key is stored in an httpOnly
cookie and stripped from the URL, so it never lingers in history or a screenshot.
Afterwards the bare URL works for 90 days.

Not gated: `/api/tick` (own secret), `/api/ping/*` (token in the URL; a cron
job cannot hold a browser cookie) and `/api/incidents` (header `x-ops-dispatch`
= `OPS_DISPATCH_SECRET`, for the external dispatcher: `GET` lists open incidents
without a diagnosis, `POST /api/incidents/<id>` writes one).

---

## Local development

```bash
npm install
npm run migrate   # applies sql/*.sql via the session pooler
npm run seed      # idempotent; upserts the agent registry by slug
npm run dev
```

Then open `http://localhost:3000/?k=<OPS_DASHBOARD_KEY>`.

Fire a tick by hand:

```bash
curl -X POST -H "x-ops-secret: $OPS_TICK_SECRET" "http://localhost:3000/api/tick?source=manual"
```

### Environment

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Supabase **transaction** pooler (`:6543`) — right endpoint for serverless |
| `DIRECT_DATABASE_URL` | Supabase **session** pooler (`:5432`) — migrations only, local |
| `OPS_DASHBOARD_KEY` | Gate for the UI and write APIs |
| `OPS_TICK_SECRET` | Gate for `/api/tick`; also lives in the n8n credential |
| `OPS_DISPATCH_SECRET` | Gate for `/api/incidents` (external dispatcher); unset = 503 |
| `NTFY_URL`, `NTFY_TOKEN` | Full ntfy topic URL and its Bearer token for incident pushes; while unset or down, pushes are retried every tick (one `push_failed` event per incident per hour) |
| `VERCEL_API_TOKEN`, `N8N_API_KEY`, `SUPABASE_ANON_KEY`, `LEMLIST_API_KEY`, … | Probe credentials. Each agent names the var it reads, so add one per instance you monitor. |
| `NEXT_PUBLIC_OPS_TZ` | Display timezone, default `Europe/Prague` |

Locale and timezone are pinned in `src/lib/format.ts`. Left to defaults the
server renders timestamps in UTC while the browser renders in Prague, and every
timestamp throws a hydration mismatch.

---

## Adding an agent

Use **+ Add Agent** in the UI, or add a row to `scripts/seed.mjs` and re-run
`npm run seed` (upsert by slug, so it is safe to re-run).

For a push agent, open its detail panel and copy the Heartbeat / Run OK / Run
Fail URLs into the thing being monitored — in n8n that is an HTTP Request node
on the success path and another on the error path.

---

## Retention

`ops.prune()` runs inside the 03:00 UTC tick: ticks and driver runs keep 14 days,
events keep 3. Events are written once per health check per agent, so at 25
agents that is ~7k rows/day — trimmed to roughly 22k standing rows.

---

## Deployed pieces

| Piece | Where |
|---|---|
| App | Vercel project `ops-pulse`, team `jan-mikes-s-projects` |
| Database | Supabase `creator-radar` (`nfsunprumxngcngsbsba`), schema `ops` |
| Tick driver | Personal n8n `59NzJskyDANfjpvX` — *Ops Pulse - 5-min tick driver* (active) |
| Driver credential | Personal n8n `tLAwJLdqY6QMSfvS` — *Ops Pulse - tick secret* (httpHeaderAuth) |
