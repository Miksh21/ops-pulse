import type { ProbeResult } from "@/lib/types";
import { timedFetch, secret, str } from "./fetchers";

/**
 * Supabase liveness. Deliberately hits /auth/v1/health rather than the
 * PostgREST root: the root endpoint only accepts a service_role key, and a
 * monitor has no business holding one. GoTrue's health endpoint is happy with
 * the anon key and still proves the project, the gateway and the key are live.
 *
 * config: { url, apiKeyEnv, path? }
 */
export async function probeSupabase(
  config: Record<string, unknown>
): Promise<ProbeResult> {
  const url = str(config.url)?.replace(/\/+$/, "");
  const apiKey = secret(config.apiKeyEnv);
  if (!url) {
    return { ping_ok: false, latency_ms: null, message: "supabase probe needs url" };
  }
  if (!apiKey) {
    return { ping_ok: false, latency_ms: null, message: "supabase anon key missing" };
  }
  const path = str(config.path) ?? "/auth/v1/health";
  const res = await timedFetch(`${url}${path}`, { headers: { apikey: apiKey } });
  return {
    ping_ok: res.ok,
    latency_ms: res.latency_ms,
    message: res.ok ? undefined : res.error ?? `HTTP ${res.status}`,
  };
}

/**
 * lemlist uses HTTP Basic with an empty username and the API key as password.
 * config: { apiKeyEnv, path? }
 */
export async function probeLemlist(
  config: Record<string, unknown>
): Promise<ProbeResult> {
  const apiKey = secret(config.apiKeyEnv ?? "LEMLIST_API_KEY");
  if (!apiKey) {
    return { ping_ok: false, latency_ms: null, message: "lemlist API key missing" };
  }
  const path = str(config.path) ?? "/api/team";
  const auth = Buffer.from(`:${apiKey}`).toString("base64");
  const res = await timedFetch(`https://api.lemlist.com${path}`, {
    headers: { authorization: `Basic ${auth}` },
  });
  return {
    ping_ok: res.ok,
    latency_ms: res.latency_ms,
    message: res.ok ? undefined : res.error ?? `HTTP ${res.status}`,
  };
}

/**
 * Generic endpoint check — the escape hatch for anything without a first-class
 * probe. config: { url, method?, expectStatus?, headerEnv? }
 */
export async function probeHttp(
  config: Record<string, unknown>
): Promise<ProbeResult> {
  const url = str(config.url);
  if (!url) {
    return { ping_ok: false, latency_ms: null, message: "http probe needs url" };
  }
  const method = str(config.method) ?? "GET";
  const expect = typeof config.expectStatus === "number" ? config.expectStatus : null;

  const headers: Record<string, string> = {};
  const headerName = str(config.headerName);
  const headerValue = secret(config.headerEnv);
  if (headerName && headerValue) headers[headerName] = headerValue;

  const res = await timedFetch(url, { method, headers });
  const ping_ok = expect === null ? res.ok : res.status === expect;
  return {
    ping_ok,
    latency_ms: res.latency_ms,
    message: ping_ok ? undefined : res.error ?? `HTTP ${res.status}`,
  };
}
