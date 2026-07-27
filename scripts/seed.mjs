import { seedAgents } from "./lib/seed-agents.mjs";

/**
 * Example registry: one agent per probe type, plus one push agent.
 *
 * This is a shape reference, not a working inventory. Copy it to
 * `scripts/seed.local.mjs` (gitignored), point it at things you actually run,
 * and use `npm run seed:local`. Credentials are never listed here, only the
 * NAME of the env var each probe should read.
 */

const AGENTS = [
  {
    slug: "vercel-marketing-site",
    name: "Marketing site",
    project: "acme",
    platform: "vercel",
    kind: "pull",
    probe: "vercel",
    config: {
      projectId: "prj_xxxxxxxxxxxxxxxxxxxxxxxx",
      teamId: "team_xxxxxxxxxxxxxxxxxxxxxxxx",
      prodUrl: "acme.example.com",
      tokenEnv: "VERCEL_API_TOKEN",
    },
    sort_order: 10,
  },
  {
    slug: "n8n-instance",
    name: "n8n instance",
    project: "acme",
    platform: "n8n",
    kind: "pull",
    probe: "n8n",
    config: { baseUrl: "https://n8n.example.com", apiKeyEnv: "N8N_API_KEY" },
    sort_order: 20,
  },
  {
    slug: "n8n-nightly-sync",
    name: "Nightly CRM sync",
    project: "acme",
    platform: "n8n",
    kind: "pull",
    probe: "n8n",
    // An inactive workflow reports degraded: silently-off automation is the
    // exact failure this dashboard exists to catch.
    config: {
      baseUrl: "https://n8n.example.com",
      apiKeyEnv: "N8N_API_KEY",
      workflowId: "workflow-id",
    },
    sort_order: 21,
  },
  {
    slug: "supabase-primary",
    name: "Supabase · primary",
    project: "acme",
    platform: "supabase",
    kind: "pull",
    probe: "supabase",
    // The anon key is deliberate. A monitor should not hold a write key.
    config: { url: "https://xxxxxxxx.supabase.co", apiKeyEnv: "SUPABASE_ANON_KEY" },
    sort_order: 30,
  },
  {
    slug: "lemlist-workspace",
    name: "lemlist workspace",
    project: "acme",
    platform: "lemlist",
    kind: "pull",
    probe: "lemlist",
    config: { apiKeyEnv: "LEMLIST_API_KEY" },
    sort_order: 40,
  },
  {
    slug: "status-endpoint",
    name: "Public status endpoint",
    project: "acme",
    platform: "http",
    kind: "pull",
    probe: "http",
    config: { url: "https://example.com/health", expectStatus: 200 },
    sort_order: 50,
  },
  {
    slug: "laptop-nightly-job",
    name: "Nightly job (laptop)",
    project: "personal",
    platform: "cron",
    // Push, because nothing reachable from the internet can poll a laptop.
    // It calls /api/ping/<token>/heartbeat instead; silence past
    // expected_every_min is what marks it down.
    kind: "push",
    probe: "http",
    config: {},
    expected_every_min: 1440,
    sort_order: 60,
  },
];

await seedAgents(AGENTS);
