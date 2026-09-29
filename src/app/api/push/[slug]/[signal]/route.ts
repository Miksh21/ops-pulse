import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { applySignal, noteOf, SIGNALS, type Signal } from "@/lib/ping";

export const dynamic = "force-dynamic";

/**
 * Client-layer push: a client's own automation (e.g. Talent'em's n8n) reports
 * the status of any of that client's agents with one bearer token, which it
 * keeps in its own credential store instead of a URL. Only the token's SHA-256
 * is stored (ops.client_tokens), and it only reaches agents of its project.
 */
async function handle(
  req: Request,
  ctx: { params: Promise<{ slug: string; signal: string }> }
) {
  const { slug, signal } = await ctx.params;

  if (!SIGNALS.has(signal)) {
    return NextResponse.json(
      { error: "signal must be one of heartbeat, ok, fail, start" },
      { status: 400 }
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "bearer token required" }, { status: 401 });
  }

  const agent = await queryOne<{ id: string; slug: string; paused: boolean }>(
    `select a.id, a.slug, a.paused
       from ops.agents a join ops.client_tokens c on c.project = a.project
      where a.slug = $1 and c.token_sha256 = $2`,
    [slug, createHash("sha256").update(token).digest("hex")]
  );

  if (!agent) {
    return NextResponse.json({ error: "unknown agent or token" }, { status: 404 });
  }
  if (agent.paused) {
    return NextResponse.json({ ok: true, ignored: "agent paused" });
  }

  const bucket = await applySignal(agent, signal as Signal, await noteOf(req));
  return NextResponse.json({ ok: true, agent: agent.slug, signal, bucket: bucket.toISOString() });
}

export const POST = handle;
