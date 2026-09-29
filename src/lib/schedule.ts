/**
 * Just enough cron to answer one question: when was a job last due?
 *
 * Five fields (minute hour day-of-month month day-of-week) with numbers, `*`,
 * lists, ranges and steps. Day-of-week is 0-7, 0 and 7 both Sunday. When
 * day-of-month and day-of-week are both restricted, either one matching is
 * enough (standard cron). Walking back minute by minute and reading the wall
 * clock through Intl makes daylight-saving changes a non-event.
 *
 * ponytail: minute walk, at most 11,520 Intl calls per agent per tick; skip by
 * hour or day if many scheduled agents ever make the tick slow. A schedule that
 * fires less than once in 8 days is never judged late.
 */

const LIMITS: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WINDOW_MINUTES = 8 * 24 * 60;

function parseField(src: string, index: number): Set<number> {
  const [min, max] = LIMITS[index];
  const values = new Set<number>();
  for (const part of src.split(",")) {
    const m = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`bad cron field "${src}"`);
    const [, star, a, b, s] = m;
    const step = s ? Number(s) : 1;
    const from = star ? min : Number(a);
    // "*" and "5/15" run to the end of the range; "5" is just itself.
    const to = star || (s && b === undefined) ? max : b !== undefined ? Number(b) : from;
    if (from < min || to > max || from > to || step < 1) {
      throw new Error(`bad cron field "${src}"`);
    }
    for (let v = from; v <= to; v += step) values.add(index === 4 ? v % 7 : v);
  }
  return values;
}

/** Latest minute at or before `now` that `cron` fires in `tz`; null if none in 8 days. Throws on a malformed cron or zone. */
export function lastDue(cron: string, tz: string, now: Date): Date | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron needs 5 fields: "${cron}"`);
  const [minute, hour, dom, month, dow] = fields.map((f, i) => parseField(f, i));
  const eitherDay = !fields[2].startsWith("*") && !fields[4].startsWith("*");

  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  });

  const start = Math.floor(now.getTime() / 60_000) * 60_000;
  for (let i = 0; i <= WINDOW_MINUTES; i++) {
    const t = start - i * 60_000;
    const p: Record<string, string> = {};
    for (const { type, value } of clock.formatToParts(t)) p[type] = value;
    if (!minute.has(Number(p.minute)) || !hour.has(Number(p.hour) % 24) || !month.has(Number(p.month))) {
      continue;
    }
    const domOk = dom.has(Number(p.day));
    const dowOk = dow.has(WEEKDAYS.indexOf(p.weekday));
    if (eitherDay ? domOk || dowOk : domOk && dowOk) return new Date(t);
  }
  return null;
}
