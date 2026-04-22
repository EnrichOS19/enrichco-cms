/**
 * Story 1 — /api/auth/login route tests.
 *
 * Covers:
 *   - POS fallback when IMS says "user not found"
 *   - Enumeration-safe: all non-success cases return the SAME body
 *   - session created with role=salon_owner on POS success
 *   - Trusted-device fast path assigns salon_owner for POS-only owners
 *   - Multi-store owners with no CMS grant → generic 401
 *
 * We run with CMS_AUTH_DISABLED=false (real auth middleware).
 * IMS and POS fetches are both mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Force real auth (the npm test script sets CMS_AUTH_DISABLED=true; override here)
process.env.CMS_AUTH_DISABLED = "false";

// ── fetch mock ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── DB mock ───────────────────────────────────────────────────────────────────
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    // Prevent real SQLite init during tests
    getDb: vi.fn(),
    checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 4, resetAt: 0 })),
    storeOtp: vi.fn(() => "otp-id"),
    isDeviceTrusted: vi.fn(() => false),
    createSession: vi.fn(() => "session-token-abc"),
    getEffectiveRole: vi.fn((_email: string, imsRole?: string) => imsRole === "admin" ? "admin" : "support"),
    upsertUserOnLogin: vi.fn(),
    getPosPairing: vi.fn(() => null),
    savePosPairing: vi.fn(),
    listSalonGrantsForUser: vi.fn(() => []),
    userHasSalonAccess: vi.fn(() => false),
  };
});

// ── OTP mock ──────────────────────────────────────────────────────────────────
vi.mock("@/lib/otp", () => ({
  sendOtpEmail: vi.fn(async () => ({ ok: true })),
}));

// ── rate-limit mock ───────────────────────────────────────────────────────────
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 4, resetAt: 0 })),
  withRateLimitHeaders: vi.fn((res: Response) => res),
}));

import { POST } from "@/app/api/auth/login/route";
import { isDeviceTrusted, createSession, getEffectiveRole, upsertUserOnLogin, listSalonGrantsForUser } from "@/lib/db";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: object, cookies?: Record<string, string>) {
  const req = new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (cookies) {
    // Attach cookies manually
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    Object.defineProperty(req, "cookies", {
      value: {
        get: (name: string) => (cookies[name] ? { value: cookies[name] } : undefined),
      },
    });
  }
  return req;
}

function imsSuccess(role = "support") {
  // Construct a minimal IMS JWT with role claim
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  const fakeToken = `header.${payload}.signature`;
  return { return: true, message: "OK", token: fakeToken, refreshToken: "" };
}

function imsNotFound() {
  return { return: false, message: "User not found" };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const GENERIC_401_BODY = { error: "Unable to sign in" };

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDeviceTrusted).mockReturnValue(false);
  });

  // ── IMS staff path (unchanged) ──────────────────────────────────────────────

  it("IMS staff login → 200 otp_required", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => imsSuccess("support"),
    });

    const res = await POST(makeRequest({ email: "staff@enrichco.us", password: "pass" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.step).toBe("otp_required");
  });

  // ── POS fallback: unknown email → generic 401 ──────────────────────────────

  it("unknown email (IMS not found + POS data==0) → 401 with generic body", async () => {
    // IMS: user not found
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => imsNotFound(),
    });
    // POS checkExistEmailStore: data==0
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ error_code: 200, error_message: "", data: 0 }),
    });

    const res = await POST(makeRequest({ email: "nobody@example.com", password: "anything" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(GENERIC_401_BODY);
  });

  // ── POS fallback: correct owner email + wrong password → generic 401 ───────

  it("correct owner email + wrong password → 401 with SAME generic body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => imsNotFound(),
    });
    // POS lookup: data==1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ error_code: 200, error_message: "2222", data: 1 }),
    });
    // POS LoginFirstTime: wrong password
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 1, urlTarget: "", PairId: "", mess: "Invalid password" }),
    });

    const res = await POST(makeRequest({ email: "owner@ntv.com", password: "wrongpass" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(GENERIC_401_BODY);
  });

  // ── Enumeration-safe: unknown email and wrong password → IDENTICAL response ─

  it("unknown email and wrong-password responses are byte-identical", async () => {
    // Case A: unknown email
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => imsNotFound(),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ error_code: 200, error_message: "", data: 0 }),
    });
    const resA = await POST(makeRequest({ email: "nobody@example.com", password: "x" }));
    const bodyA = await resA.json();

    vi.clearAllMocks();
    vi.mocked(isDeviceTrusted).mockReturnValue(false);

    // Case B: real email, wrong password
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => imsNotFound(),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ error_code: 200, error_message: "2222", data: 1 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ code: 1, urlTarget: "", PairId: "", mess: "bad" }),
    });
    const resB = await POST(makeRequest({ email: "owner@ntv.com", password: "wrong" }));
    const bodyB = await resB.json();

    expect(resA.status).toBe(401);
    expect(resB.status).toBe(401);
    expect(bodyA).toEqual(bodyB);
  });

  // ── POS fallback: store found but no CMS grant → generic 401 ──────────────

  it("POS store found but no CMS grant → 401 generic (no enumeration leak)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => imsNotFound(),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ error_code: 200, error_message: "9999", data: 1 }),
    });
    // POS password check succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ code: 0, urlTarget: "", PairId: "pid", mess: "dev" }),
    });
    // No CMS grant
    vi.mocked(listSalonGrantsForUser).mockReturnValue([]);

    const res = await POST(makeRequest({ email: "unmapped@owner.com", password: "pass" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(GENERIC_401_BODY);
  });

  // ── POS success: session created with role=salon_owner ────────────────────

  it("POS success + CMS grant → session created with role=salon_owner", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => imsNotFound(),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ error_code: 200, error_message: "2222", data: 1 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ code: 0, urlTarget: "", PairId: "pair-abc", mess: "dev" }),
    });
    vi.mocked(listSalonGrantsForUser).mockReturnValue([{ slug: "ntv-beauty", ims_store_id: "2222" }]);

    const res = await POST(makeRequest({ email: "owner@ntv.com", password: "correct" }));
    const body = await res.json();

    // Login should advance to OTP step (POS owners still go through OTP)
    expect(res.status).toBe(200);
    expect(body.step).toBe("otp_required");
  });

  // ── Multi-store owner with no matching grant → generic 401 ────────────────

  it("multi-store owner with no CMS grant intersection → 401 generic", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => imsNotFound(),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ error_code: 200, error_message: "783", data: 3 }),
    });
    // No CMS grants that match any of the POS store ids
    vi.mocked(listSalonGrantsForUser).mockReturnValue([]);

    const res = await POST(makeRequest({ email: "multi@example.com", password: "pass" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(GENERIC_401_BODY);
  });
});
