import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Pause / resume, rename, or re-point an agent. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (typeof body.paused === "boolean") {
    params.push(body.paused);
    sets.push(`paused = $${params.length}`);
  }
  if (typeof body.name === "string" && body.name.trim()) {
    params.push(body.name.trim());
    sets.push(`name = $${params.length}`);
  }
  if (body.config && typeof body.config === "object") {
    params.push(JSON.stringify(body.config));
    sets.push(`config = $${params.length}`);
  }
  if (typeof body.sort_order === "number") {
    params.push(body.sort_order);
    sets.push(`sort_order = $${params.length}`);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  params.push(id);
  const row = await queryOne<{ id: string; paused: boolean }>(
    `update ops.agents set ${sets.join(", ")} where id = $${params.length}
     returning id, paused`,
    params
  );

  if (!row) return NextResponse.json({ error: "agent not found" }, { status: 404 });

  if (typeof body.paused === "boolean") {
    await query(`insert into ops.events (agent_id, kind, message) values ($1,$2,$3)`, [
      id,
      body.paused ? "paused" : "resumed",
      body.paused ? "Monitoring paused" : "Monitoring resumed",
    ]);
  }

  return NextResponse.json({ ok: true, agent: row });
}

/** Remove an agent. Ticks and events cascade with it. */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const row = await queryOne<{ id: string }>(
    `delete from ops.agents where id = $1 returning id`,
    [id]
  );
  if (!row) return NextResponse.json({ error: "agent not found" }, { status: 404 });
  return NextResponse.json({ ok: true, removed: row.id });
}
