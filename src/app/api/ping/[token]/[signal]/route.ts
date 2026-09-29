import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { bucketOf } from "@/lib/buckets";
import { closeIncidents, openIncidents } from "@/lib/incidents";

export const dynamic = "force-dynamic";

/**
 * Push ingest. The monitored thing calls us, which is the only way to watch
 * anything Vercel cannot reach outbound — a VPN-only n8n instance, a job on a
 * laptop, a GitHub Action.
 *
 * The token in the URL *is* the credential, so it is scoped to exactly one
 * agent and can be rotated by rotating the row. Signals:
 *   heartbeat  "I am alive"        -> ping ok
 *   ok         "a run succeeded"   -> ping ok + ran
 *   fail       "a run failed"      -> ping fail + ran + failed
 *   start      "a run began"       -> event only, no tick change
 */
const SIGNALS = new Set(["heartbeat", "ok", "fail", "start"]);

async function handle(
  req: Request,
  ctx: { params: Promise<{ token: string; signal: string }> }
) {
  const { token, signal } = await ctx.params;

  if (!SIGNALS.has(signal)) {
    return NextResponse.json(
      { error: "signal must be one of heartbeat, ok, fail, start" },
      { status: 400 }
    );
  }

  const agent = await queryOne<{ id: string; slug: string; paused: boolean }>(
    `select id, slug, paused from ops.agents where ping_token = $1`,
    [token]
  );

  if (!agent) {
    return NextResponse.json({ error: "unknown token" }, { status: 404 });
  }
  if (agent.paused) {
    return NextResponse.json({ ok: true, ignored: "agent paused" });
  }

  // Optional free-text note, so a failing workflow can say why.
  const url = new URL(req.url);
  let note = url.searchParams.get("msg");
  if (!note && req.method === "POST") {
    try {
      const body = await req.text();
      if (body) note = body.slice(0, 500);
    } catch {
      /* body is optional */
    }
  }

  const bucket = bucketOf();
  const ran = signal === "ok" || signal === "fail" ? 1 : 0;
  const failed = signal === "fail" ? 1 : 0;
  const pingOk = signal === "fail" ? false : signal === "start" ? null : true;

  if (signal !== "start") {
    await query(
      `insert into ops.ticks (agent_id, bucket, ping_ok, ran, failed)
       values ($1,$2,$3,$4,$5)
       on conflict (agent_id, bucket) do update set
         -- a failure anywhere in the bucket wins over a success
         ping_ok = case when ops.ticks.ping_ok = false then false else excluded.ping_ok end,
         ran     = ops.ticks.ran + excluded.ran,
         failed  = ops.ticks.failed + excluded.failed,
         updated_at = now()`,
      [agent.id, bucket.toISOString(), pingOk, ran, failed]
    );
  }

  const kind =
    signal === "heartbeat"
      ? "heartbeat"
      : signal === "ok"
        ? "run_succeeded"
        : signal === "fail"
          ? "run_failed"
          : "run_started";

  const message =
    note ??
    { heartbeat: "Heartbeat received", ok: "Run succeeded", fail: "Run failed", start: "Run started" }[
      signal
    ];

  await query(
    `insert into ops.events (agent_id, kind, message) values ($1,$2,$3)`,
    [agent.id, kind, message]
  );

  // "start" says a run began, not how it went: it is no signal for lateness.
  if (signal !== "start") {
    await query(`update ops.agents set last_signal_at = now() where id = $1`, [agent.id]);
    // Any signal ends lateness; ok also ends a failure; fail opens one.
    await closeIncidents(
      signal === "ok"
        ? [{ agentId: agent.id, kind: "late" }, { agentId: agent.id, kind: "failure" }]
        : [{ agentId: agent.id, kind: "late" }]
    );
    if (signal === "fail") {
      await openIncidents([{ agentId: agent.id, kind: "failure", reason: message ?? "Run failed" }]);
    }
  }

  return NextResponse.json({ ok: true, agent: agent.slug, signal, bucket: bucket.toISOString() });
}

export const GET = handle;
export const POST = handle;
