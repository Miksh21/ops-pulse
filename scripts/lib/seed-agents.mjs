import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadEnv } from "dotenv";

loadEnv({
  path: join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env.local"),
  quiet: true,
});

/**
 * Upserts an agent registry. Idempotent: re-running updates the definition of an
 * existing slug rather than duplicating it, and never touches ping tokens (those
 * are printed once and pasted into workflows). `paused` applies only when a row
 * is first created, so a retired agent listed with paused: true stays retired.
 */
export async function seedAgents(agents) {
  const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Set DIRECT_DATABASE_URL (or DATABASE_URL) first.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: true, ca: readFileSync(new URL("../../certs/supabase-prod-ca-2021.crt", import.meta.url), "utf8") } });
  await client.connect();

  for (const a of agents) {
    await client.query(
      `insert into ops.agents (slug, name, project, platform, kind, probe, config, expected_every_min, sort_order, paused)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (slug) do update set
         name = excluded.name,
         project = excluded.project,
         platform = excluded.platform,
         kind = excluded.kind,
         probe = excluded.probe,
         config = excluded.config,
         sort_order = excluded.sort_order`,
      [a.slug, a.name, a.project, a.platform, a.kind, a.probe, JSON.stringify(a.config), a.expected_every_min ?? null, a.sort_order, a.paused ?? false]
    );
  }

  const { rows } = await client.query(
    `select project, count(*)::int as n from ops.agents group by project order by project`
  );
  console.log(`seeded ${agents.length} agents`);
  for (const r of rows) console.log(`  ${r.project}: ${r.n}`);

  await client.end();
}
