/**
 * Story 2 — Server-side field allowlist on salon PUT.
 *
 * Owners cannot escalate by sending protected fields in the PUT body.
 * Fields stripped: siteStatus, domain, stagingDomain, domainOwnership,
 *                   websiteManager, currentTemplate.
 * Admin PUT with those fields saves normally.
 * Owner editing allowed fields (name, hours, services, etc.) works.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

process.env.CMS_AUTH_DISABLED = "false";

// ── auth mock ─────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireSalonAccess: vi.fn(),
  };
});

// ── salons mock ───────────────────────────────────────────────────────────────
vi.mock("@/lib/salons", () => ({
  getSalonConfig: vi.fn(),
  saveSalonConfig: vi.fn(() => true),
  configEtag: vi.fn(() => '"etag-abc"'),
  getSalonSiteDir: vi.fn(() => "/fake/site"),
  listSalonConfigBackups: vi.fn(() => []),
  restoreSalonConfig: vi.fn(() => true),
}));

// ── audit mock ────────────────────────────────────────────────────────────────
vi.mock("@/lib/audit", () => ({
  logEvent: vi.fn(),
}));

import { PUT, GET } from "@/app/api/salon/[slug]/route";
import { requireSalonAccess } from "@/lib/auth";
import { getSalonConfig, saveSalonConfig } from "@/lib/salons";

// ── helpers ───────────────────────────────────────────────────────────────────

// Minimal valid body that satisfies salonSchema required fields
const BASE_CONFIG = {
  name: "NTV Beauty Studio",
  tagline: "Beautiful nails",
  address: { street: "123 Main St", city: "Orlando", state: "FL", zip: "32801" },
  branding: { primaryColor: "#ff0000", accentColor: "#000000" },
  siteStatus: "staging",
  domain: "ntvbeauty.com",
  stagingDomain: "ntv-staging.mangoforsalon.com",
  domainOwnership: "enrichco",
  websiteManager: "ai-team",
};

function makeSession(role: "salon_owner" | "admin" | "superadmin", email = "test@test.com") {
  return { id: "sess-123", email, role };
}

function makePutRequest(body: object, slug = "ntv-beauty") {
  return new NextRequest(`http://localhost/api/salon/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(slug = "ntv-beauty") {
  return new NextRequest(`http://localhost/api/salon/${slug}`, {
    method: "GET",
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PUT /api/salon/[slug] — field allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSalonConfig).mockReturnValue({
      config: { ...BASE_CONFIG } as ReturnType<typeof getSalonConfig> extends { config: infer C } ? C : never,
      dirName: "ntv-beauty",
    });
  });

  it("owner PUT with siteStatus='production' → field is stripped, save uses original 'staging'", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: makeSession("salon_owner") });

    const res = await PUT(
      makePutRequest({
        ...BASE_CONFIG,
        siteStatus: "production",  // should be stripped
      }),
      { params: Promise.resolve({ slug: "ntv-beauty" }) }
    );

    expect(res.status).toBe(200);
    const savedData = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    // The saved config must NOT contain siteStatus from the request body
    expect(savedData.siteStatus).not.toBe("production");
  });

  it("owner PUT with domain='evil.com' → domain field is stripped", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: makeSession("salon_owner") });

    const res = await PUT(
      makePutRequest({ ...BASE_CONFIG, domain: "evil.com" }),
      { params: Promise.resolve({ slug: "ntv-beauty" }) }
    );

    expect(res.status).toBe(200);
    const savedData = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    expect(savedData.domain).not.toBe("evil.com");
  });

  it("owner PUT strips all 6 protected fields", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: makeSession("salon_owner") });

    const maliciousBody = {
      ...BASE_CONFIG,
      siteStatus: "production",
      domain: "evil.com",
      stagingDomain: "evil-staging.com",
      domainOwnership: "client",
      websiteManager: "marketing-team",
      currentTemplate: "luxury",
    };

    const res = await PUT(
      makePutRequest(maliciousBody),
      { params: Promise.resolve({ slug: "ntv-beauty" }) }
    );

    expect(res.status).toBe(200);
    const savedData = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    expect(savedData.siteStatus).not.toBe("production");
    expect(savedData.domain).not.toBe("evil.com");
    expect(savedData.stagingDomain).not.toBe("evil-staging.com");
    expect(savedData.domainOwnership).not.toBe("client");
    expect(savedData.websiteManager).not.toBe("marketing-team");
    expect(savedData.currentTemplate).not.toBe("luxury");
  });

  it("admin PUT with protected fields → saves normally (no strip)", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: makeSession("admin") });

    const res = await PUT(
      makePutRequest({ ...BASE_CONFIG, siteStatus: "production", domain: "real-domain.com" }),
      { params: Promise.resolve({ slug: "ntv-beauty" }) }
    );

    expect(res.status).toBe(200);
    const savedData = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    expect(savedData.siteStatus).toBe("production");
    expect(savedData.domain).toBe("real-domain.com");
  });

  it("owner PUT with allowed fields (name, tagline) → saves successfully", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: makeSession("salon_owner") });

    const res = await PUT(
      makePutRequest({ ...BASE_CONFIG, name: "NTV Updated", tagline: "New tagline" }),
      { params: Promise.resolve({ slug: "ntv-beauty" }) }
    );

    expect(res.status).toBe(200);
    const savedData = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    expect(savedData.name).toBe("NTV Updated");
    expect(savedData.tagline).toBe("New tagline");
  });

  it("owner PUT: unknown keys are silently stripped before strict schema parse — save succeeds", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: makeSession("salon_owner") });

    const res = await PUT(
      makePutRequest({ ...BASE_CONFIG, unknownAdminField: "injected", nav: [{ label: "Home" }] }),
      { params: Promise.resolve({ slug: "ntv-beauty" }) }
    );

    // Unknown keys are stripped before parse — save succeeds instead of 400.
    // The unknown key must NOT appear in the saved payload.
    expect(res.status).toBe(200);
    const savedData = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    expect(savedData.unknownAdminField).toBeUndefined();
    expect(savedData.nav).toBeUndefined(); // nav is not in ownerSalonSchema.shape
  });
});

// ── Domain normalization (prevents the "CMS says published, live shows stale"
// bug caused by mixed-case `domain` fields hitting case-sensitive filesystem
// paths while nginx reads from the lowercase DNS variant) ────────────────────
describe("PUT /api/salon/[slug] — domain normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSalonConfig).mockReturnValue({
      config: { ...BASE_CONFIG } as ReturnType<typeof getSalonConfig> extends { config: infer C } ? C : never,
      dirName: "ntv-beauty",
    });
  });

  it("admin PUT with mixed-case domain → stored lowercase", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: makeSession("admin") });

    const res = await PUT(
      makePutRequest({ ...BASE_CONFIG, domain: "CaliNailsandSpaVacaville.com" }),
      { params: Promise.resolve({ slug: "ntv-beauty" }) }
    );

    expect(res.status).toBe(200);
    const savedData = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    expect(savedData.domain).toBe("calinailsandspavacaville.com");
  });

  it("admin PUT with mixed-case stagingDomain → stored lowercase", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: makeSession("admin") });

    const res = await PUT(
      makePutRequest({ ...BASE_CONFIG, stagingDomain: "MySalon-STAGING.pages.dev" }),
      { params: Promise.resolve({ slug: "ntv-beauty" }) }
    );

    expect(res.status).toBe(200);
    const savedData = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    expect(savedData.stagingDomain).toBe("mysalon-staging.pages.dev");
  });

  it("admin PUT already-lowercase domain is idempotent", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: makeSession("admin") });

    const res = await PUT(
      makePutRequest({ ...BASE_CONFIG, domain: "already-lower.com", stagingDomain: "already-lower.web.app" }),
      { params: Promise.resolve({ slug: "ntv-beauty" }) }
    );

    expect(res.status).toBe(200);
    const savedData = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    expect(savedData.domain).toBe("already-lower.com");
    expect(savedData.stagingDomain).toBe("already-lower.web.app");
  });
});
