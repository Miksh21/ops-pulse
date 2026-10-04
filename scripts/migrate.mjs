import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadEnv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
// Next.js reads .env.local automatically; plain node scripts do not.
loadEnv({ path: join(here, "..", ".env.local"), quiet: true });
const sqlDir = join(here, "..", "sql");

// DDL goes through the session pooler (5432). The transaction pooler the app
// uses is fine for statements but not for a multi-statement migration.
const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Set DIRECT_DATABASE_URL (or DATABASE_URL) first.");
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: true, ca: readFileSync(new URL("../certs/supabase-prod-ca-2021.crt", import.meta.url), "utf8") } });
await client.connect();

for (const file of readdirSync(sqlDir).filter((f) => f.endsWith(".sql")).sort()) {
  process.stdout.write(`applying ${file} … `);
  await client.query(readFileSync(join(sqlDir, file), "utf8"));
  console.log("ok");
}

const { rows } = await client.query(
  `select table_name from information_schema.tables where table_schema = 'ops' order by table_name`
);
console.log("ops tables:", rows.map((r) => r.table_name).join(", "));

await client.end();
