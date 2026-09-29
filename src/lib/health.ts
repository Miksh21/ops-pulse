import type { Agent, Health, Tick } from "./types";
import { BUCKET_MINUTES } from "./buckets";

/**
 * Health is deliberately not "the last check failed".
 *
 * A single failed probe is usually a blip — a cold lambda, a slow DNS lookup,
 * a provider hiccup. Calling that "down" trains you to ignore the dashboard,
 * which is the only failure mode that actually matters for a monitor. So:
 *
 *   down       an open incident (a failed run, a late scheduled job, two failed
 *              checks in a row): red until the incident's own close rule clears
 *              it, never by decay; or a push agent that has gone silent for more
 *              than twice its expected interval
 *   degraded   the most recent check failed but the one before it passed
 *   operational everything else that has reported at all
 */
export function computeHealth(
  agent: Agent,
  ticks: Tick[],
  lastSignalAt: string | null,
  openIncident: boolean,
  now = Date.now()
): Health {
  if (agent.paused) return "paused";
  if (openIncident) return "down";

  if (agent.kind === "push") {
    const expected = agent.expected_every_min ?? 60;
    if (!lastSignalAt) return "unknown";
    // Lateness of a scheduled job is the tick's call (a 'late' incident); a
    // Mon-Fri job is silent all weekend without being down.
    if (agent.schedule_cron) return "operational";
    const silentMin = (now - Date.parse(lastSignalAt)) / 60_000;
    if (silentMin > expected * 2) return "down";
    if (silentMin > expected) return "degraded";
    return "operational";
  }

  // Newest first, ignoring buckets we simply have no data for.
  const reported = [...ticks]
    .filter((t) => t.ping_ok !== null)
    .sort((a, b) => Date.parse(b.bucket) - Date.parse(a.bucket));

  if (reported.length === 0) return "unknown";

  // Stale data must never render as green.
  const newest = Date.parse(reported[0].bucket);
  if (now - newest > BUCKET_MINUTES * 60_000 * 4) return "unknown";

  const [latest, previous] = reported;
  if (latest.ping_ok === false) {
    return previous && previous.ping_ok === false ? "down" : "degraded";
  }

  return "operational";
}

/** Share of reporting buckets in the window whose check passed. */
export function successRate(ticks: Tick[]): number | null {
  const reported = ticks.filter((t) => t.ping_ok !== null);
  if (reported.length === 0) return null;
  const ok = reported.filter((t) => t.ping_ok === true).length;
  return Math.round((ok / reported.length) * 1000) / 10;
}
