import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { publish } from "@/lib/ntfy";
import { applySignal, noteOf, SIGNALS, type Signal } from "@/lib/ping";

export const dynamic = "force-dynamic";

/**
 * Push ingest. The monitored thing calls us, which is the only way to watch
 * anything Vercel cannot reach outbound — a VPN-only n8n instance, a job on a
 * laptop, a GitHub Action.
 *
 * The token in the URL *is* the credential, so it is scoped to exactly one
 * agent and can be rotated by rotating the row. Signals: see lib/ping.ts.
 */
async function handle(
  req: Request,
  ctx: { params: Promise<{ token: string; signal: string }> }
) {
  const { token, signal } = await ctx.params;

  if (!SIGNALS.has(signal) && signal !== "notify") {
    return NextResponse.json(
      { error: "signal must be one of heartbeat, ok, fail, start, notify" },
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

  if (signal === "notify") {
    // A plain "needs you" push from the agent's machine (session snooze wake-ups, 2026-10-01):
    // ?title=&click= plus the body; no tick, event or incident, so it never touches the agent's status.
    const params = new URL(req.url).searchParams;
    const click = params.get("click") ?? "";
    const error = await publish({
      title: (params.get("title") ?? agent.slug).slice(0, 120),
      body: (await noteOf(req)) ?? "",
      priority: 4,
      tags: "alarm_clock",
      click: /^(https|claude):\/\//.test(click) ? click : undefined,
    });
    return NextResponse.json(error ? { ok: false, error } : { ok: true, agent: agent.slug, signal }, { status: error ? 502 : 200 });
  }

  const bucket = await applySignal(agent, signal as Signal, await noteOf(req));
  return NextResponse.json({ ok: true, agent: agent.slug, signal, bucket: bucket.toISOString() });
}

export const GET = handle;
export const POST = handle;
