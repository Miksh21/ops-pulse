"use client";

import { useMemo } from "react";
import type { Tick } from "@/lib/types";
import { clockTime } from "@/lib/format";

type CellKind = "fail" | "ran" | "ok" | "idle";

const CELL_COLOR: Record<CellKind, string> = {
  fail: "var(--fail)",
  ran: "var(--ran)",
  ok: "var(--ok)",
  idle: "var(--idle)",
};

function classify(tick: Tick | undefined): CellKind {
  if (!tick) return "idle";
  if (tick.failed > 0 || tick.ping_ok === false) return "fail";
  if (tick.ran > 0) return "ran";
  if (tick.ping_ok === true) return "ok";
  return "idle";
}

function describe(bucket: string, tick: Tick | undefined): string {
  const at = clockTime(bucket);
  if (!tick) return `${at} — no data`;
  const bits: string[] = [];
  if (tick.ping_ok === true) bits.push("check passed");
  if (tick.ping_ok === false) bits.push("check failed");
  if (tick.ran > 0) bits.push(`${tick.ran} run${tick.ran === 1 ? "" : "s"}`);
  if (tick.failed > 0) bits.push(`${tick.failed} failed`);
  if (tick.latency_ms !== null) bits.push(`${tick.latency_ms}ms`);
  return `${at} — ${bits.join(", ") || "no data"}`;
}

/**
 * 48 cells x 5 minutes = the trailing 4 hours, one column per tick.
 * Rendered against the canonical bucket list so every row lines up in time
 * even when an agent has gaps.
 */
export function TickGrid({ buckets, ticks }: { buckets: string[]; ticks: Tick[] }) {
  const byBucket = useMemo(() => {
    const map = new Map<string, Tick>();
    for (const t of ticks) map.set(t.bucket, t);
    return map;
  }, [ticks]);

  return (
    <div className="mt-2">
      <div className="flex gap-[2px]" role="img" aria-label="Last 4 hours of checks">
        {buckets.map((bucket) => {
          const tick = byBucket.get(bucket);
          const kind = classify(tick);
          return (
            <div
              key={bucket}
              title={describe(bucket, tick)}
              className="h-6 flex-1 rounded-[2px] transition-opacity hover:opacity-70"
              style={{
                background: CELL_COLOR[kind],
                minWidth: 4,
                // Failures read as solid; healthy cells sit slightly back so a
                // red cell jumps out of a wall of green.
                opacity: kind === "idle" ? 1 : kind === "ok" ? 0.9 : 1,
              }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px]" style={{ color: "var(--muted-2)" }}>
        <div className="flex items-center gap-3">
          <Legend color="var(--ok)" label="ping" />
          <Legend color="var(--ran)" label="ran" />
          <Legend color="var(--fail)" label="fail" />
        </div>
        <div className="flex items-center gap-2">
          <span>4h ago</span>
          <span className="opacity-40">·</span>
          <span>now</span>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  );
}
