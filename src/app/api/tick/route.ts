import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { bucketOf } from "@/lib/buckets";
import { runProbe } from "@/lib/probes";
import { ownedWorkflows } from "@/lib/probes/n8n";
import { isAuthorized } from "@/lib/auth";
import { evaluateIncidents } from "@/lib/incidents";
import type { Agent, ProbeResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Probes are network-bound, so run them together — but not unbounded, or a
// dozen simultaneous TLS handshakes on a cold lambda blows the time budget.
const CONCURRENCY = 8;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const bucket = bucketOf(started);

  // Paused agents are loaded only so their workflows stay registered: the
  // instance-level n8n agent skips every workflow that has its own agent.
  const pull = await query<Agent>(
    `select id, slug, name, project, platform, kind, probe, config,
            ping_token, expected_every_min, paused, sort_order,
            schedule_cron, schedule_tz, grace_min, last_signal_at
       from ops.agents
      where kind = 'pull'
      order by sort_order asc`
  );
  const owned = ownedWorkflows(pull);
  const agents = pull.filter((a) => !a.paused);

  const results = await mapLimit(agents, CONCURRENCY, async (agent) => {
    const result = await runProbe(agent, started, owned);
    return { agent, result };
  });

  // Write ticks and events in one round trip each rather than 2N queries.
  if (results.length > 0) {
    await writeTicks(bucket, results);
    await writeEvents(results);
  }

  // Before driver_runs on purpose: if incident handling breaks, the tick is
  // not recorded, so the dashboard and the dispatcher see a stalled driver
  // instead of a quietly healthy one. Its time is inside duration_ms.
  await evaluateIncidents(bucket, results, started);

  const ok = results.filter((r) => r.result.ping_ok).length;
  const duration = Date.now() - started;

  await query(
    `insert into ops.driver_runs (bucket, checked, ok, failed, duration_ms, source)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      bucket.toISOString(),
      results.length,
      ok,
      results.length - ok,
      duration,
      new URL(req.url).searchParams.get("source") ?? "n8n",
    ]
  );

  // Cheap enough to fold into the tick; keeps the tables from growing forever
  // without needing a second scheduled job.
  if (bucket.getUTCMinutes() === 0 && bucket.getUTCHours() === 3) {
    await query(`select ops.prune()`);
  }

  return NextResponse.json({
    ok: true,
    bucket: bucket.toISOString(),
    checked: results.length,
    healthy: ok,
    unhealthy: results.length - ok,
    duration_ms: duration,
    agents: results.map((r) => ({
      slug: r.agent.slug,
      ping_ok: r.result.ping_ok,
      ran: r.result.ran ?? 0,
      failed: r.result.failed ?? 0,
      latency_ms: r.result.latency_ms,
      message: r.result.message,
    })),
  });
}

async function writeTicks(
  bucket: Date,
  results: { agent: Agent; result: ProbeResult }[]
) {
  const values: string[] = [];
  const params: unknown[] = [];
  results.forEach(({ agent, result }, i) => {
    const b = i * 6;
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
    params.push(
      agent.id,
      bucket.toISOString(),
      result.ping_ok,
      result.ran ?? 0,
      result.failed ?? 0,
      result.latency_ms
    );
  });

  // A retried tick inside the same bucket should correct the row, and run
  // counts accumulate rather than overwrite so two ticks in one bucket do not
  // lose executions.
  await query(
    `insert into ops.ticks (agent_id, bucket, ping_ok, ran, failed, latency_ms)
     values ${values.join(",")}
     on conflict (agent_id, bucket) do update set
       ping_ok    = excluded.ping_ok,
       ran        = ops.ticks.ran + excluded.ran,
       failed     = ops.ticks.failed + excluded.failed,
       latency_ms = excluded.latency_ms,
       updated_at = now()`,
    params
  );
}

async function writeEvents(results: { agent: Agent; result: ProbeResult }[]) {
  const values: string[] = [];
  const params: unknown[] = [];
  let n = 0;

  const push = (agentId: string, kind: string, message: string | null) => {
    const b = n * 3;
    values.push(`($${b + 1},$${b + 2},$${b + 3})`);
    params.push(agentId, kind, message);
    n += 1;
  };

  for (const { agent, result } of results) {
    push(
      agent.id,
      result.ping_ok ? "health_ok" : "health_fail",
      result.ping_ok
        ? "Health check passed"
        : `Health check failed${result.message ? ` — ${result.message}` : ""}`
    );
    if (result.ran) {
      const succeeded = result.ran - (result.failed ?? 0);
      if (succeeded > 0) {
        push(agent.id, "run_succeeded", `${succeeded} run${succeeded === 1 ? "" : "s"} succeeded`);
      }
      if (result.failed) {
        push(agent.id, "run_failed", `${result.failed} run${result.failed === 1 ? "" : "s"} failed`);
      }
    }
  }

  if (n === 0) return;
  await query(
    `insert into ops.events (agent_id, kind, message) values ${values.join(",")}`,
    params
  );
}

export const GET = handle;
export const POST = handle;
