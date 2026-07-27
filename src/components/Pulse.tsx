"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentView, DashboardPayload, Health } from "@/lib/types";
import { ago } from "@/lib/format";
import { AgentRow } from "./AgentRow";
import { DetailPanel } from "./DetailPanel";
import { AddAgentDialog } from "./AddAgentDialog";

const REFRESH_MS = 30_000;

type Filter = "all" | "healthy" | "attention" | "paused";
// "all", or any project string present in the data.
type ProjectFilter = string;

export function Pulse({ initial }: { initial: DashboardPayload }) {
  const [data, setData] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Re-rendered on a timer so "2m ago" keeps counting between fetches, and
  // computed client-side only after mount to avoid a hydration mismatch.
  const [now, setNow] = useState(() => Date.parse(initial.generated_at));

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/agents", { cache: "no-store" });
      if (res.ok) {
        setData(await res.json());
        setNow(Date.now());
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const poll = setInterval(refresh, REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 20_000);
    setNow(Date.now());
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [refresh]);

  const counts = useMemo(() => {
    const c = { all: 0, healthy: 0, attention: 0, paused: 0 };
    for (const a of data.agents) {
      c.all += 1;
      if (a.paused) c.paused += 1;
      else if (a.health === "operational") c.healthy += 1;
      else c.attention += 1;
    }
    return c;
  }, [data.agents]);

  // Project chips come from the data, so the dashboard adopts whatever buckets
  // the agents are seeded with instead of a list hardcoded here.
  const projects = useMemo(
    () => ["all", ...Array.from(new Set(data.agents.map((a) => a.project))).sort()],
    [data.agents]
  );

  const visible = useMemo(() => {
    return data.agents.filter((a) => {
      if (projectFilter !== "all" && a.project !== projectFilter) return false;
      if (filter === "healthy") return !a.paused && a.health === "operational";
      if (filter === "attention") return !a.paused && a.health !== "operational";
      if (filter === "paused") return a.paused;
      return true;
    });
  }, [data.agents, filter, projectFilter]);

  const selected = data.agents.find((a) => a.id === selectedId) ?? null;

  async function mutate(agent: AgentView, action: "pause" | "remove") {
    if (action === "remove" && !confirm(`Remove "${agent.name}" and all its history?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/agents/${agent.id}`, {
        method: action === "remove" ? "DELETE" : "PATCH",
        headers: { "content-type": "application/json" },
        body: action === "remove" ? undefined : JSON.stringify({ paused: !agent.paused }),
      });
      if (action === "remove") setSelectedId(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="flex h-dvh flex-col" style={{ background: "var(--bg)" }}>
      <header
        className="flex flex-wrap items-center gap-3 px-5 py-3.5"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="live-dot inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: data.driver.stalled ? "var(--warn)" : "var(--ok)" }}
          />
          <h1 className="text-lg font-semibold">Pulse</h1>
          <span className="text-xs" style={{ color: "var(--muted-2)" }}>
            {counts.all} agent{counts.all === 1 ? "" : "s"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] sm:inline" style={{ color: "var(--muted-2)" }}>
            tick {ago(data.driver.last_run_at, now)}
          </span>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="rounded-md px-3 py-1.5 text-xs transition-opacity disabled:opacity-50"
            style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--text)" }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            onClick={() => setAdding(true)}
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{ background: "var(--ok-soft)", color: "#fff" }}
          >
            + Add Agent
          </button>
        </div>
      </header>

      {data.driver.stalled && (
        <div
          className="px-5 py-2.5 text-xs"
          style={{ background: "rgba(245,158,11,0.10)", borderBottom: "1px solid rgba(245,158,11,0.3)", color: "#fbbf24" }}
        >
          <strong>Tick driver stalled.</strong>{" "}
          {data.driver.last_run_at
            ? `Last tick ${ago(data.driver.last_run_at, now)} — the n8n driver is not calling /api/tick. Statuses below are stale.`
            : "No tick has ever run. Activate the n8n driver workflow, or call /api/tick manually."}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-1.5 px-5 py-2.5" style={{ borderBottom: "1px solid var(--line)" }}>
            <Chip active={filter === "all"} onClick={() => setFilter("all")} label={`All ${counts.all}`} />
            <Chip active={filter === "healthy"} onClick={() => setFilter("healthy")} label={`Healthy ${counts.healthy}`} tone="var(--ok)" />
            {counts.attention > 0 && (
              <Chip active={filter === "attention"} onClick={() => setFilter("attention")} label={`Needs attention ${counts.attention}`} tone="var(--fail)" />
            )}
            {counts.paused > 0 && (
              <Chip active={filter === "paused"} onClick={() => setFilter("paused")} label={`Paused ${counts.paused}`} />
            )}

            <span className="mx-1 h-4 w-px" style={{ background: "var(--line)" }} />

            {projects.map((p) => (
              <Chip
                key={p}
                active={projectFilter === p}
                onClick={() => setProjectFilter(p)}
                label={p === "all" ? "All projects" : p[0].toUpperCase() + p.slice(1)}
              />
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 && (
              <p className="px-5 py-10 text-center text-sm" style={{ color: "var(--muted-2)" }}>
                No agents match this filter.
              </p>
            )}
            {visible.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                buckets={data.buckets}
                selected={agent.id === selectedId}
                onSelect={() => setSelectedId(agent.id === selectedId ? null : agent.id)}
                now={now}
              />
            ))}
          </div>
        </div>

        {selected && (
          <div className="fixed inset-0 z-40 lg:static lg:z-auto lg:w-[380px] lg:shrink-0">
            <DetailPanel
              agent={selected}
              origin={origin}
              now={now}
              busy={busy}
              onClose={() => setSelectedId(null)}
              onPause={() => mutate(selected, "pause")}
              onRemove={() => mutate(selected, "remove")}
            />
          </div>
        )}
      </div>

      {adding && (
        <AddAgentDialog
          projects={projects.filter((p) => p !== "all")}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-2.5 py-1 text-[11px] transition-colors"
      style={{
        background: active ? "var(--panel-2)" : "transparent",
        border: `1px solid ${active ? "var(--line)" : "transparent"}`,
        color: active ? tone ?? "var(--text)" : "var(--muted-2)",
      }}
    >
      {label}
    </button>
  );
}

export type { Health };
