/**
 * Story 4 — IMS lookup API tests.
 *
 * Tests the GET /api/admin/ims-lookup?email= route handler in isolation.
 * Mocks global fetch so no real IMS network calls are made.
 *
 * TDD: red first — run before imsLookup route exists to confirm failure,
 *      then implement until green.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// ── fetch mock ───────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── auth mock — must come before route import ────────────────────────────────
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireAdmin: vi.fn(),
  };
});

import { GET, _resetCaches } from "@/app/api/admin/ims-lookup/route";
import { requireAdmin } from "@/lib/auth";
import type { Session } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// ── helpers ──────────────────────────────────────────────────────────────────

const ADMIN_SESSION: Session = { id: "sess-admin", email: "admin@enrichco.us", role: "admin" };
const OWNER_SESSION: Session = { id: "sess-owner", email: "owner@salon.com", role: "salon_owner" };

function makeAdminAuth(session = ADMIN_SESSION) {
  vi.mocked(requireAdmin).mockResolvedValue({ session });
}

function makeNonAdminAuth() {
  vi.mocked(requireAdmin).mockResolvedValue({
    response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
  });
}

function makeRequest(email: string): NextRequest {
  return new NextRequest(`http://localhost/api/admin/ims-lookup?email=${encodeURIComponent(email)}`);
}

/** IMS ListMerchants response with a matching merchant */
function imsPageWithMatch(email: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        {
          email,
          firstName: "Nathan",
          lastName: "Tran",
          businessName: "NTV Beauty Studio",
          storeID: 2222,
        },
        {
          email: "other@example.com",
          firstName: "Other",
          lastName: "Owner",
          businessName: "Other Salon",
          storeID: 9999,
        },
      ],
      total: 2,
    }),
    text: async () => "",
  } as unknown as Response;
}

/** IMS ListMerchants response with no records */
function imsEmptyPage() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: [], total: 0 }),
    text: async () => "",
  } as unknown as Response;
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("GET /api/admin/ims-lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCaches();
    // Default: set env vars so the route doesn't return the unconfigured warning
    process.env.IMS_SERVICE_EMAIL = "service@enrichco.us";
    process.env.IMS_SERVICE_PASSWORD = "service-password";
    process.env.IMS_PORTAL_URL = "https://imsnext-portal.enrichco.us";
    process.env.IMS_AUTH_URL = "https://imsnext-auth.enrichco.us";
  });

  afterEach(() => {
    delete process.env.IMS_SERVICE_EMAIL;
    delete process.env.IMS_SERVICE_PASSWORD;
    delete process.env.IMS_PORTAL_URL;
    delete process.env.IMS_AUTH_URL;
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  it("returns 403 for non-admin callers", async () => {
    makeNonAdminAuth();
    const req = makeRequest("owner@ntv.com");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when email query param is missing", async () => {
    makeAdminAuth();
    const req = new NextRequest("http://localhost/api/admin/ims-lookup");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  // ── IMS not configured ────────────────────────────────────────────────────

  it("returns found:false with warning when IMS env vars are missing", async () => {
    delete process.env.IMS_SERVICE_EMAIL;
    delete process.env.IMS_SERVICE_PASSWORD;
    makeAdminAuth();
    const req = makeRequest("someone@example.com");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.warning).toMatch(/not configured/i);
  });

  // ── IMS auth step ─────────────────────────────────────────────────────────

  it("returns found:false gracefully when IMS auth fails", async () => {
    makeAdminAuth();
    // IMS auth call returns failure
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ return: false, message: "Bad credentials" }),
      text: async () => "",
    });
    const req = makeRequest("owner@ntv.com");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.warning).toMatch(/IMS/i);
  });

  // ── Found merchant ────────────────────────────────────────────────────────

  it("returns found:true with merchant data for a known email", async () => {
    makeAdminAuth();
    const targetEmail = "contact@ntvbeautystudio.com";

    // First call: IMS auth
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ return: true, token: "ims-token-abc", refreshToken: "refresh" }),
      text: async () => "",
    });
    // Second call: ListMerchants
    mockFetch.mockResolvedValueOnce(imsPageWithMatch(targetEmail));

    const req = makeRequest(targetEmail);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.name).toContain("Nathan");
    expect(body.businessName).toBe("NTV Beauty Studio");
    expect(body.storeID).toBe(2222);
  });

  // ── Not found ────────────────────────────────────────────────────────────

  it("returns found:false for an unknown email not in merchant list", async () => {
    makeAdminAuth();
    const targetEmail = "nobody@example.com";

    // IMS auth success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ return: true, token: "ims-token-abc", refreshToken: "refresh" }),
      text: async () => "",
    });
    // ListMerchants returns records, but none match the email
    mockFetch.mockResolvedValueOnce(imsEmptyPage());

    const req = makeRequest(targetEmail);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.name).toBeUndefined();
  });

  // ── suggestedSlug (Phase 2 auto-suggest) ─────────────────────────────────

  describe("suggestedSlug (findSlugByRvcNo integration)", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cms-ims-rvc-"));
      process.env.SITES_DIR = tempDir;
    });

    afterEach(() => {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      delete process.env.SITES_DIR;
    });

    function writeSalon(dirName: string, data: unknown) {
      const configDir = path.join(tempDir, dirName, "config");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "salon.json"), JSON.stringify(data, null, 2));
    }

    it("returns suggestedSlug when storeID matches a salon's rvcNo", async () => {
      writeSalon("ntv-beauty-studio-website", { slug: "ntv-beauty-studio", rvcNo: 2222 });
      makeAdminAuth();
      const targetEmail = "contact@ntv.com";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ return: true, token: "ims-token-xyz" }),
        text: async () => "",
      });
      mockFetch.mockResolvedValueOnce(imsPageWithMatch(targetEmail));

      const res = await GET(makeRequest(targetEmail));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.found).toBe(true);
      expect(body.storeID).toBe(2222);
      expect(body.suggestedSlug).toBe("ntv-beauty-studio");
    });

    it("returns suggestedSlug:null when storeID is set but no salon has matching rvcNo", async () => {
      writeSalon("different-salon-website", { slug: "different-salon", rvcNo: 9999 });
      makeAdminAuth();
      const targetEmail = "contact@ntv.com";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ return: true, token: "ims-token-xyz" }),
        text: async () => "",
      });
      mockFetch.mockResolvedValueOnce(imsPageWithMatch(targetEmail));

      const res = await GET(makeRequest(targetEmail));
      const body = await res.json();
      expect(body.found).toBe(true);
      expect(body.storeID).toBe(2222);
      expect(body.suggestedSlug).toBeNull();
    });
  });

  // ── Cache behavior ────────────────────────────────────────────────────────

  it("caches both IMS token and merchant list — second call makes zero fetches", async () => {
    makeAdminAuth();
    const targetEmail = "contact@ntvbeautystudio.com";

    // First call: auth + merchants (2 fetches)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ return: true, token: "ims-token-abc", refreshToken: "refresh" }),
      text: async () => "",
    });
    mockFetch.mockResolvedValueOnce(imsPageWithMatch(targetEmail));

    await GET(makeRequest(targetEmail));
    const callCountAfterFirst = mockFetch.mock.calls.length;
    expect(callCountAfterFirst).toBe(2); // auth + merchants

    // Second call: both token and merchant list are cached — zero new fetches
    const res = await GET(makeRequest(targetEmail));
    expect(mockFetch.mock.calls.length).toBe(callCountAfterFirst); // no new fetches

    // Result should still be found:true from cache
    const body = await res.json();
    expect(body.found).toBe(true);
  });
});
