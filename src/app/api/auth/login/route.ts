import { NextRequest, NextResponse } from "next/server";
import { storeOtp, isDeviceTrusted, createSession, getEffectiveRole, upsertUserOnLogin, SESSION_TTL_REMEMBER } from "@/lib/db";
import { COOKIE_NAME } from "@/lib/auth";
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

  // Parse IMS response body — IMS returns 200 for login results, 400 for validation errors
  let imsData: ImsAuthResponse;
  try {
    const raw = await imsRes.json();
    imsData = raw as ImsAuthResponse;

    // IMS 400 = validation error (e.g. password too short) — surface the actual message
    if (!imsRes.ok) {
      const validationErrors = (raw as Record<string, unknown>)?.errors as Record<string, string[]> | undefined;
      if (validationErrors) {
        const messages = Object.values(validationErrors).flat();
        return NextResponse.json(
          { error: messages[0] || "Validation error" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: raw?.message || "Invalid credentials" },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid response from authentication server" },
      { status: 502 }
    );
  }

  if (!imsData.return) {
    return NextResponse.json(
      { error: imsData.message || "Authentication failed" },
      { status: 401 }
    );
  }

  // ── Step 2: Determine role from IMS JWT ────────────────────────────────
  const role = decodeImsRole(imsData.token);
  const normalizedEmail = email.toLowerCase();

  // ── Step 2.5: Check if this browser is trusted — skip OTP if so ─────────
  const deviceToken = request.cookies.get("cms-device")?.value;
  if (deviceToken && isDeviceTrusted(deviceToken, normalizedEmail)) {
    // Trusted device — create session immediately, no OTP needed
    const effectiveRole = getEffectiveRole(normalizedEmail, role);
    upsertUserOnLogin(normalizedEmail, effectiveRole);
    const sessionId = createSession(normalizedEmail, effectiveRole, true);

    const response = NextResponse.json({
      step: "complete",
      email: normalizedEmail,
      role: effectiveRole,
    });

    response.cookies.set(COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_REMEMBER,
      path: "/",
    });

    return response;
  }

  // ── Step 3: Generate + store OTP ────────────────────────────────────────
  const code = generateOtp();
  storeOtp(normalizedEmail, code, { email: normalizedEmail, role });

  // ── Step 4: Send OTP email ───────────────────────────────────────────────
  const sent = await sendOtpEmail(normalizedEmail, code);

  if (!sent.ok) {
    console.error(`[auth/login] Failed to send OTP email to ${normalizedEmail}`);
  }

  return NextResponse.json(
    {
      step: "otp_required",
      email: normalizedEmail,
    },
    { status: 200 }
  );
}
