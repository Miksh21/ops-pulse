// Self-check for src/lib/schedule.ts. Run:
//   node --experimental-strip-types scripts/check-schedule.ts
import assert from "node:assert/strict";
import { lastDue } from "../src/lib/schedule.ts";

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

console.log("schedule: all checks passed");
