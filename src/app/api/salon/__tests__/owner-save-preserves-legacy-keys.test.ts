/**
 * Owner save — legacy key preservation + strict-mode fix.
 *
 * Verifies:
 * 1. Owner PUT with a salon.json that has legacy top-level keys (nav,
 *    promotions, googleReviews, popup, theme) succeeds with 200 (not 400).
 * 2. saveSalonConfig is called with a merged payload that still contains all
 *    legacy keys (they survive the save unchanged).
 * 3. The validated/changed field (address.street) is updated in the payload.
 * 4. Admin PUT on the same body also succeeds — passthrough path unaffected.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

process.env.CMS_AUTH_DISABLED = "false";

// ── auth mock ──────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireSalonAccess: vi.fn(),
  };
});

// ── salons mock ────────────────────────────────────────────────────────────────
vi.mock("@/lib/salons", () => ({
  getSalonConfig: vi.fn(),
  saveSalonConfig: vi.fn(() => true),
  configEtag: vi.fn(() => "etag-legacy-test"),
  getSalonSiteDir: vi.fn(() => "/fake/site"),
  listSalonConfigBackups: vi.fn(() => []),
  restoreSalonConfig: vi.fn(() => true),
}));

// ── audit mock ─────────────────────────────────────────────────────────────────
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));

import { PUT } from "@/app/api/salon/[slug]/route";
import { requireSalonAccess } from "@/lib/auth";
import { getSalonConfig, saveSalonConfig } from "@/lib/salons";

// ── fixtures ───────────────────────────────────────────────────────────────────

/**
 * Simulates what a real legacy salon.json looks like on disk —
 * has all the schema-known fields PLUS many unknown top-level keys
 * that were added by old onboarding scripts or template engines.
 */
const LEGACY_DISK_CONFIG = {
  name: "Queen Nail Spa",
  tagline: "The best nails in town",
  address: { street: "100 Old Street", city: "Miami", state: "FL", zip: "33101" },
  branding: { primaryColor: "#c8a96e", accentColor: "#1a1a1a" },
  siteStatus: "production",
  domain: "queennailspa.com",
  stagingDomain: "queen-nail-spa.staging.mangoforsalon.com",
  domainOwnership: "enrichco",
  websiteManager: "ai-team",
  // Legacy keys — NOT in ownerSalonSchema or salonSchema
  nav: [{ label: "Home", href: "/" }, { label: "Services", href: "/services" }],
  promotions: [{ title: "Fall Special", discount: "20%" }],
  googleReviews: [{ author: "Jane D.", rating: 5, text: "Loved it!" }],
  popup: { enabled: true, message: "Book now!" },
  theme: { variant: "classic", darkMode: false },
  customScript: "<script>console.log('legacy')</script>",
};

/**
 * Body the owner sends — includes all legacy keys (browser rounds them
 * back), modified address, and OWNER_PROTECTED fields that must be stripped.
 */
const OWNER_PUT_BODY = {
  ...LEGACY_DISK_CONFIG,
  address: { street: "200 New Avenue", city: "Miami", state: "FL", zip: "33101" },
  // Owner shouldn't be able to change these:
  siteStatus: "staging",      // protected
  domain: "evil-override.com", // protected
};

function makeOwnerSession(email = "owner@queennailspa.com") {
  return { id: "sess-owner", email, role: "salon_owner" as const };
}

function makeAdminSession(email = "admin@enrichco.us") {
  return { id: "sess-admin", email, role: "admin" as const };
}

function putRequest(body: object) {
  return new NextRequest("http://localhost/api/salon/queen-nail-spa", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe("owner PUT — legacy key preservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSalonConfig).mockReturnValue({
      config: LEGACY_DISK_CONFIG as never,
      dirName: "queen-nail-spa-website",
    });
  });

  it("succeeds (200) even when the body contains legacy top-level keys", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({
      session: makeOwnerSession(),
    });

    const res = await PUT(putRequest(OWNER_PUT_BODY), {
      params: Promise.resolve({ slug: "queen-nail-spa" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("saveSalonConfig is called with all legacy keys intact on disk", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({
      session: makeOwnerSession(),
    });

    await PUT(putRequest(OWNER_PUT_BODY), {
      params: Promise.resolve({ slug: "queen-nail-spa" }),
    });

    expect(saveSalonConfig).toHaveBeenCalledOnce();
    const savedPayload = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;

    // All legacy keys must survive unchanged
    expect(savedPayload.nav).toEqual(LEGACY_DISK_CONFIG.nav);
    expect(savedPayload.promotions).toEqual(LEGACY_DISK_CONFIG.promotions);
    expect(savedPayload.googleReviews).toEqual(LEGACY_DISK_CONFIG.googleReviews);
    expect(savedPayload.popup).toEqual(LEGACY_DISK_CONFIG.popup);
    expect(savedPayload.theme).toEqual(LEGACY_DISK_CONFIG.theme);
    expect(savedPayload.customScript).toEqual(LEGACY_DISK_CONFIG.customScript);
  });

  it("updated schema field (address.street) is reflected in the saved payload", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({
      session: makeOwnerSession(),
    });

    await PUT(putRequest(OWNER_PUT_BODY), {
      params: Promise.resolve({ slug: "queen-nail-spa" }),
    });

    const savedPayload = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    const addr = savedPayload.address as Record<string, string>;
    expect(addr.street).toBe("200 New Avenue");
  });

  it("protected fields (siteStatus, domain) are NOT overwritten by owner", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({
      session: makeOwnerSession(),
    });

    await PUT(putRequest(OWNER_PUT_BODY), {
      params: Promise.resolve({ slug: "queen-nail-spa" }),
    });

    const savedPayload = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    // Protected fields come from the on-disk config (spread base), NOT from owner's PUT body
    expect(savedPayload.siteStatus).toBe("production");   // disk value, not "staging"
    expect(savedPayload.domain).toBe("queennailspa.com"); // disk value, not "evil-override.com"
  });
});

describe("admin PUT — passthrough path unaffected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSalonConfig).mockReturnValue({
      config: LEGACY_DISK_CONFIG as never,
      dirName: "queen-nail-spa-website",
    });
  });

  it("admin PUT succeeds and saves the full body (no legacy-key stripping)", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({
      session: makeAdminSession(),
    });

    const res = await PUT(putRequest(OWNER_PUT_BODY), {
      params: Promise.resolve({ slug: "queen-nail-spa" }),
    });

    expect(res.status).toBe(200);
    expect(saveSalonConfig).toHaveBeenCalledOnce();
  });
});
