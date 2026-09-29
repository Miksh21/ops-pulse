import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { dispatchDenied } from "@/lib/auth";
import { sanitizeConfig } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

/**
 * For the external dispatcher: every open incident still waiting for a
 * diagnosis, with enough context to start on it. last_tick_at says how fresh
 * the list is; a stale one means the tick itself has stopped.
 */
export async function GET(req: Request) {
  const denied = dispatchDenied(req);
  if (denied) return denied;

  const [incidents, driver] = await Promise.all([
    query<{ config: Record<string, unknown> }>(
      `select i.id, a.slug, a.name, a.project, a.platform, a.probe, a.config,
              i.kind, i.reason, i.opened_at,
              coalesce((
                select json_agg(e order by e.at desc) from (
                  select at, kind, message from ops.events
                   where agent_id = a.id order by at desc limit 10
                ) e
              ), '[]'::json) as events
         from ops.incidents i
         join ops.agents a on a.id = i.agent_id
        where i.closed_at is null and i.diagnosis is null
        order by i.opened_at`
    ),
    query<{ at: string }>(`select at from ops.driver_runs order by at desc limit 1`),
  ]);

  return NextResponse.json(
    {
      last_tick_at: driver[0]?.at ?? null,
      incidents: incidents.map((i) => ({ ...i, config: sanitizeConfig(i.config) })),
    },
    { headers: { "cache-control": "no-store" } }
  );
}
