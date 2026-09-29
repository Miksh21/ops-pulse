import { query } from "./db";
import { bucketOf } from "./buckets";
import { closeIncidents, openIncidents } from "./incidents";

/**
 * Push signals, shared by /api/ping (token in the path, one agent) and
 * /api/push (a client's bearer token, any agent of that client):
 *   heartbeat  "I am alive"        -> ping ok
 *   ok         "a run succeeded"   -> ping ok + ran
 *   fail       "a run failed"      -> ping fail + ran + failed
 *   start      "a run began"       -> event only, no tick change
 */
export const SIGNALS = new Set(["heartbeat", "ok", "fail", "start"]);
export type Signal = "heartbeat" | "ok" | "fail" | "start";

/** Optional free-text note, so a failing job can say why: ?msg= or a POST body. */
export async function noteOf(req: Request): Promise<string | null> {
  const note = new URL(req.url).searchParams.get("msg");
  if (note || req.method !== "POST") return note;
  try {
    const body = await req.text();
    return body ? body.slice(0, 500) : null;
  } catch {
    return null; // the body is optional
  }
}

export async function applySignal(agent: { id: string }, signal: Signal, note: string | null) {
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

  const kind = { heartbeat: "heartbeat", ok: "run_succeeded", fail: "run_failed", start: "run_started" }[signal];
  const message =
    note ?? { heartbeat: "Heartbeat received", ok: "Run succeeded", fail: "Run failed", start: "Run started" }[signal];

  await query(`insert into ops.events (agent_id, kind, message) values ($1,$2,$3)`, [agent.id, kind, message]);

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
      await openIncidents([{ agentId: agent.id, kind: "failure", reason: message }]);
    }
  }
  return bucket;
}
