"use client";

import type { Health } from "@/lib/types";

const HEALTH_COLOR: Record<Health, string> = {
  operational: "var(--ok)",
  degraded: "var(--warn)",
  down: "var(--fail)",
  paused: "var(--muted-2)",
  unknown: "var(--muted-2)",
};

export const HEALTH_LABEL: Record<Health, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  paused: "Paused",
  unknown: "No data",
};

export function StatusDot({ health, live = false }: { health: Health; live?: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
        live && health === "operational" ? "live-dot" : ""
      }`}
      style={{ background: HEALTH_COLOR[health] }}
      aria-hidden
    />
  );
}

export function healthColor(health: Health) {
  return HEALTH_COLOR[health];
}

const PLATFORM: Record<string, { glyph: string; tint: string }> = {
  vercel: { glyph: "▲", tint: "#e6edf3" },
  n8n: { glyph: "⬡", tint: "#ea4b71" },
  clay: { glyph: "◆", tint: "#f6a04d" },
  supabase: { glyph: "⚡", tint: "#3ecf8e" },
  lemlist: { glyph: "✉", tint: "#7c8cff" },
  http: { glyph: "◇", tint: "#8b95a5" },
};

export function PlatformBadge({ platform }: { platform: string }) {
  const key = platform.toLowerCase();
  const meta = PLATFORM[key] ?? PLATFORM.http;
  const label = key === "n8n" ? "n8n" : platform[0].toUpperCase() + platform.slice(1);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--line)",
        color: "var(--muted)",
      }}
    >
      <span style={{ color: meta.tint }}>{meta.glyph}</span>
      {label}
    </span>
  );
}
