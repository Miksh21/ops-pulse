"use client";

import type { AgentView } from "@/lib/types";
import { ago, pct } from "@/lib/format";
import { HEALTH_LABEL, PlatformBadge, StatusDot, healthColor } from "./atoms";
import { TickGrid } from "./TickGrid";

export function AgentRow({
  agent,
  buckets,
  selected,
  onSelect,
  now,
}: {
  agent: AgentView;
  buckets: string[];
  selected: boolean;
  onSelect: () => void;
  now: number;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full border-b px-5 py-4 text-left transition-colors"
      style={{
        borderColor: "var(--line-soft)",
        background: selected ? "var(--panel-2)" : "transparent",
        // A selected row gets a rail on the left rather than a fill change
        // alone, so the selection survives on a screen with poor contrast.
        boxShadow: selected ? "inset 3px 0 0 0 var(--ok-soft)" : "none",
        opacity: agent.paused ? 0.55 : 1,
      }}
    >
      <div className="flex items-start gap-2.5">
        <div className="pt-1">
          <StatusDot health={agent.health} live />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{agent.name}</span>
            <PlatformBadge platform={agent.platform} />
            {agent.kind === "push" && (
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px]"
                style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--muted-2)" }}
              >
                push
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--muted)" }}>
            <span style={{ color: healthColor(agent.health) }}>{HEALTH_LABEL[agent.health]}</span>
            <span>Last ping {ago(agent.last_ping_at, now)}</span>
            <span>Last run {ago(agent.last_run_at, now)}</span>
            <span>{pct(agent.success_rate)}</span>
          </div>

          <TickGrid buckets={buckets} ticks={agent.ticks} />
        </div>
      </div>
    </button>
  );
}
