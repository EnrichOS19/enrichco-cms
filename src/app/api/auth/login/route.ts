import { NextRequest, NextResponse } from "next/server";
import { storeOtp } from "@/lib/db";
import { sendOtpEmail } from "@/lib/otp";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/rate-limit";
import crypto from "crypto";

const IMS_AUTH_BASE = process.env.IMS_AUTH_URL ?? "https://imsnext-auth.enrichco.us";

interface ImsAuthResponse {
  return: boolean;
  message: string;
  token: string;
  refreshToken: string;
}

function generateOtp(): string {
  // 6-digit code: 000000–999999
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function decodeImsRole(token: string): string {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return "support";
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );
    return (
      payload.role ||
      payload["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"] ||
      "support"
    );
  } catch {
    return "support";
  }
}

export async function POST(request: NextRequest) {
  // ── Rate limit: 5 attempts per IP per 60 seconds ─────────────────────────
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  const rl = checkRateLimit(`login:${ip}`, { limit: 5, windowSec: 60 });
  if (!rl.allowed) {
    const res = NextResponse.json(
      { error: "Too many login attempts — please wait a moment" },
      { status: 429 }
    );
    return withRateLimitHeaders(res, rl);
  }

  const { email, password } = await request.json();

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  // ── Step 1: Authenticate against IMS-AUTH ────────────────────────────────
  let imsRes: Response;
  try {
    imsRes = await fetch(`${IMS_AUTH_BASE}/api/Authentication/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to reach authentication server" },
      { status: 502 }
    );
  }

  if (!imsRes.ok) {
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 }
    );
  }

  const imsData: ImsAuthResponse = await imsRes.json();

  if (!imsData.return) {
    return NextResponse.json(
      { error: imsData.message || "Authentication failed" },
      { status: 401 }
    );
  }

  // ── Step 2: Determine role from IMS JWT ────────────────────────────────
  const role = decodeImsRole(imsData.token);
  const normalizedEmail = email.toLowerCase();

  // ── Step 3: Generate + store OTP ────────────────────────────────────────
  const code = generateOtp();
  storeOtp(normalizedEmail, code, { email: normalizedEmail, role });

  // ── Step 4: Send OTP email ───────────────────────────────────────────────
  const sent = await sendOtpEmail(normalizedEmail, code);

  if (!sent.ok) {
    // Log but don't block — user can still enter the code from console in dev
    console.error(`[auth/login] Failed to send OTP email to ${normalizedEmail}`);
  }

  // In console (dev) mode, include the code so testers can see it
  return NextResponse.json(
    {
      step: "otp_required",
      email: normalizedEmail,
      ...(sent.provider === "console" && sent.code
        ? { _debug_code: sent.code }
        : {}),
    },
    { status: 200 }
  );
}
