import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, MAX_AGE } from "@/lib/auth";
import { createSession } from "@/lib/db";

const IMS_AUTH_BASE =
  process.env.NEXT_PUBLIC_IMS_AUTH_URL ?? "https://imsnext-auth.enrichco.us";

interface ImsAuthResponse {
  return: boolean;
  message: string;
  token: string;
  refreshToken: string;
}

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  // ── Authenticate against IMS-AUTH ──
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
      { status: 502 },
    );
  }

  if (!imsRes.ok) {
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 },
    );
  }

  const imsData: ImsAuthResponse = await imsRes.json();

  if (!imsData.return) {
    return NextResponse.json(
      { error: imsData.message || "Authentication failed" },
      { status: 401 },
    );
  }

  // ── Determine role from IMS token ──
  // IMS token is a JWT — decode the payload to get the role claim
  let role = "support";
  try {
    const parts = imsData.token.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf-8")
      );
      // IMS uses 'role' or standard claim keys
      role =
        payload.role ||
        payload["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"] ||
        "support";
    }
  } catch {
    // Default to support if we can't decode role
    role = "support";
  }

  // ── Create server-side session (8h, revocable) ──
  const sessionId = createSession(email, role);

  const response = NextResponse.json({ ok: true, email, role });
  response.cookies.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });

  return response;
}
