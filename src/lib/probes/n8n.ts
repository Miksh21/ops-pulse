import type { Agent, ProbeResult } from "@/lib/types";
import { timedFetch, parseJson, secret, str } from "./fetchers";

const baseOf = (config: Record<string, unknown>) => str(config.baseUrl)?.replace(/\/+$/, "");

/**
 * workflowIds that have their own agent, per n8n base URL. The instance-level
 * agent skips them, so one failure opens one incident, while workflows nobody
 * registered stay covered. Paused agents still count: pausing one keeps it quiet.
 */
export function ownedWorkflows(agents: Agent[]): Map<string, Set<string>> {
  const owned = new Map<string, Set<string>>();
  for (const a of agents) {
    const base = baseOf(a.config ?? {});
    const workflowId = str(a.config?.workflowId);
    if (a.probe !== "n8n" || !base || !workflowId) continue;
    owned.set(base, (owned.get(base) ?? new Set()).add(workflowId));
  }
  return owned;
}

interface N8nExecution {
  id: string;
  status: string;
  startedAt: string | null;
  stoppedAt: string | null;
  workflowId: string;
  finished: boolean;
}

const FAILURE_STATES = new Set(["error", "crashed", "canceled"]);
// Not over yet: counted once, when they stop. A run that has merely started
// must never pass for a clean run (that would close a failure incident).
const PENDING_STATES = new Set(["new", "running", "waiting"]);

/**
 * config: { baseUrl, apiKeyEnv, workflowId? }
 *
 * With workflowId  -> that workflow: is it active, and what ran since last tick.
 * Without          -> instance-level: is n8n up, and did anything fail anywhere.
 *
 * Note this only works for instances Vercel can actually reach. An instance
 * behind a VPN must push to /api/ping/<token>/... instead.
 */
export async function probeN8n(
  config: Record<string, unknown>,
  sinceMs: number,
  owned: Map<string, Set<string>> = new Map(),
  untilMs = Infinity
): Promise<ProbeResult> {
  const baseUrl = baseOf(config);
  const apiKey = secret(config.apiKeyEnv);
  const workflowId = str(config.workflowId);

  if (!baseUrl) {
    return { ping_ok: false, latency_ms: null, message: "n8n probe needs baseUrl" };
  }

  let latency_ms: number | null = null;
  let message: string | undefined;
  let ping_ok = true;

  // With a dozen-plus workflows on one instance, a per-workflow /healthz call
  // would triple the traffic hitting the droplet every 5 minutes for no extra
  // signal — an unreachable instance fails the API call below just as loudly.
  // So only instance-level agents pay for the dedicated liveness check.
  if (!workflowId || !apiKey) {
    const health = await timedFetch(`${baseUrl}/healthz`);
    latency_ms = health.latency_ms;
    if (!health.ok) {
      return {
        ping_ok: false,
        latency_ms,
        message: health.error ?? `healthz HTTP ${health.status}`,
      };
    }
    if (!apiKey) {
      // Instance answers, but we cannot inspect runs.
      return { ping_ok: true, latency_ms, message: "no API key; liveness only" };
    }
  }

  const headers = { "x-n8n-api-key": apiKey };

  // Workflow-level: a disabled workflow is reported as degraded, not healthy —
  // silently-inactive automation is the exact failure this dashboard exists for.
  if (workflowId) {
    const wf = await timedFetch(
      `${baseUrl}/api/v1/workflows/${encodeURIComponent(workflowId)}`,
      { headers }
    );
    latency_ms = wf.latency_ms;
    if (wf.status === 0) {
      return { ping_ok: false, latency_ms, message: wf.error ?? "unreachable" };
    }
    if (wf.status === 404) {
      return { ping_ok: false, latency_ms, message: "workflow not found" };
    }
    if (wf.status === 401 || wf.status === 403) {
      return { ping_ok: false, latency_ms, message: "n8n API key rejected" };
    }
    const parsed = parseJson<{ active?: boolean; name?: string }>(wf.body);
    if (parsed && parsed.active === false) {
      ping_ok = false;
      message = "workflow is inactive";
    }
  }

  // Runs since the previous tick. The public API has no date filter, so pull a
  // page of recent executions and window them client-side. A single workflow
  // will not fire 30 times in 5 minutes; an instance-wide view might.
  const limit = typeof config.executionLimit === "number" ? config.executionLimit : workflowId ? 30 : 100;
  const qs = new URLSearchParams({ limit: String(limit) });
  if (workflowId) qs.set("workflowId", workflowId);

  const ex = await timedFetch(`${baseUrl}/api/v1/executions?${qs.toString()}`, {
    headers,
  });

  if (ex.status === 401 || ex.status === 403) {
    return { ping_ok: false, latency_ms, message: "n8n API key rejected" };
  }

  // An answer we cannot read is a failed check, never "nothing ran".
  const rows = ex.ok ? parseJson<{ data?: N8nExecution[] }>(ex.body)?.data : undefined;
  if (!Array.isArray(rows)) {
    return {
      ping_ok: false,
      latency_ms,
      message: ex.ok
        ? `executions response unreadable${ex.error ? ` (${ex.error})` : ""}`
        : ex.error ?? `executions HTTP ${ex.status}`,
    };
  }

  const skip = workflowId ? undefined : owned.get(baseUrl);
  let ran = 0;
  let failed = 0;
  for (const r of rows) {
    if (skip?.has(String(r.workflowId))) continue;
    const status = (r.status ?? "").toLowerCase();
    if (PENDING_STATES.has(status)) continue;
    // Window on when the run ended, so a long run that fails after the
    // window it started in still counts.
    const at = Date.parse(r.stoppedAt ?? r.startedAt ?? "");
    if (!Number.isFinite(at) || at < sinceMs || at >= untilMs) continue;
    ran += 1;
    if (FAILURE_STATES.has(status)) failed += 1;
  }

  if (failed > 0) {
    ping_ok = false;
    message = `${failed} failed execution${failed === 1 ? "" : "s"}`;
  }

  return { ping_ok, latency_ms, ran, failed, message };
}
