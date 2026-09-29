import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { dispatchDenied } from "@/lib/auth";
import { deliver, PUSH_COLUMNS, type PushRow } from "@/lib/incidents";

export const dynamic = "force-dynamic";

/**
 * The dispatcher's diagnosis: { diagnosis: 1-8,000 chars, fix_class?: "A" | "B" }.
 * The first write wins; a diagnosed or closed incident answers 409. Then the
 * level-2 push is tried at once (even after a level-3 "nobody is looking"
 * push); if ntfy is down or unset, the tick keeps retrying it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = dispatchDenied(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!/^\d{1,18}$/.test(id)) {
    return NextResponse.json({ error: "incident id must be numeric" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const diagnosis = typeof body.diagnosis === "string" ? body.diagnosis.trim() : "";
  if (!diagnosis || diagnosis.length > 8_000) {
    return NextResponse.json({ error: "diagnosis must be 1-8000 characters" }, { status: 400 });
  }
  const fixClass = body.fix_class ?? null;
  if (fixClass !== null && fixClass !== "A" && fixClass !== "B") {
    return NextResponse.json({ error: 'fix_class must be "A" or "B"' }, { status: 400 });
  }

  const saved = await queryOne<{ id: string }>(
    `update ops.incidents set diagnosis = $2, diagnosed_at = now(), fix_class = $3
      where id = $1 and diagnosis is null and closed_at is null
      returning id`,
    [id, diagnosis, fixClass]
  );
  if (!saved) {
    return NextResponse.json({ error: "no open, undiagnosed incident with that id" }, { status: 409 });
  }

  const claim = await queryOne<PushRow>(
    `update ops.incidents i set last_push_at = now(), push_level = 2
       from ops.agents a
      where i.id = $1 and a.id = i.agent_id and (i.push_level is null or i.push_level = 3)
      returning ${PUSH_COLUMNS}`,
    [id]
  );
  const pushed = claim ? await deliver(claim) : false;

  return NextResponse.json({ ok: true, id: saved.id, pushed });
}
