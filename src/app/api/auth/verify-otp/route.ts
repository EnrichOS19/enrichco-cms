import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import {
  createSession, verifyOtp, getOtpPayload, getEffectiveRole, upsertUserOnLogin,
  trustDevice, SESSION_TTL_REMEMBER, SESSION_TTL_SECONDS, DEVICE_TTL_SECONDS,
} from "@/lib/db";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const rl = checkRateLimit(`otp:${ip}`, { limit: 5, windowSec: 60 });
  if (!rl.allowed) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "Too many attempts — please wait a moment" }, { status: 429 }),
      rl
    );
  }

  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.code) {
    return NextResponse.json({ error: "Email and code are required" }, { status: 400 });
  }

  const { email, code, rememberMe, trustBrowser } = body;

  // Verify OTP
  const valid = verifyOtp(email.toLowerCase(), code.trim());
  if (!valid) {
    return NextResponse.json({ error: "Invalid or expired code — please try again" }, { status: 401 });
  }

  // Get IMS payload
  const imsPayload = getOtpPayload(email.toLowerCase());
  if (!imsPayload) {
    return NextResponse.json({ error: "Session expired — please log in again" }, { status: 401 });
  }

  // Resolve role and upsert user
  const effectiveRole = getEffectiveRole(email.toLowerCase(), imsPayload.role);
  upsertUserOnLogin(email.toLowerCase(), effectiveRole);

  // Create session (30 days if "keep me logged in", else 8 hours)
  const remember = rememberMe === true;
  const sessionId = createSession(email.toLowerCase(), effectiveRole, remember);
  const sessionMaxAge = remember ? SESSION_TTL_REMEMBER : SESSION_TTL_SECONDS;

  const response = NextResponse.json({
    ok: true,
    email: email.toLowerCase(),
    role: effectiveRole,
  });

  // Session cookie
  response.cookies.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: sessionMaxAge,
    path: "/",
  });

  // Trust this browser — skip OTP on future logins (90 days)
  if (trustBrowser === true) {
    const deviceToken = trustDevice(email.toLowerCase());
    response.cookies.set("cms-device", deviceToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: DEVICE_TTL_SECONDS,
      path: "/",
    });
  }

  return response;
}
