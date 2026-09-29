import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
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

  const bucket = await applySignal(agent, signal as Signal, await noteOf(req));
  return NextResponse.json({ ok: true, agent: agent.slug, signal, bucket: bucket.toISOString() });
}

export const GET = handle;
export const POST = handle;
