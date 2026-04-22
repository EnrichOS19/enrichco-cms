import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth/",
  "/api/health",
  "/guide",
  "/guide.html",
];

export function middleware(request: NextRequest) {
  // Skip auth check if disabled (local dev / test only — next.config.ts blocks in production)
  if (process.env.CMS_AUTH_DISABLED === "true") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Allow public paths
  for (const pub of PUBLIC_PATHS) {
    if (pathname === pub || pathname.startsWith(pub)) {
      return NextResponse.next();
    }
  }

  // Check for session cookie on all other routes
  const session = request.cookies.get("cms-session")?.value;
  if (!session) {
    // API routes get 401 JSON; pages get redirected
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized — valid session required" },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico, robots.txt, sitemap.xml (static files)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
  ],
};
