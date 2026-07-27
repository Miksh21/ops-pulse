export const BUCKET_MINUTES = 5;
export const WINDOW_BUCKETS = 48; // 48 x 5min = the 4h strip on each row

/** Floor a time to its 5-minute bucket, in UTC. */
export function bucketOf(d: Date | number = Date.now()): Date {
  const t = typeof d === "number" ? d : d.getTime();
  const ms = BUCKET_MINUTES * 60_000;
  return new Date(Math.floor(t / ms) * ms);
}

/** The last N bucket starts, oldest first, ending with the current bucket. */
export function recentBuckets(
  count = WINDOW_BUCKETS,
  from: Date = bucketOf()
): Date[] {
  const ms = BUCKET_MINUTES * 60_000;
  const out: Date[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(new Date(from.getTime() - i * ms));
  }
  return out;
}

export function bucketKey(d: Date | string): string {
  return (typeof d === "string" ? new Date(d) : d).toISOString();
}
