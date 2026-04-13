import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, MAX_AGE } from "@/lib/auth";
import { createSession, verifyOtp, getOtpPayload } from "@/lib/db";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/rate-limit";

interface VerifyBody {
  email: string;
  code: string;
}

export async function POST(request: NextRequest) {
  // ── Rate limit: 5 OTP attempts per email per 60 seconds ──────────────────
  // Note: email not yet validated here — use IP as fallback
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  // After we parse the body we can use email as a tighter key
  const rl = checkRateLimit(`otp:${ip}`, { limit: 5, windowSec: 60 });
  if (!rl.allowed) {
    const res = NextResponse.json(
      { error: "Too many attempts — please wait a moment" },
      { status: 429 }
    );
    return withRateLimitHeaders(res, rl);
  }

  const body: VerifyBody = await request.json().catch(() => null);

  if (!body?.email || !body?.code) {
    return NextResponse.json(
      { error: "Email and code are required" },
      { status: 400 }
    );
  }

  const { email, code } = body;

  // ── Step 1: Verify OTP ──────────────────────────────────────────────────
  const valid = verifyOtp(email.toLowerCase(), code.trim());

  if (!valid) {
    return NextResponse.json(
      { error: "Invalid or expired code — please try again" },
      { status: 401 }
    );
  }

  // OTP is now consumed (single-use, marked used inside verifyOtp)

  // ── Step 2: Get the IMS role we stored at login time ────────────────────
  const imsPayload = getOtpPayload(email.toLowerCase());

  if (!imsPayload) {
    return NextResponse.json(
      { error: "Session expired — please log in again" },
      { status: 401 }
    );
  }

  const { role } = imsPayload;

  // ── Step 3: Create session ────────────────────────────────────────────────
  const sessionId = createSession(email.toLowerCase(), role);

  const response = NextResponse.json({
    ok: true,
    email: email.toLowerCase(),
    role,
  });

  response.cookies.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });

  return response;
}
