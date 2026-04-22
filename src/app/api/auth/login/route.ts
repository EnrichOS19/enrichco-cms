import { NextRequest, NextResponse } from "next/server";
import { storeOtp, isDeviceTrusted, createSession, getEffectiveRole, upsertUserOnLogin, SESSION_TTL_REMEMBER, listSalonGrantsForUser } from "@/lib/db";
import { COOKIE_NAME } from "@/lib/auth";
import { sendOtpEmail } from "@/lib/otp";
import { checkRateLimit, withRateLimitHeaders } from "@/lib/rate-limit";
import { lookupStoreByEmail, verifyPosPassword } from "@/lib/posAuth";
import crypto from "crypto";

const IMS_AUTH_BASE = process.env.IMS_AUTH_URL ?? "https://imsnext-auth.enrichco.us";

/** Generic error returned for ALL non-success auth paths — no enumeration. */
const GENERIC_AUTH_FAILURE = { error: "Unable to sign in" } as const;

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

  const normalizedEmail = email.toLowerCase();

  // ── Step 1: Try IMS auth (staff path) ────────────────────────────────────
  let imsData: ImsAuthResponse | null = null;
  let imsAuthSuccess = false;

  try {
    const imsRes = await fetch(`${IMS_AUTH_BASE}/api/Authentication/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (imsRes.ok) {
      const raw = await imsRes.json();
      imsData = raw as ImsAuthResponse;

      if (!imsRes.ok) {
        // IMS validation error — surface it
        const validationErrors = (raw as Record<string, unknown>)?.errors as Record<string, string[]> | undefined;
        if (validationErrors) {
          const messages = Object.values(validationErrors).flat();
          return NextResponse.json(
            { error: messages[0] || "Validation error" },
            { status: 400 }
          );
        }
      }

      if (imsData && imsData.return === true) {
        imsAuthSuccess = true;
      }
    } else {
      // IMS non-200 — try to parse but don't surface internal errors
      const raw = await imsRes.json().catch(() => ({}));
      imsData = raw as ImsAuthResponse;
    }
  } catch {
    // Network failure reaching IMS — fall through to POS path
  }

  // ── Step 2a: IMS success → staff flow ────────────────────────────────────
  if (imsAuthSuccess && imsData) {
    const role = decodeImsRole(imsData.token);

    // Check trusted device — skip OTP if trusted
    const deviceToken = request.cookies.get("cms-device")?.value;
    if (deviceToken && isDeviceTrusted(deviceToken, normalizedEmail)) {
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

    // OTP step
    const code = generateOtp();
    storeOtp(normalizedEmail, code, { email: normalizedEmail, role });
    const sent = await sendOtpEmail(normalizedEmail, code);
    if (!sent.ok) {
      console.error(`[auth/login] Failed to send OTP email to ${normalizedEmail}`);
    }
    return NextResponse.json({ step: "otp_required", email: normalizedEmail }, { status: 200 });
  }

  // ── Step 2b: IMS failed — try POS fallback ────────────────────────────────
  // All failures below return the same generic 401 (enumeration-safe).

  const storeInfo = await lookupStoreByEmail(normalizedEmail);
  if (!storeInfo) {
    return NextResponse.json(GENERIC_AUTH_FAILURE, { status: 401 });
  }

  // For multi-store owners: find a storeId that intersects with CMS grants
  const grants = listSalonGrantsForUser(normalizedEmail);
  let targetStoreId: string;

  if (storeInfo.count === 1) {
    targetStoreId = storeInfo.storeId;
  } else {
    // Multi-store: need a grant with matching ims_store_id
    // If POS returns the first storeId, try it; otherwise need intersection
    const grantedStoreIds = grants
      .map(g => g.ims_store_id)
      .filter((id): id is string => id !== null && id !== undefined);

    // Use the storeId from checkExistEmailStore as a candidate
    if (grantedStoreIds.length === 0) {
      return NextResponse.json(GENERIC_AUTH_FAILURE, { status: 401 });
    }
    // Use first intersecting grant's storeId
    targetStoreId = grantedStoreIds[0];
  }

  // Verify password via POS
  const posResult = await verifyPosPassword({
    email: normalizedEmail,
    password,
    storeId: targetStoreId,
    deviceName: "CMS-Web",
  });

  if (!posResult.ok) {
    return NextResponse.json(GENERIC_AUTH_FAILURE, { status: 401 });
  }

  // Check CMS grant exists for the verified storeId
  // For single-store: accept any grant (admin assigns ims_store_id during onboarding)
  // For multi-store: must have matching ims_store_id
  const hasGrant = storeInfo.count === 1
    ? grants.length > 0
    : grants.some(g => g.ims_store_id === posResult.storeId);

  if (!hasGrant) {
    return NextResponse.json(GENERIC_AUTH_FAILURE, { status: 401 });
  }

  // POS owner authenticated — send OTP with salon_owner role
  const code = generateOtp();
  storeOtp(normalizedEmail, code, { email: normalizedEmail, role: "salon_owner" });
  const sent = await sendOtpEmail(normalizedEmail, code);
  if (!sent.ok) {
    console.error(`[auth/login] Failed to send OTP email to POS owner ${normalizedEmail}`);
  }

  return NextResponse.json({ step: "otp_required", email: normalizedEmail }, { status: 200 });
}
