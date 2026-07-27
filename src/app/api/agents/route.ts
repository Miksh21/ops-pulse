import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { loadDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await loadDashboard();
    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to load dashboard" },
      { status: 500 }
    );
  }
}

const PROBES = new Set(["vercel", "n8n", "supabase", "lemlist", "http"]);

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const project = String(body.project ?? "");
  const kind = body.kind === "push" ? "push" : "pull";
  const probe = String(body.probe ?? "http");

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!project.trim()) {
    return NextResponse.json({ error: "project is required" }, { status: 400 });
  }
  if (kind === "pull" && !PROBES.has(probe)) {
    return NextResponse.json({ error: `unknown probe: ${probe}` }, { status: 400 });
  }

  const slug =
    (typeof body.slug === "string" && body.slug) ||
    `${project}-${name}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  try {
    const rows = await query<{ id: string; slug: string; ping_token: string }>(
      `insert into ops.agents (slug, name, project, platform, kind, probe, config, expected_every_min, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning id, slug, ping_token`,
      [
        slug,
        name,
        project,
        String(body.platform ?? probe),
        kind,
        kind === "push" ? "http" : probe,
        JSON.stringify(body.config ?? {}),
        typeof body.expected_every_min === "number" ? body.expected_every_min : kind === "push" ? 60 : null,
        typeof body.sort_order === "number" ? body.sort_order : 100,
      ]
    );
    return NextResponse.json({ ok: true, agent: rows[0] }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const conflict = message.includes("duplicate key");
    return NextResponse.json(
      { error: conflict ? `an agent with slug "${slug}" already exists` : message },
      { status: conflict ? 409 : 500 }
    );
  }
}
