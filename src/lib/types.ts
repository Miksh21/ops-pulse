// Free-form: whatever buckets you group agents into (a client, a team, a side project).
export type Project = string;
export type AgentKind = "pull" | "push";
export type ProbeName = "vercel" | "n8n" | "supabase" | "lemlist" | "http";

export interface Agent {
  id: string;
  slug: string;
  name: string;
  project: Project;
  platform: string;
  kind: AgentKind;
  probe: ProbeName;
  config: Record<string, unknown>;
  ping_token: string;
  expected_every_min: number | null;
  paused: boolean;
  sort_order: number;
}

export interface Tick {
  bucket: string;
  ping_ok: boolean | null;
  ran: number;
  failed: number;
  latency_ms: number | null;
}

export interface OpsEvent {
  id: number;
  at: string;
  kind: string;
  message: string | null;
}

export type Health = "operational" | "degraded" | "down" | "paused" | "unknown";

export interface AgentView extends Agent {
  ticks: Tick[];
  events: OpsEvent[];
  health: Health;
  last_ping_at: string | null;
  last_run_at: string | null;
  success_rate: number | null;
}

export interface DashboardPayload {
  agents: AgentView[];
  buckets: string[];
  driver: {
    last_run_at: string | null;
    stalled: boolean;
    minutes_since: number | null;
  };
  generated_at: string;
}

/** Result a probe hands back to the tick writer. */
export interface ProbeResult {
  ping_ok: boolean;
  latency_ms: number | null;
  /** Runs observed since the previous tick. */
  ran?: number;
  failed?: number;
  message?: string;
  detail?: Record<string, unknown>;
}
