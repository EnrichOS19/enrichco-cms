/**
 * Story 3 — requireSalonAccess on every slug route.
 *
 * Tests:
 * - Owner accessing their own salon → allowed (200 / appropriate status)
 * - Owner accessing a different salon → 403
 * - Admin accessing any salon → allowed
 * - GET preview, GET/POST/DELETE logo, GET/POST restore, POST rollback — all gated
 *
 * Note: rollback uses requireAdmin (existing design — it's a destructive op).
 * We test it separately to confirm admin-only stays intact.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

process.env.CMS_AUTH_DISABLED = "false";

// ── auth mock ─────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireSalonAccess: vi.fn(),
    requireSession: vi.fn(),
    requireAdmin: vi.fn(),
  };
});

// ── salons mock ───────────────────────────────────────────────────────────────
vi.mock("@/lib/salons", () => ({
  getSalonConfig: vi.fn(() => ({
    config: {
      name: "Test Salon",
      branding: { primaryColor: "#000", accentColor: "#fff" },
      address: {},
      siteStatus: "staging",
      stagingDomain: "test.staging.mangoforsalon.com",
    },
    dirName: "test-salon",
  })),
  saveSalonConfig: vi.fn(() => true),
  configEtag: vi.fn(() => '"etag"'),
  getSalonSiteDir: vi.fn(() => null),  // no real dir — causes 404 for logo/restore
  listSalonConfigBackups: vi.fn(() => ["salon.json.bak.abc123"]),
  restoreSalonConfig: vi.fn(() => true),
}));

vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));

import { requireSalonAccess, requireSession, requireAdmin } from "@/lib/auth";

function ownerSession(email = "owner@ntv.com") {
  return { id: "s1", email, role: "salon_owner" };
}

function adminSession(email = "admin@enrichco.us") {
  return { id: "s2", email, role: "admin" };
}

function forbidden() {
  return {
    response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
  };
}

function makeRequest(url: string, method = "GET") {
  return new NextRequest(url, { method });
}

// ── logo route ────────────────────────────────────────────────────────────────

describe("logo route — requireSalonAccess on all methods", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /api/salon/other-salon/logo as owner of own-salon → 403", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue(forbidden());

    const { GET } = await import("@/app/api/salon/[slug]/logo/route");
    const res = await GET(
      makeRequest("http://localhost/api/salon/other-salon/logo"),
      { params: Promise.resolve({ slug: "other-salon" }) }
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/salon/other-salon/logo as owner → 403", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue(forbidden());

    const { POST } = await import("@/app/api/salon/[slug]/logo/route");
    const req = new NextRequest("http://localhost/api/salon/other-salon/logo", {
      method: "POST",
      body: new FormData(),
    });
    const res = await POST(req, { params: Promise.resolve({ slug: "other-salon" }) });
    expect(res.status).toBe(403);
  });

  it("DELETE /api/salon/other-salon/logo as owner → 403", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue(forbidden());

    const { DELETE } = await import("@/app/api/salon/[slug]/logo/route");
    const res = await DELETE(
      makeRequest("http://localhost/api/salon/other-salon/logo", "DELETE"),
      { params: Promise.resolve({ slug: "other-salon" }) }
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/salon/own-salon/logo as owner → not 403 (access granted)", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: ownerSession() });

    const { GET } = await import("@/app/api/salon/[slug]/logo/route");
    const res = await GET(
      makeRequest("http://localhost/api/salon/own-salon/logo"),
      { params: Promise.resolve({ slug: "own-salon" }) }
    );
    // getSalonSiteDir returns null → 404, not 403 — access was granted
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it("GET /api/salon/any/logo as admin → not 403", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: adminSession() });

    const { GET } = await import("@/app/api/salon/[slug]/logo/route");
    const res = await GET(
      makeRequest("http://localhost/api/salon/any/logo"),
      { params: Promise.resolve({ slug: "any" }) }
    );
    expect(res.status).not.toBe(403);
  });
});

// ── preview route ─────────────────────────────────────────────────────────────

describe("preview route — requireSalonAccess on GET and POST", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /api/salon/other-salon/preview as owner → 403", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue(forbidden());

    const { GET } = await import("@/app/api/salon/[slug]/preview/route");
    const res = await GET(
      makeRequest("http://localhost/api/salon/other-salon/preview"),
      { params: Promise.resolve({ slug: "other-salon" }) }
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/salon/other-salon/preview as owner → 403", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue(forbidden());

    const { POST } = await import("@/app/api/salon/[slug]/preview/route");
    const res = await POST(
      new NextRequest("http://localhost/api/salon/other-salon/preview", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ slug: "other-salon" }) }
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/salon/own-salon/preview as owner → not 403", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: ownerSession() });

    const { GET } = await import("@/app/api/salon/[slug]/preview/route");
    const res = await GET(
      makeRequest("http://localhost/api/salon/own-salon/preview"),
      { params: Promise.resolve({ slug: "own-salon" }) }
    );
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});

// ── restore route ─────────────────────────────────────────────────────────────

describe("restore route — requireSalonAccess on GET and POST", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /api/salon/other-salon/restore as owner → 403", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue(forbidden());

    const { GET } = await import("@/app/api/salon/[slug]/restore/route");
    const res = await GET(
      makeRequest("http://localhost/api/salon/other-salon/restore"),
      { params: Promise.resolve({ slug: "other-salon" }) }
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/salon/other-salon/restore as owner → 403", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue(forbidden());

    const { POST } = await import("@/app/api/salon/[slug]/restore/route");
    const res = await POST(
      new NextRequest("http://localhost/api/salon/other-salon/restore", {
        method: "POST",
        body: JSON.stringify({ backup: "salon.json.bak.abc123" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ slug: "other-salon" }) }
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/salon/own-salon/restore as owner → not 403", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: ownerSession() });

    const { GET } = await import("@/app/api/salon/[slug]/restore/route");
    const res = await GET(
      makeRequest("http://localhost/api/salon/own-salon/restore"),
      { params: Promise.resolve({ slug: "own-salon" }) }
    );
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});

// ── rollback route ────────────────────────────────────────────────────────────
// rollback uses requireAdmin — stays admin-only, not salon_owner accessible

describe("rollback route — requireAdmin (admin-only, not downgraded to owner access)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST /api/salon/salon/rollback as owner → 403 (requireAdmin blocks it)", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      response: NextResponse.json({ error: "Forbidden — admin role required" }, { status: 403 }),
    });

    const { POST } = await import("@/app/api/salon/[slug]/rollback/route");
    const res = await POST(
      new NextRequest("http://localhost/api/salon/salon/rollback", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ slug: "salon" }) }
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/salon/salon/rollback as admin → allowed (to the point of business logic)", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ session: adminSession() });

    const { POST } = await import("@/app/api/salon/[slug]/rollback/route");
    const res = await POST(
      new NextRequest("http://localhost/api/salon/salon/rollback", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ slug: "salon" }) }
    );
    // Should not be 403 or 401 — may be 422/409 due to no real domain config
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});
