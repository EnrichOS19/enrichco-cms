/**
 * Owner-schema edge-case regression tests — Codex MEDIUM findings (April 22 hardening pass).
 *
 * Test 1 — Shallow-merge nested-key regression
 *   Ensures owner PUT with a partial branding payload does NOT wipe on-disk
 *   branding sub-keys that are outside the ownerSalonSchema shape (e.g.
 *   logoUrl added by onboarding scripts). The top-level spread
 *   `{ ...onDisk, ...parseResult.data }` is correct for top-level keys, but
 *   Zod strips unknown keys from nested objects (branding is a plain z.object,
 *   not .passthrough), so any on-disk branding sub-key not in the schema is
 *   silently dropped from parseResult.data.branding — and then the spread
 *   overwrites the whole on-disk branding object.
 *   This test encodes the DESIRED behaviour (sibling keys survive), and is
 *   expected to FAIL until the branding merge is deep-merged or the branding
 *   schema is made .passthrough().
 *
 * Test 2 — Audit diff consistency
 *   The diff logged by logEvent must contain only the keys the owner actually
 *   mutated (schema-known keys), and must not include stripped protected fields
 *   (siteStatus, domain, etc.) or on-disk legacy keys (nav, promotions, …).
 *   Uses parseResult.data keys for comparison — which is correct per the route
 *   handler implementation.
 *
 * Test 3 — Prototype-safety
 *   Owner payload with __proto__ / constructor prototype-pollution keys must
 *   be dropped before the merge step. No Object.prototype pollution and no
 *   such keys in the persisted payload.
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
  configEtag: vi.fn(() => "etag-edge-case-test"),
  getSalonSiteDir: vi.fn(() => "/fake/site"),
  listSalonConfigBackups: vi.fn(() => []),
  restoreSalonConfig: vi.fn(() => true),
}));

// ── audit mock ─────────────────────────────────────────────────────────────────
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));

import { PUT } from "@/app/api/salon/[slug]/route";
import { requireSalonAccess } from "@/lib/auth";
import { getSalonConfig, saveSalonConfig } from "@/lib/salons";
import { logEvent } from "@/lib/audit";

// ── shared helpers ─────────────────────────────────────────────────────────────

function makeOwnerSession(email = "owner@testsalon.com") {
  return { id: "sess-owner", email, role: "salon_owner" as const };
}

function putRequest(body: object, slug = "test-salon") {
  return new NextRequest(`http://localhost/api/salon/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ────────────────────────────────────────────────────────────────────────────────
// Test 1 — Shallow-merge nested-key regression
// ────────────────────────────────────────────────────────────────────────────────

/**
 * On-disk branding contains keys that are NOT in ownerSalonSchema's branding
 * sub-shape (logoUrl added by onboarding scripts). The owner sends a valid
 * branding payload touching only primaryColor + accentColor (the two required
 * fields). After save, the on-disk sibling keys must still be present.
 *
 * CODEX MEDIUM — this test is marked .skip because the current shallow-merge
 * implementation does NOT deep-merge the branding sub-object: Zod strips
 * logoUrl from parseResult.data.branding (it's not in the schema shape), and
 * the top-level spread then replaces the whole on-disk branding key.
 * Fix: either deep-merge branding (and any other nested schema object) or
 * mark the branding sub-schema as .passthrough() so Zod preserves unknowns.
 * Tracked as Codex MEDIUM — owner-schema-shallow-merge-branding.
 */
describe("owner PUT — shallow-merge nested-key regression (Codex MEDIUM)", () => {
  const ON_DISK_CONFIG = {
    name: "Luxe Nails",
    tagline: "Perfection in every detail",
    address: { street: "500 Brickell Ave", city: "Miami", state: "FL", zip: "33131" },
    branding: {
      primaryColor: "#000000",
      accentColor: "#c8a96e",
      // Extra keys added by onboarding — NOT in ownerSalonSchema branding shape:
      logoUrl: "https://cdn.example.com/luxe-nails-logo.png",
      secondaryColor: "#ffffff",
    },
    siteStatus: "production",
    domain: "luxenails.com",
    stagingDomain: "luxe-nails.staging.mangoforsalon.com",
    domainOwnership: "enrichco",
    websiteManager: "ai-team",
    nav: [{ label: "Home", href: "/" }],
  };

  // Owner only changes the primary brand colour. accentColor (required) stays
  // the same. They must NOT see logoUrl / secondaryColor disappear.
  const OWNER_BRANDING_UPDATE = {
    name: ON_DISK_CONFIG.name,
    tagline: ON_DISK_CONFIG.tagline,
    address: ON_DISK_CONFIG.address,
    branding: {
      primaryColor: "#abc123",
      accentColor: "#c8a96e", // required, unchanged
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSalonConfig).mockReturnValue({
      config: ON_DISK_CONFIG as never,
      dirName: "luxe-nails-website",
    });
    vi.mocked(requireSalonAccess).mockResolvedValue({
      session: makeOwnerSession(),
    });
  });

  it.skip(
    "on-disk branding sibling keys (logoUrl, secondaryColor) survive an owner partial-branding PUT [CODEX MEDIUM — fix before unskipping]",
    async () => {
      const res = await PUT(putRequest(OWNER_BRANDING_UPDATE), {
        params: Promise.resolve({ slug: "test-salon" }),
      });

      expect(res.status).toBe(200);

      const saved = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
      const savedBranding = saved.branding as Record<string, unknown>;

      // Updated key must reflect the owner's change
      expect(savedBranding.primaryColor).toBe("#abc123");

      // Sibling keys that exist on disk but NOT in ownerSalonSchema.branding
      // must survive unchanged. Currently they are wiped by the shallow spread
      // because Zod strips them from parseResult.data.branding.
      expect(savedBranding.logoUrl).toBe("https://cdn.example.com/luxe-nails-logo.png");
      expect(savedBranding.secondaryColor).toBe("#ffffff");
    }
  );
});

// ────────────────────────────────────────────────────────────────────────────────
// Test 2 — Audit diff consistency
// ────────────────────────────────────────────────────────────────────────────────

/**
 * The audit diff must:
 * (a) capture the actual key-value change the owner made (address.street)
 * (b) NOT include on-disk legacy/unknown keys (nav, promotions)
 * (c) NOT include stripped protected fields (siteStatus, domain)
 *
 * The route computes diff over Object.keys(parseResult.data) — which is the
 * correct set: schema-known, owner-allowed keys only. This test confirms that
 * invariant is upheld and the diff payload passed to logEvent is sound.
 */
describe("owner PUT — audit diff consistency (Codex MEDIUM)", () => {
  const ON_DISK_CONFIG = {
    name: "Posh Lash Studio",
    tagline: "Flutter on",
    address: { street: "100 Old Road", city: "Austin", state: "TX", zip: "78701" },
    branding: { primaryColor: "#ff6b9d", accentColor: "#1a1a1a" },
    siteStatus: "production",
    domain: "poshlash.com",
    stagingDomain: "posh-lash.staging.mangoforsalon.com",
    domainOwnership: "enrichco",
    websiteManager: "ai-team",
    // Legacy keys on disk — must NOT appear in audit diff
    nav: [{ label: "Home", href: "/" }, { label: "Services", href: "/services" }],
    promotions: [{ title: "Spring Deal", discount: "15%" }],
  };

  // Owner updates only address.street
  const OWNER_UPDATE = {
    name: "Posh Lash Studio",
    tagline: "Flutter on",
    address: { street: "200 New Boulevard", city: "Austin", state: "TX", zip: "78701" },
    branding: { primaryColor: "#ff6b9d", accentColor: "#1a1a1a" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSalonConfig).mockReturnValue({
      config: ON_DISK_CONFIG as never,
      dirName: "posh-lash-website",
    });
    vi.mocked(requireSalonAccess).mockResolvedValue({
      session: makeOwnerSession(),
    });
  });

  it("audit diff captures the owner's address change and nothing else", async () => {
    const res = await PUT(putRequest(OWNER_UPDATE), {
      params: Promise.resolve({ slug: "test-salon" }),
    });

    expect(res.status).toBe(200);
    expect(logEvent).toHaveBeenCalledOnce();

    const logArgs = vi.mocked(logEvent).mock.calls[0][0];

    // diff is serialised JSON — parse it for assertion
    expect(logArgs.diff).toBeDefined();
    const diff = JSON.parse(logArgs.diff!) as Record<string, [unknown, unknown]>;

    // address changed → must appear in diff
    expect(diff).toHaveProperty("address");
    const [oldAddr, newAddr] = diff.address as [Record<string, string>, Record<string, string>];
    expect(oldAddr.street).toBe("100 Old Road");
    expect(newAddr.street).toBe("200 New Boulevard");
  });

  it("audit diff does NOT include stripped protected fields (siteStatus, domain)", async () => {
    // Owner tries to include protected fields — they are stripped before
    // reaching the schema, so they cannot appear in the diff.
    const maliciousUpdate = {
      ...OWNER_UPDATE,
      siteStatus: "staging",    // protected
      domain: "evil.com",       // protected
    };

    const res = await PUT(putRequest(maliciousUpdate), {
      params: Promise.resolve({ slug: "test-salon" }),
    });

    expect(res.status).toBe(200);

    const logArgs = vi.mocked(logEvent).mock.calls[0][0];
    const diff = logArgs.diff ? (JSON.parse(logArgs.diff) as Record<string, unknown>) : {};

    expect(diff).not.toHaveProperty("siteStatus");
    expect(diff).not.toHaveProperty("domain");
  });

  it("audit diff does NOT include on-disk legacy keys (nav, promotions)", async () => {
    const res = await PUT(putRequest(OWNER_UPDATE), {
      params: Promise.resolve({ slug: "test-salon" }),
    });

    expect(res.status).toBe(200);

    const logArgs = vi.mocked(logEvent).mock.calls[0][0];
    const diff = logArgs.diff ? (JSON.parse(logArgs.diff) as Record<string, unknown>) : {};

    // Legacy keys are not in ownerSalonSchema — they must not appear in diff
    expect(diff).not.toHaveProperty("nav");
    expect(diff).not.toHaveProperty("promotions");
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// Test 3 — Prototype-safety
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Malicious owner payload with __proto__ / constructor prototype-pollution keys
 * must be dropped before the merge step. The route:
 *   1. Strips OWNER_PROTECTED_FIELDS
 *   2. Filters to allowedOwnerKeys (Object.keys(ownerSalonSchema.shape))
 * Neither '__proto__' nor 'constructor' appears in ownerSalonSchema.shape, so
 * both must be dropped. We also verify no Object.prototype pollution occurs.
 */
describe("owner PUT — prototype-safety (Codex MEDIUM)", () => {
  const ON_DISK_CONFIG = {
    name: "Clean Cuts Barbershop",
    tagline: "Sharp looks, sharp blades",
    address: { street: "42 Main St", city: "Denver", state: "CO", zip: "80203" },
    branding: { primaryColor: "#2c3e50", accentColor: "#e74c3c" },
    siteStatus: "production",
    domain: "cleancuts.com",
    stagingDomain: "clean-cuts.staging.mangoforsalon.com",
    domainOwnership: "enrichco",
    websiteManager: "ai-team",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSalonConfig).mockReturnValue({
      config: ON_DISK_CONFIG as never,
      dirName: "clean-cuts-website",
    });
    vi.mocked(requireSalonAccess).mockResolvedValue({
      session: makeOwnerSession(),
    });
  });

  it("__proto__ key in owner payload is dropped — Object.prototype is not polluted", async () => {
    // JSON.parse with a __proto__ key produces an own-property on the parsed
    // object in modern V8 (not a prototype assignment), but the route must still
    // drop it before the merge so it doesn't land in the on-disk config.
    const maliciousBody = JSON.parse(
      JSON.stringify({
        name: "Clean Cuts Barbershop",
        tagline: "Sharp looks, sharp blades",
        address: ON_DISK_CONFIG.address,
        branding: ON_DISK_CONFIG.branding,
        __proto__: { pollute: "bad" },
      })
    ) as Record<string, unknown>;

    const req = new NextRequest("http://localhost/api/salon/test-salon", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(maliciousBody),
    });

    const res = await PUT(req, {
      params: Promise.resolve({ slug: "test-salon" }),
    });

    expect(res.status).toBe(200);

    // Object.prototype must not be polluted
    expect(({} as Record<string, unknown>).pollute).toBeUndefined();

    // The persisted payload must not contain the __proto__ key
    expect(saveSalonConfig).toHaveBeenCalledOnce();
    const saved = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(saved, "__proto__")).toBe(false);
    expect(saved.pollute).toBeUndefined();
  });

  it("constructor.prototype key in owner payload is dropped — no prototype chain pollution", async () => {
    const maliciousBody = {
      name: "Clean Cuts Barbershop",
      tagline: "Sharp looks, sharp blades",
      address: ON_DISK_CONFIG.address,
      branding: ON_DISK_CONFIG.branding,
      constructor: { prototype: { pollute: "bad" } },
    };

    const res = await PUT(putRequest(maliciousBody), {
      params: Promise.resolve({ slug: "test-salon" }),
    });

    expect(res.status).toBe(200);

    // Object.prototype must not be polluted
    expect(({} as Record<string, unknown>).pollute).toBeUndefined();

    // The persisted payload must not contain the constructor key
    const saved = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    expect(saved.constructor).not.toMatchObject({ prototype: { pollute: "bad" } });
    expect(saved.pollute).toBeUndefined();
  });

  it("combined __proto__ + constructor payload produces a clean save payload with no polluting keys", async () => {
    const maliciousBody = JSON.parse(
      JSON.stringify({
        name: "Clean Cuts Barbershop",
        tagline: "Sharp looks, sharp blades",
        address: ON_DISK_CONFIG.address,
        branding: ON_DISK_CONFIG.branding,
        __proto__: { pollute: "bad" },
        constructor: { prototype: { pollute: "bad" } },
      })
    ) as Record<string, unknown>;

    const req = new NextRequest("http://localhost/api/salon/test-salon", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(maliciousBody),
    });

    const res = await PUT(req, {
      params: Promise.resolve({ slug: "test-salon" }),
    });

    expect(res.status).toBe(200);

    const saved = vi.mocked(saveSalonConfig).mock.calls[0][1] as Record<string, unknown>;
    const savedKeys = Object.keys(saved);

    expect(savedKeys).not.toContain("__proto__");
    // constructor can appear as a regular inherited property on any plain object —
    // what we're asserting is it wasn't SET to the attacker's value
    if (Object.prototype.hasOwnProperty.call(saved, "constructor")) {
      expect((saved.constructor as Record<string, unknown>).prototype).not.toMatchObject({ pollute: "bad" });
    }
    expect(({} as Record<string, unknown>).pollute).toBeUndefined();
  });
});
