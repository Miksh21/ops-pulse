import type { ProbeResult } from "@/lib/types";
import { timedFetch, parseJson, secret, str } from "./fetchers";

interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state?: string;
  readyState?: string;
  created: number;
}

/**
 * Two signals per Vercel project:
 *   ping  -> is the production alias actually serving?
 *   run   -> did a deployment finish (or fail) since the last tick?
 * A project can have a green deployment and a dead site, so we keep them apart.
 *
 * config: { projectId, prodUrl, teamId?, tokenEnv }
 */
export async function probeVercel(
  config: Record<string, unknown>,
  sinceMs: number
): Promise<ProbeResult> {
  const prodUrl = str(config.prodUrl);
  const projectId = str(config.projectId);
  const teamId = str(config.teamId);
  const token = secret(config.tokenEnv ?? "VERCEL_API_TOKEN");

  // 1. Is the deployed site up?
  let ping_ok = false;
  let latency_ms: number | null = null;
  let message: string | undefined;

  if (prodUrl) {
    const url = prodUrl.startsWith("http") ? prodUrl : `https://${prodUrl}`;
    const res = await timedFetch(url, { method: "GET" });
    latency_ms = res.latency_ms;
    // Any non-5xx means the app is serving. A 401 on a protected preview is
    // still "alive" for our purposes; a 500 or a timeout is not.
    ping_ok = res.status > 0 && res.status < 500;
    if (!ping_ok) message = res.error ?? `HTTP ${res.status}`;
  }

  // 2. Did any deployment complete in this window?
  let ran = 0;
  let failed = 0;
  if (token && projectId) {
    const qs = new URLSearchParams({
      projectId,
      limit: "10",
      target: "production",
    });
    if (teamId) qs.set("teamId", teamId);

    const res = await timedFetch(
      `https://api.vercel.com/v6/deployments?${qs.toString()}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    const body = parseJson<{ deployments?: VercelDeployment[] }>(res.body);
    const deployments = body?.deployments ?? [];

    for (const d of deployments) {
      if (typeof d.created !== "number" || d.created < sinceMs) continue;
      ran += 1;
      const state = (d.readyState ?? d.state ?? "").toUpperCase();
      if (state === "ERROR" || state === "CANCELED") failed += 1;
    }

    // Surface a broken latest build even when nothing deployed this tick.
    const latest = deployments[0];
    const latestState = (latest?.readyState ?? latest?.state ?? "").toUpperCase();
    if (latestState === "ERROR" && !message) {
      message = "latest production deployment errored";
    }
  } else if (!prodUrl) {
    return {
      ping_ok: false,
      latency_ms: null,
      message: "vercel probe needs prodUrl or projectId + token",
    };
  }

  return { ping_ok, latency_ms, ran, failed, message };
}
