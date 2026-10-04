import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Cheap edge gate: anyone without a session cookie is bounced to /login before a
 * page renders. This is presence-only (no DB at the edge). Pages and APIs that
 * matter still validate the session with getCurrentUser and set ownership. The
 * auth routes and Next internals stay public.
 */
// "/" is the public marketing landing; the app (create at /crea, /courses, …)
// stays gated. Adding "/" here matches the root exactly (never as a prefix).
const PUBLIC_PREFIXES = ["/", "/login", "/register", "/api/auth", "/invito"];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  if (req.cookies.has("ferrata_session")) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next internals, static assets, and the three upload routes.
  //
  // A route behind middleware has its body copied for the middleware to read, and
  // Next stops copying at 10 MB: anything larger arrives truncated, and a course
  // built from three 4 MB documents failed with "Error 400". The documented
  // limits (10 MB a file, 50 MB a request) could not be reached. These routes
  // check the session themselves before they read a byte, which is what the
  // comment at the top of this file says every route that matters does.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico)$|api/courses$|api/courses/[^/]+/sources$|api/import(?:/preview)?$).*)",
  ],
};
