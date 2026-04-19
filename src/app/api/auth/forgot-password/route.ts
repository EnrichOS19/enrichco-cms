import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/rate-limit";

/**
 * Forgot-password is disabled at the endpoint level until the IMS
 * password-change API is wired up. Previously this route created a reset
 * token and emailed a link that pointed at `/reset-password`, but the
 * corresponding POST on that route has always returned 501 — so the token
 * was issued publicly and never consumable.
 *
 * Behavior now:
 *   - Rate-limit is retained (defense in depth).
 *   - No token is created. No email is sent.
 *   - Response is identical whether the email exists or not
 *     (no enumeration signal).
 *   - Body message tells the user to contact their admin.
 */
export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const rl = checkRateLimit(`forgot:${ip}`, { limit: 3, windowSec: 15 * 60 });
  if (!rl.allowed) {
    const res = NextResponse.json(
      { error: "Too many reset attempts — please wait 15 minutes before trying again" },
      { status: 429 }
    );
    return withRateLimitHeaders(res, rl);
  }

  const body = await request.json().catch(() => null);
  const email = body?.email;
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
  }

  return NextResponse.json({
    message:
      "Self-service password reset is not available yet. Please contact your CMS administrator to reset your password.",
  });
}
