import { query } from "./db";
import { BUCKET_MINUTES } from "./buckets";
import { publish } from "./ntfy";
import { lastDue } from "./schedule";
import type { Agent, ProbeResult } from "./types";

/**
 * At most one open incident per agent (partial unique index), opened and
 * closed by the tick and the ping route:
 *
 *   failure  a run failed; clears on a later clean run (ran > 0, failed = 0)
 *            or an ok ping, not on a merely quiet bucket
 *   down     the check failed in two consecutive buckets; clears on a pass
 *   late     a scheduled push agent has no signal for a run due grace_min ago
 *
 * Every write is one statement: the transaction pooler keeps no session.
 */
export type IncidentKind = "failure" | "late" | "down";

/** A claimed push: the incident, its agent, and the level it was claimed at. */
export interface PushRow {
  id: string;
  agent_id: string;
  kind: IncidentKind;
  reason: string;
  opened_at: string;
  diagnosis: string | null;
  fix_class: string | null;
  push_level: 2 | 3;
  slug: string;
  name: string;
  project: string;
}

/** Columns a claim statement returns (incidents i, agents a). */
export const PUSH_COLUMNS = `i.id, i.agent_id, i.kind, i.reason, i.opened_at, i.diagnosis, i.fix_class,
  i.push_level, a.slug, a.name, a.project`;

interface Transition {
  agent_id: string;
  kind: IncidentKind;
  reason: string;
}

/** An agent that already has an open incident keeps it; the new one is dropped. */
export async function openIncidents(list: { agentId: string; kind: IncidentKind; reason: string }[]) {
  if (list.length === 0) return;
  const rows = await query<Transition>(
    `insert into ops.incidents (agent_id, kind, reason)
     select * from unnest($1::uuid[], $2::text[], $3::text[])
     on conflict (agent_id) where closed_at is null do nothing
     returning agent_id, kind, reason`,
    [list.map((i) => i.agentId), list.map((i) => i.kind), list.map((i) => i.reason)]
  );
  await logEvents(rows.map((r) => [r.agent_id, "incident_opened", `Incident opened (${r.kind}): ${r.reason}`]));
}

/** Closes each agent's open incident if it is of the listed kind. */
export async function closeIncidents(list: { agentId: string; kind: IncidentKind }[]) {
  if (list.length === 0) return;
  const rows = await query<Transition>(
    `update ops.incidents i set closed_at = now()
       from unnest($1::uuid[], $2::text[]) as x(agent_id, kind)
      where i.closed_at is null and i.agent_id = x.agent_id and i.kind = x.kind
      returning i.agent_id, i.kind, i.reason`,
    [list.map((i) => i.agentId), list.map((i) => i.kind)]
  );
  await logEvents(rows.map((r) => [r.agent_id, "incident_closed", `Incident closed (${r.kind})`]));
}

/** The tick's pass: this bucket's pull results, then every scheduled push agent. */
export async function evaluateIncidents(
  bucket: Date,
  results: { agent: Agent; result: ProbeResult }[],
  now: number
) {
  const open: { agentId: string; kind: IncidentKind; reason: string }[] = [];
  const close: { agentId: string; kind: IncidentKind }[] = [];

  const failing = results.filter((r) => !r.result.ping_ok).map((r) => r.agent.id);
  const failedBefore = new Set(
    failing.length === 0
      ? []
      : (
          await query<{ agent_id: string }>(
            `select agent_id from ops.ticks
              where bucket = $1 and ping_ok = false and agent_id = any($2::uuid[])`,
            [new Date(bucket.getTime() - BUCKET_MINUTES * 60_000).toISOString(), failing]
          )
        ).map((r) => r.agent_id)
  );

  for (const { agent, result } of results) {
    const ran = result.ran ?? 0;
    const failed = result.failed ?? 0;
    if (failed > 0) {
      open.push({ agentId: agent.id, kind: "failure", reason: result.message ?? `${failed} failed runs` });
    } else if (!result.ping_ok && failedBefore.has(agent.id)) {
      // One failed check is a blip; the second in a row is an outage.
      open.push({ agentId: agent.id, kind: "down", reason: result.message ?? "check failed twice in a row" });
    }
    if (ran > 0 && failed === 0) close.push({ agentId: agent.id, kind: "failure" });
    if (result.ping_ok) close.push({ agentId: agent.id, kind: "down" });
  }

  const scheduled = await query<Pick<Agent, "id" | "schedule_cron" | "schedule_tz" | "grace_min" | "last_signal_at">>(
    `select id, schedule_cron, schedule_tz, grace_min, last_signal_at
       from ops.agents
      where kind = 'push' and not paused and schedule_cron is not null`
  );
  for (const a of scheduled) {
    let due: Date | null;
    try {
      due = lastDue(a.schedule_cron ?? "", a.schedule_tz, new Date(now - a.grace_min * 60_000));
    } catch (err) {
      // An unreadable schedule is monitoring that is silently off: say so.
      const why = err instanceof Error ? err.message : String(err);
      open.push({ agentId: a.id, kind: "late", reason: `schedule unusable: ${why}` });
      continue;
    }
    if (!due) continue; // nothing due inside 8 days, so no basis to judge
    const signalled = a.last_signal_at !== null && new Date(a.last_signal_at).getTime() >= due.getTime();
    if (signalled) close.push({ agentId: a.id, kind: "late" });
    else open.push({ agentId: a.id, kind: "late", reason: `no signal for the run due ${due.toISOString()}` });
  }

  // Close first: an agent whose 'down' clears as a run fails needs the slot free.
  await closeIncidents(close);
  await openIncidents(open);

  // A paused agent pages nobody.
  const stoodDown = await query<Transition>(
    `update ops.incidents i set closed_at = now()
       from ops.agents a
      where a.id = i.agent_id and a.paused and i.closed_at is null
      returning i.agent_id, i.kind, i.reason`
  );
  await logEvents(stoodDown.map((r) => [r.agent_id, "incident_closed", `Incident closed (${r.kind}): agent paused`]));

  // Pending pushes, retried every tick until ntfy takes them. Level 2: a
  // diagnosis not yet delivered (it may follow a level 3). Level 3: open and
  // nobody diagnosed it within 15 minutes.
  const pending = await query<PushRow>(
    `update ops.incidents i
        set push_level = case when i.diagnosis is null then 3 else 2 end,
            last_push_at = now()
       from ops.agents a
      where a.id = i.agent_id
        and ((i.diagnosis is not null and (i.push_level is null or i.push_level = 3))
          or (i.diagnosis is null and i.push_level is null and i.closed_at is null
              and i.opened_at <= now() - interval '15 minutes'))
      returning ${PUSH_COLUMNS}`
  );
  await Promise.all(pending.map(deliver));
}

/**
 * Sends one claimed push: level 2 = the diagnosis (priority 4), level 3 =
 * nobody is looking (priority 5). Never throws. On a failed or unconfigured
 * send the claim is released, so the next tick retries, and a push_failed
 * event is written at most once an hour per incident.
 */
export async function deliver(r: PushRow): Promise<boolean> {
  const level3 = r.push_level === 3;
  const failure = await publish({
    title: `${r.project}/${r.slug}: ${r.kind} ${level3 ? "undiagnosed" : "diagnosed"}`,
    priority: level3 ? 5 : 4,
    tags: level3 ? "rotating_light" : "mag",
    body:
      `${r.name}\n${r.reason}\nOpened ${new Date(r.opened_at).toISOString()}\n\n` +
      (level3
        ? "No diagnosis 15 minutes after opening."
        : `${r.fix_class ? `Fix class ${r.fix_class}.\n` : ""}${r.diagnosis}`),
  });
  if (!failure) return true;

  await query(
    `update ops.incidents set push_level = null, last_push_at = null
      where id = $1 and push_level = $2`,
    [r.id, r.push_level]
  );
  await query(
    `insert into ops.events (agent_id, kind, message, detail)
     select $1::uuid, 'push_failed', $2::text, jsonb_build_object('incident', $3::text)
      where not exists (
        select 1 from ops.events
         where agent_id = $1::uuid and kind = 'push_failed'
           and detail->>'incident' = $3::text and at > now() - interval '1 hour')`,
    [r.agent_id, `Level ${r.push_level} push for incident ${r.id} failed, retrying every tick: ${failure}`, r.id]
  );
  return false;
}

async function logEvents(rows: [agentId: string, kind: string, message: string][]) {
  if (rows.length === 0) return;
  await query(
    `insert into ops.events (agent_id, kind, message)
     select * from unnest($1::uuid[], $2::text[], $3::text[])`,
    [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2])]
  );
}
