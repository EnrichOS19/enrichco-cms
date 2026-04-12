/**
 * Legacy proxy helper — superseded by src/middleware.ts.
 * Kept for compatibility; middleware.ts is the authoritative auth gate.
 */
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { getSession } from "@/lib/db";

export async function proxy(request: NextRequest) {
  // Skip auth if disabled (local dev)
  if (process.env.CMS_AUTH_DISABLED === "***") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Public paths — no auth required
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    // Redirect logged-in users away from login page
    if (pathname === "/login") {
      const token = request.cookies.get(COOKIE_NAME)?.value;
      if (token && getSession(token)) {
        return NextResponse.redirect(new URL("/", request.url));
      }
    }
    return NextResponse.next();
  }

  // Protected paths — require valid session
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const session = getSession(token);
  if (!session) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(COOKIE_NAME);
    response.cookies.delete("cms-user");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
