"use client";

import { useState } from "react";
import type { AgentView } from "@/lib/types";
import { ago, clockTime } from "@/lib/format";
import { HEALTH_LABEL, PlatformBadge, healthColor } from "./atoms";

const EVENT_STYLE: Record<string, { color: string; mark: string }> = {
  health_ok: { color: "var(--ok)", mark: "●" },
  health_fail: { color: "var(--fail)", mark: "●" },
  heartbeat: { color: "var(--ok)", mark: "●" },
  run_succeeded: { color: "var(--ran)", mark: "✓" },
  run_started: { color: "#a78bfa", mark: "▶" },
  run_failed: { color: "var(--fail)", mark: "✕" },
  paused: { color: "var(--muted-2)", mark: "‖" },
  resumed: { color: "var(--ok)", mark: "▶" },
};

export function DetailPanel({
  agent,
  origin,
  now,
  onClose,
  onPause,
  onRemove,
  busy,
}: {
  agent: AgentView;
  origin: string;
  now: number;
  onClose: () => void;
  onPause: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const pingBase = `${origin}/api/ping/${agent.ping_token}`;
  const activeUrl =
    (agent.config.prodUrl as string | undefined) ??
    (agent.config.url as string | undefined) ??
    (agent.config.baseUrl as string | undefined) ??
    null;

  const lastCheck = agent.events.find((e) => e.kind.startsWith("health"));

  return (
    <aside
      className="flex h-full flex-col overflow-y-auto"
      style={{ background: "var(--panel)", borderLeft: "1px solid var(--line)" }}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{agent.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
            <PlatformBadge platform={agent.platform} />
            <span className="opacity-40">·</span>
            <span className="capitalize">{agent.project}</span>
            <span className="opacity-40">·</span>
            <span>{agent.kind === "push" ? "Webhook" : "Polled"}</span>
            <span className="opacity-40">·</span>
            <span>5m</span>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="rounded p-1 text-lg leading-none transition-colors hover:opacity-70"
          style={{ color: "var(--muted)" }}
        >
          ×
        </button>
      </div>

      <div className="px-5 pt-4">
        <div
          className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium"
          style={{
            background: agent.health === "operational" ? "rgba(33,163,90,0.12)" : "rgba(239,68,68,0.10)",
            border: `1px solid ${agent.health === "operational" ? "rgba(33,163,90,0.35)" : "rgba(239,68,68,0.3)"}`,
            color: healthColor(agent.health),
          }}
        >
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: healthColor(agent.health) }} />
          {HEALTH_LABEL[agent.health]}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-5 pt-3">
        <Card label="Health check" value={lastCheck?.kind === "health_fail" ? "Failing" : agent.health === "unknown" ? "No data" : "Passing"} tone={lastCheck?.kind === "health_fail" ? "bad" : "good"} />
        <Card label="Last run" value={ago(agent.last_run_at, now)} />
      </div>

      <div className="grid grid-cols-2 gap-3 px-5 pt-3">
        <button
          onClick={onPause}
          disabled={busy}
          className="rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50"
          style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--text)" }}
        >
          {agent.paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={onRemove}
          disabled={busy}
          className="rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50"
          style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.35)", color: "#f87171" }}
        >
          Remove
        </button>
      </div>

      <Section title="Ping URLs" />

      {activeUrl && (
        <div className="px-5">
          <div
            className="rounded-lg px-3 py-2.5"
            style={{ background: "rgba(33,163,90,0.08)", border: "1px solid rgba(33,163,90,0.3)" }}
          >
            <div className="text-[10px] font-semibold tracking-wide" style={{ color: "var(--ok)" }}>
              ACTIVE MONITORING
            </div>
            <div className="mt-1 break-all font-mono text-[11px]" style={{ color: "var(--muted)" }}>
              {activeUrl}
            </div>
          </div>
        </div>
      )}

      <div className="mt-1 px-5">
        <CopyRow label="Heartbeat" url={`${pingBase}/heartbeat`} />
        <CopyRow label="Run OK" url={`${pingBase}/ok`} />
        <CopyRow label="Run Fail" url={`${pingBase}/fail`} />
      </div>

      <Section title="Recent activity" />

      <div className="px-5 pb-6">
        {agent.events.length === 0 && (
          <p className="text-xs" style={{ color: "var(--muted-2)" }}>
            Nothing recorded yet.
          </p>
        )}
        {agent.events.map((e) => {
          const style = EVENT_STYLE[e.kind] ?? { color: "var(--muted)", mark: "•" };
          return (
            <div key={e.id} className="flex items-center justify-between gap-3 py-[5px] text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <span style={{ color: style.color }}>{style.mark}</span>
                <span className="truncate" style={{ color: style.color }}>
                  {e.message ?? e.kind}
                </span>
              </span>
              <span className="shrink-0 tabular-nums" style={{ color: "var(--muted-2)" }}>
                {clockTime(e.at)}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function Section({ title }: { title: string }) {
  return (
    <div className="px-5 pb-2 pt-5 text-[10px] font-semibold tracking-widest" style={{ color: "var(--muted-2)" }}>
      {title.toUpperCase()}
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
      <div className="text-[10px] font-semibold tracking-wide" style={{ color: "var(--muted-2)" }}>
        {label.toUpperCase()}
      </div>
      <div
        className="mt-0.5 text-sm font-medium"
        style={{ color: tone === "bad" ? "var(--fail)" : tone === "good" ? "var(--ok)" : "var(--text)" }}
      >
        {value}
      </div>
    </div>
  );
}

function CopyRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API needs a secure context; fall back to a selectable prompt.
      window.prompt("Copy this URL", url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div
      className="flex items-center justify-between gap-3 border-b py-2.5"
      style={{ borderColor: "var(--line-soft)" }}
    >
      <span className="text-sm">{label}</span>
      <button
        onClick={copy}
        className="shrink-0 rounded-md px-2.5 py-1 text-[11px] transition-colors"
        style={{
          background: "var(--panel-2)",
          border: "1px solid var(--line)",
          color: copied ? "var(--ok)" : "var(--muted)",
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
