import { NextResponse, type NextRequest } from "next/server";

/**
 * Vercel's own password protection is a Pro feature, and this dashboard is a
 * map of every project, workflow and endpoint you run — not something to leave
 * on a guessable public URL. So the whole app is gated on a shared key.
 *
 * Open it once as  https://<host>/?k=<OPS_DASHBOARD_KEY>  and the key is stored
 * in an httpOnly cookie; after that the bare URL works.
 *
 * Deliberately NOT gated:
 *   /api/tick       carries its own OPS_TICK_SECRET
 *   /api/ping/*     the URL token IS the credential, and monitored jobs cannot
 *                   hold a browser cookie
 *   /api/incidents  carries its own OPS_DISPATCH_SECRET (external dispatcher)
 *   /api/push/*     carries a client's bearer token (ops.client_tokens)
 */
const OPEN_PATHS = [
  /^\/api\/tick(?:\/|$)/,
  /^\/api\/ping\//,
  /^\/api\/push\//,
  /^\/api\/incidents(?:\/|$)/,
];

const COOKIE = "ops_key";

/** Length-independent constant-time compare; Edge runtime has no timingSafeEqual. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  if (OPEN_PATHS.some((re) => re.test(pathname))) return NextResponse.next();

  const expected = process.env.OPS_DASHBOARD_KEY;
  // Fail closed: an unset key means nobody gets in, rather than everybody.
  if (!expected) {
    return new NextResponse("OPS_DASHBOARD_KEY is not configured", { status: 503 });
  }

  const fromQuery = searchParams.get("k");
  if (fromQuery && safeEqual(fromQuery, expected)) {
    // Drop the key from the visible URL so it does not linger in history,
    // screenshots or a shared link.
    const clean = req.nextUrl.clone();
    clean.searchParams.delete("k");
    const res = NextResponse.redirect(clean);
    res.cookies.set(COOKIE, expected, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
    return res;
  }

  const cookie = req.cookies.get(COOKIE)?.value;
  if (cookie && safeEqual(cookie, expected)) return NextResponse.next();

  return new NextResponse("Not found", { status: 404 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
