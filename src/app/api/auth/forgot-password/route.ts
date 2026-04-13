import { NextRequest, NextResponse } from "next/server";
import { createResetToken } from "@/lib/db";
import { sendResetEmail } from "@/lib/otp";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/rate-limit";

const CMS_BASE_URL = process.env.CMS_BASE_URL ?? "https://cms.enrichco.us";

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

  const { email } = await request.json().catch(() => null);

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Always return 200 — prevents email enumeration
  try {
    const token = createResetToken(normalizedEmail);
    const resetUrl = `${CMS_BASE_URL}/reset-password?token=${token}`;
    await sendResetEmail(normalizedEmail, token, resetUrl);
    return NextResponse.json({
      message: "If an account with that email exists, we've sent a password reset link.",
    });
  } catch (err) {
    console.error("[auth/forgot-password] Unexpected error:", err);
    return NextResponse.json({ error: "Something went wrong — please try again later" }, { status: 500 });
  }
}
