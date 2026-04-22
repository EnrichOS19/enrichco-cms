/**
 * Story 1 — /api/auth/verify-otp route tests.
 *
 * Key requirement: when the OTP payload has role="salon_owner" (set by
 * the POS path in login/route.ts), the session must be created with
 * role="salon_owner" — not "support" (the prior default).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

process.env.CMS_AUTH_DISABLED = "false";

// ── DB mock ───────────────────────────────────────────────────────────────────
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    verifyOtp: vi.fn(() => true),
    getOtpPayload: vi.fn(() => ({ email: "owner@ntv.com", role: "salon_owner" })),
    getEffectiveRole: vi.fn((_email: string, imsRole?: string) => {
      if (imsRole === "salon_owner") return "salon_owner";
      if (imsRole === "admin") return "admin";
      return "support";
    }),
    upsertUserOnLogin: vi.fn(),
    createSession: vi.fn(() => "session-tok"),
    trustDevice: vi.fn(() => "device-tok"),
    SESSION_TTL_REMEMBER: 30 * 24 * 60 * 60,
    SESSION_TTL_SECONDS: 8 * 60 * 60,
    DEVICE_TTL_SECONDS: 90 * 24 * 60 * 60,
  };
});

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 4, resetAt: 0 })),
  withRateLimitHeaders: vi.fn((res: Response) => res),
}));

import { POST } from "@/app/api/auth/verify-otp/route";
import { verifyOtp, getOtpPayload, getEffectiveRole, createSession } from "@/lib/db";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/verify-otp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyOtp).mockReturnValue(true);
    vi.mocked(getOtpPayload).mockReturnValue({ email: "owner@ntv.com", role: "salon_owner" });
    vi.mocked(getEffectiveRole).mockImplementation((_email, imsRole) => {
      if (imsRole === "salon_owner") return "salon_owner";
      if (imsRole === "admin") return "admin";
      return "support";
    });
    vi.mocked(createSession).mockReturnValue("session-tok");
  });

  it("OTP with role=salon_owner in payload → session created as salon_owner", async () => {
    const res = await POST(makeRequest({ email: "owner@ntv.com", code: "123456" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.role).toBe("salon_owner");

    // createSession must have been called with salon_owner
    expect(createSession).toHaveBeenCalledWith(
      "owner@ntv.com",
      "salon_owner",
      expect.any(Boolean)
    );
  });

  it("OTP with role=support in payload → session created as support", async () => {
    vi.mocked(getOtpPayload).mockReturnValue({ email: "staff@enrichco.us", role: "support" });
    vi.mocked(getEffectiveRole).mockReturnValue("support");

    const res = await POST(makeRequest({ email: "staff@enrichco.us", code: "654321" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.role).toBe("support");
    expect(createSession).toHaveBeenCalledWith("staff@enrichco.us", "support", expect.any(Boolean));
  });

  it("wrong OTP code → 401", async () => {
    vi.mocked(verifyOtp).mockReturnValue(false);

    const res = await POST(makeRequest({ email: "owner@ntv.com", code: "000000" }));
    expect(res.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("missing email or code → 400", async () => {
    const res = await POST(makeRequest({ email: "owner@ntv.com" }));
    expect(res.status).toBe(400);
  });
});
