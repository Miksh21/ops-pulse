/** Shared HTTP helpers for probes. Every probe must be bounded in time —
 *  one hanging endpoint should never eat the whole tick's budget. */

export const PROBE_TIMEOUT_MS = 8_000;

/** Parse input cap. A larger body is dropped whole, never cut: a cut JSON body
 *  fails to parse, and the n8n probe used to read that as "nothing ran". */
const MAX_BODY_CHARS = 2_000_000;

export interface TimedResponse {
  ok: boolean;
  status: number;
  latency_ms: number;
  body: string | null;
  error?: string;
}

export async function timedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<TimedResponse> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "user-agent": "ops-pulse/1.0 (+monitoring)",
        ...(init.headers ?? {}),
      },
    });
    let body: string | null = null;
    let error: string | undefined;
    try {
      const text = await res.text();
      if (text.length <= MAX_BODY_CHARS) body = text;
      else error = "response body over 2 MB";
    } catch {
      body = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      latency_ms: Date.now() - started,
      body,
      error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      latency_ms: Date.now() - started,
      body: null,
      error: message === "The operation was aborted." ? "timeout" : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function parseJson<T = unknown>(body: string | null): T | null {
  if (!body) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

/**
 * Secrets are referenced from agent config by env-var NAME, never stored in the
 * database. A leaked row therefore reveals what is monitored, not how to reach it.
 */
export function secret(envName: unknown): string | null {
  if (typeof envName !== "string" || !envName) return null;
  return process.env[envName] ?? null;
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
