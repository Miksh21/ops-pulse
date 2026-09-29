import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

/** Constant-time compare so a wrong secret cannot be brute-forced by timing. */
export function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The tick driver and the write APIs are gated on a shared secret supplied
 * either as `x-ops-secret` or `?secret=`. Vercel Cron's own bearer header is
 * accepted too, so switching to native cron later needs no code change.
 */
export function isAuthorized(req: Request): boolean {
  const expected = process.env.OPS_TICK_SECRET;
  if (!expected) return false;

  const url = new URL(req.url);
  const header = req.headers.get("x-ops-secret");
  if (secretMatches(header, expected)) return true;

  const bearer = req.headers.get("authorization");
  if (bearer?.startsWith("Bearer ") && secretMatches(bearer.slice(7), expected)) {
    return true;
  }

  return secretMatches(url.searchParams.get("secret"), expected);
}

/**
 * The external dispatcher gets its own key, so that machine never holds the
 * tick secret: header only (a query string lands in logs), closed until the
 * key is configured. Returns the refusal to send, or null when allowed.
 */
export function dispatchDenied(req: Request): NextResponse | null {
  const expected = process.env.OPS_DISPATCH_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "OPS_DISPATCH_SECRET is not configured" }, { status: 503 });
  }
  return secretMatches(req.headers.get("x-ops-dispatch"), expected)
    ? null
    : NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
