/**
 * Next.js middleware — enforces authentication on all protected routes.
 *
 * Protected:
 *   - All /dashboard and /salon/* pages
 *   - GET/PUT  /api/salon/[slug]
 *   - GET      /api/salons
 *   - GET      /api/templates
 *   - POST     /api/upload
 *   - POST     /api/salon/[slug]/publish
 *   - POST     /api/salon/[slug]/switch-template   ← Phase 1D (Hermes BLOCKER 3)
 *
 * Public (no auth required):
 *   - /login
 *   - /api/auth/*   (login, logout, session)
 *
 * Behaviour:
 *   - Page request with no valid session → redirect to /login
 *   - API request with no valid session  → 401 JSON
 *   - CMS_AUTH_DISABLED=true            → pass all requests (local dev only)
 */

import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { getSession } from "@/lib/db";

// Routes that never require auth
const PUBLIC_PATHS = ["/login", "/api/auth/"];

// Matcher — run middleware on all routes except static assets
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Skip auth entirely in local dev mode
  if (process.env.CMS_AUTH_DISABLED === "***") {
    return NextResponse.next();
  }

  // Read session cookie and validate against DB
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? getSession(token) : null;

  if (!session) {
    const isApiRoute = pathname.startsWith("/api/");
    if (isApiRoute) {
      return NextResponse.json(
        { error: "Unauthorized — valid session required" },
        { status: 401 }
      );
    }
    // Redirect page requests to login
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Valid session — pass through
  return NextResponse.next();
}
