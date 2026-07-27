/** "2m ago", "3h ago", "just now" — matches the reference dashboard's phrasing. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const diff = now - Date.parse(iso);
  if (!Number.isFinite(diff)) return "never";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Locale and timezone are pinned deliberately. Left to the defaults, the server
 * renders in UTC (Vercel) with Node's ICU locale while the browser renders in
 * Europe/Prague — the two disagree and React throws a hydration mismatch on
 * every timestamp. Pinning both makes SSR and client output identical, and
 * shows the wall-clock time you actually work in (override with
 * NEXT_PUBLIC_OPS_TZ).
 */
const TZ = process.env.NEXT_PUBLIC_OPS_TZ || "Europe/Prague";

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  });
}

export function pct(value: number | null): string {
  if (value === null) return "— success";
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}% success`;
}
