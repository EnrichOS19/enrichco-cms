/**
 * Story 4 — Admin salon-access "list all grants" tests.
 *
 * Tests the extension to GET /api/admin/salon-access?all=true.
 * Mocks DB functions so no real SQLite file is needed.
 *
 * TDD: red first — run before implementation to confirm failure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── auth mock ────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireAdmin: vi.fn(),
  };
});

// ── db mock ──────────────────────────────────────────────────────────────────
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    listUsersForSalon: vi.fn(),
    listSalonsForUser: vi.fn(),
    grantSalonAccess: vi.fn(),
    revokeSalonAccess: vi.fn(),
    listAllGrants: vi.fn(),
  };
});

// ── audit mock ───────────────────────────────────────────────────────────────
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));

import { GET } from "@/app/api/admin/salon-access/route";
import { requireAdmin } from "@/lib/auth";
import { listAllGrants } from "@/lib/db";
import type { Session } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

const ADMIN_SESSION: Session = { id: "sess-1", email: "admin@enrichco.us", role: "admin" };

function makeAdminAuth() {
  vi.mocked(requireAdmin).mockResolvedValue({ session: ADMIN_SESSION });
}

function makeNonAdminAuth() {
  vi.mocked(requireAdmin).mockResolvedValue({
    response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
  });
}

describe("GET /api/admin/salon-access?all=true", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-admin", async () => {
    makeNonAdminAuth();
    const req = new NextRequest("http://localhost/api/admin/salon-access?all=true");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns all grants as a flat array", async () => {
    makeAdminAuth();
    const mockGrants = [
      { user_email: "owner1@example.com", slug: "ntv-beauty", granted_by: "admin@enrichco.us", granted_at: 1700000000, ims_store_id: null },
      { user_email: "owner2@example.com", slug: "salon-two", granted_by: "admin@enrichco.us", granted_at: 1700001000, ims_store_id: "2222" },
    ];
    vi.mocked(listAllGrants).mockReturnValue(mockGrants);

    const req = new NextRequest("http://localhost/api/admin/salon-access?all=true");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.grants)).toBe(true);
    expect(body.grants).toHaveLength(2);
    expect(body.grants[0]).toMatchObject({
      email: "owner1@example.com",
      slug: "ntv-beauty",
      grantedBy: "admin@enrichco.us",
    });
  });

  it("returns empty array when no grants exist", async () => {
    makeAdminAuth();
    vi.mocked(listAllGrants).mockReturnValue([]);

    const req = new NextRequest("http://localhost/api/admin/salon-access?all=true");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grants).toEqual([]);
  });
});
