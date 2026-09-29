import { query } from "./db";
import { bucketKey, recentBuckets, WINDOW_BUCKETS } from "./buckets";
import { computeHealth, successRate } from "./health";
import type { Agent, AgentView, DashboardPayload, OpsEvent, Tick } from "./types";

interface TickRow extends Tick {
  agent_id: string;
}
interface EventRow extends OpsEvent {
  agent_id: string;
}

export async function loadDashboard(): Promise<DashboardPayload> {
  const buckets = recentBuckets(WINDOW_BUCKETS);
  const windowStart = buckets[0];

  const [agents, ticks, events, driver, incidents] = await Promise.all([
    query<Agent>(
      `select id, slug, name, project, platform, kind, probe, config,
              ping_token, expected_every_min, paused, sort_order,
              schedule_cron, schedule_tz, grace_min, last_signal_at
         from ops.agents
        order by sort_order asc, name asc`
    ),
    query<TickRow>(
      `select agent_id, bucket, ping_ok, ran, failed, latency_ms
         from ops.ticks
        where bucket >= $1
        order by bucket asc`,
      [windowStart.toISOString()]
    ),
    // Last 25 events per agent, which is what the detail panel shows.
    query<EventRow>(
      `select id, agent_id, at, kind, message from (
         select e.*, row_number() over (partition by agent_id order by at desc) as rn
           from ops.events e
       ) ranked
       where rn <= 25
       order by at desc`
    ),
    query<{ at: string }>(
      `select at from ops.driver_runs order by at desc limit 1`
    ),
    query<{ agent_id: string }>(
      `select agent_id from ops.incidents where closed_at is null`
    ),
  ]);
  const withOpenIncident = new Set(incidents.map((i) => i.agent_id));

  const ticksByAgent = new Map<string, Tick[]>();
  for (const t of ticks) {
    const list = ticksByAgent.get(t.agent_id) ?? [];
    list.push({
      bucket: new Date(t.bucket).toISOString(),
      ping_ok: t.ping_ok,
      ran: t.ran,
      failed: t.failed,
      latency_ms: t.latency_ms,
    });
    ticksByAgent.set(t.agent_id, list);
  }

  const eventsByAgent = new Map<string, OpsEvent[]>();
  for (const e of events) {
    const list = eventsByAgent.get(e.agent_id) ?? [];
    list.push({
      id: Number(e.id),
      at: new Date(e.at).toISOString(),
      kind: e.kind,
      message: e.message,
    });
    eventsByAgent.set(e.agent_id, list);
  }

  const now = Date.now();
  const agentViews: AgentView[] = agents.map((agent) => {
    const agentTicks = ticksByAgent.get(agent.id) ?? [];
    const agentEvents = eventsByAgent.get(agent.id) ?? [];

    const lastPing = [...agentTicks]
      .reverse()
      .find((t) => t.ping_ok !== null);
    const lastRun = [...agentTicks].reverse().find((t) => t.ran > 0);
    // The column, not the newest event: events include the tick's own
    // incident notes and are pruned after 3 days.
    const lastSignal = agent.last_signal_at ? new Date(agent.last_signal_at).toISOString() : null;

    return {
      ...agent,
      config: sanitizeConfig(agent.config),
      ticks: agentTicks,
      events: agentEvents,
      health: computeHealth(agent, agentTicks, lastSignal, withOpenIncident.has(agent.id), now),
      last_ping_at: lastPing?.bucket ?? null,
      last_run_at: lastRun?.bucket ?? null,
      success_rate: successRate(agentTicks),
    };
  });

  const lastDriverAt = driver[0]?.at ? new Date(driver[0].at).toISOString() : null;
  const minutesSince = lastDriverAt
    ? Math.floor((now - Date.parse(lastDriverAt)) / 60_000)
    : null;

  return {
    agents: agentViews,
    buckets: buckets.map(bucketKey),
    driver: {
      last_run_at: lastDriverAt,
      // Two missed ticks. Below this, a late cron is just a late cron.
      stalled: minutesSince === null || minutesSince > 12,
      minutes_since: minutesSince,
    },
    generated_at: new Date(now).toISOString(),
  };
}

/**
 * Config is echoed to the browser so the detail panel can show what is being
 * checked. Only env-var *names* live in there by design, but strip anything
 * that looks like a literal credential in case an agent was added by hand.
 */
export function sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config ?? {})) {
    if (/key|token|secret|password/i.test(k) && !/env$/i.test(k)) {
      out[k] = "<redacted>";
    } else {
      out[k] = v;
    }
  }
  return out;
}
