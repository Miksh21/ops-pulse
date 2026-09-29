// Self-check for src/lib/schedule.ts. Run:
//   node --experimental-strip-types scripts/check-schedule.ts
import assert from "node:assert/strict";
import { lastAwakeDue, lastDue } from "../src/lib/schedule.ts";

const due = (cron: string, tz: string, now: string) =>
  lastDue(cron, tz, new Date(now))?.toISOString() ?? null;

// */5: the latest multiple of five minutes, now included.
assert.equal(due("*/5 * * * *", "UTC", "2026-09-29T12:07:30Z"), "2026-09-29T12:05:00.000Z");
assert.equal(due("*/5 * * * *", "UTC", "2026-09-29T12:05:00Z"), "2026-09-29T12:05:00.000Z");

// Daily 05:30 in Prague is 03:30 UTC in summer time.
assert.equal(due("30 5 * * *", "Europe/Prague", "2026-09-29T04:00:00Z"), "2026-09-29T03:30:00.000Z");
assert.equal(due("30 5 * * *", "Europe/Prague", "2026-09-29T03:29:00Z"), "2026-09-28T03:30:00.000Z");

// Across the 2026-10-25 switch to winter time, 05:30 moves from 03:30Z to 04:30Z.
assert.equal(due("30 5 * * *", "Europe/Prague", "2026-10-25T04:29:00Z"), "2026-10-24T03:30:00.000Z");
assert.equal(due("30 5 * * *", "Europe/Prague", "2026-10-25T05:00:00Z"), "2026-10-25T04:30:00.000Z");

// A Mon-Fri job is not late on Saturday: the last due run is Friday's, so
// Friday's signal still covers it (the tick's rule: late = signal < due).
const saturday = due("30 5 * * 1-5", "Europe/Prague", "2026-10-03T10:00:00Z");
assert.equal(saturday, "2026-10-02T03:30:00.000Z");
assert.ok(Date.parse("2026-10-02T03:31:00Z") >= Date.parse(saturday!), "Saturday must not be late");

// Day-of-month and day-of-week both restricted: either matches. 7 is Sunday.
assert.equal(due("0 9 1 * 1", "UTC", "2026-09-30T12:00:00Z"), "2026-09-28T09:00:00.000Z"); // Monday
assert.equal(due("0 9 1 * 1", "UTC", "2026-10-01T12:00:00Z"), "2026-10-01T09:00:00.000Z"); // the 1st
assert.equal(due("0 12 * * 7", "UTC", "2026-10-05T00:00:00Z"), "2026-10-04T12:00:00.000Z");

// Nothing inside 8 days, and malformed input is an error, not a silent null.
assert.equal(due("0 0 1 1 *", "UTC", "2026-09-29T00:00:00Z"), null);
assert.throws(() => lastDue("61 * * * *", "UTC", new Date()));
assert.throws(() => lastDue("* * * *", "UTC", new Date()));
assert.throws(() => lastDue("* * * * *", "Mars/Olympus", new Date()));

// A laptop job is judged by awake minutes. Collector "*/30 9-17 * * 1-5",
// grace 90; the Pro was awake 09:00-17:02 and again from 19:22 (Prague, 2026-09-29).
const at = (s: string) => Date.parse(s);
const bucketsBetween = (from: string, to: string) => {
  const out: number[] = [];
  for (let t = at(from); t < at(to); t += 5 * 60_000) out.push(t);
  return out;
};
const pro = [...bucketsBetween("2026-09-29T07:00:00Z", "2026-09-29T15:05:00Z"), ...bucketsBetween("2026-09-29T17:20:00Z", "2026-09-29T17:30:00Z")];
const awakeDue = (now: string, awake = pro) =>
  lastAwakeDue("*/30 9-17 * * 1-5", "Europe/Prague", 90, awake, new Date(now))?.toISOString() ?? null;
// 19:25 Prague, three minutes after wake: 17:30 and 17:00 had no awake time to
// run in, so the run judged is 15:30, which the 16:58 signal covers: not late.
assert.equal(awakeDue("2026-09-29T17:25:00Z"), "2026-09-29T13:30:00.000Z");
// Awake all day and the job silent: the due run 90 awake minutes back is judged.
assert.equal(awakeDue("2026-09-29T12:00:00Z"), "2026-09-29T10:30:00.000Z");
// Asleep for 9 days: nothing inside the window qualifies, so nothing is judged.
assert.equal(awakeDue("2026-10-08T12:00:00Z", []), null);

console.log("schedule: all checks passed");
