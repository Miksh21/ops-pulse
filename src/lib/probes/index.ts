import type { Agent, ProbeResult } from "@/lib/types";
import { probeVercel } from "./vercel";
import { probeN8n } from "./n8n";
import { probeSupabase, probeLemlist, probeHttp } from "./misc";
import { BUCKET_MINUTES } from "@/lib/buckets";

export async function runProbe(agent: Agent, now = Date.now()): Promise<ProbeResult> {
  // Everything that happened since the previous tick belongs to this bucket.
  const sinceMs = now - BUCKET_MINUTES * 60_000;
  const config = agent.config ?? {};

  try {
    switch (agent.probe) {
      case "vercel":
        return await probeVercel(config, sinceMs);
      case "n8n":
        return await probeN8n(config, sinceMs);
      case "supabase":
        return await probeSupabase(config);
      case "lemlist":
        return await probeLemlist(config);
      case "http":
      default:
        return await probeHttp(config);
    }
  } catch (err) {
    // A probe throwing is itself a monitoring result, not a driver failure.
    return {
      ping_ok: false,
      latency_ms: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
