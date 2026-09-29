// Level 1 digest for Jan's 08:00 briefing (digital footprint Step 1): incidents still
// open, and those resolved since the previous workday 08:00 Prague (Monday looks back
// to Friday). Read-only. Run: node scripts/incidents-digest.mjs
import pg from "pg";
import { config as loadEnv } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("begin read only");
const { rows } = await client.query(`
  with s as (
    select (date_trunc('day', now() at time zone 'Europe/Prague')
            - (case extract(isodow from now() at time zone 'Europe/Prague')
                 when 1 then 3 when 7 then 2 else 1 end) * interval '1 day'
            + interval '8 hours') at time zone 'Europe/Prague' as since)
  select a.project, a.slug, i.kind, i.reason, i.fix_class,
         to_char(i.opened_at at time zone 'Europe/Prague', 'FMDD.FMMM. HH24:MI') as opened,
         to_char(i.closed_at at time zone 'Europe/Prague', 'HH24:MI') as closed,
         i.closed_at is null as open,
         left(regexp_replace(coalesce(i.diagnosis, ''), '\\s*\\n+\\s*', ' / ', 'g'), 300) as diagnosis,
         to_char(s.since at time zone 'Europe/Prague', 'Dy FMDD.FMMM. HH24:MI') as since
    from ops.incidents i join ops.agents a on a.id = i.agent_id, s
   where i.closed_at is null or i.closed_at >= s.since
   order by i.closed_at nulls first, i.opened_at`);
await client.query("rollback");
await client.end();

const open = rows.filter((r) => r.open);
const done = rows.filter((r) => !r.open);
const head = `Ops Pulse incidents`;
if (rows.length === 0) {
  console.log(`${head}: none open, none resolved since the previous workday 08:00.`);
} else {
  console.log(`${head} (resolved since ${rows[0].since}):`);
  console.log(`Open (${open.length}):`);
  for (const r of open) {
    const diag = r.diagnosis ? ` | diagnosis${r.fix_class ? ` (class ${r.fix_class})` : ""}: ${r.diagnosis}` : " | no diagnosis yet";
    console.log(`- ${r.project}/${r.slug}: ${r.kind} since ${r.opened}, ${r.reason}${diag}`);
  }
  console.log(`Resolved (${done.length}):`);
  for (const r of done) console.log(`- ${r.project}/${r.slug}: ${r.kind}, ${r.opened} to ${r.closed}`);
}
