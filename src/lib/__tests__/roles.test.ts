/**
 * Story 5 — roles.ts helper unit tests.
 *
 * TDD: red first — run before roles.ts exists to confirm the suite fails,
 *      then implement until green.
 */

import { describe, it, expect } from "vitest";
import { isOwner, isStaff } from "@/lib/roles";

describe("isOwner", () => {
  it("returns true for salon_owner role", () => {
    expect(isOwner("salon_owner")).toBe(true);
  });

  it("returns false for admin role", () => {
    expect(isOwner("admin")).toBe(false);
  });

  it("returns false for superadmin role", () => {
    expect(isOwner("superadmin")).toBe(false);
  });

  it("returns false for support role", () => {
    expect(isOwner("support")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isOwner(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isOwner(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isOwner("")).toBe(false);
  });
});

describe("isStaff", () => {
  it("returns true for admin role", () => {
    expect(isStaff("admin")).toBe(true);
  });

  it("returns true for superadmin role", () => {
    expect(isStaff("superadmin")).toBe(true);
  });

  it("returns true for support role", () => {
    expect(isStaff("support")).toBe(true);
  });

  it("returns false for salon_owner role", () => {
    expect(isStaff("salon_owner")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isStaff(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isStaff(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isStaff("")).toBe(false);
  });
});

// ── Owner-scoped field/tab visibility logic ──────────────────────────────────
// These test the filtering helpers that page.tsx will use.
// They are pure functions so no React/DOM needed.

import {
  OWNER_HIDDEN_TABS,
  OWNER_HIDDEN_FIELDS,
  shouldShowTab,
  shouldShowField,
} from "@/lib/roles";

describe("OWNER_HIDDEN_TABS", () => {
  it("includes settings tab", () => {
    expect(OWNER_HIDDEN_TABS).toContain("settings");
  });
});

describe("OWNER_HIDDEN_FIELDS", () => {
  it("includes domain", () => {
    expect(OWNER_HIDDEN_FIELDS).toContain("domain");
  });

  it("includes stagingDomain", () => {
    expect(OWNER_HIDDEN_FIELDS).toContain("stagingDomain");
  });

  it("includes siteStatus", () => {
    expect(OWNER_HIDDEN_FIELDS).toContain("siteStatus");
  });

  it("includes domainOwnership", () => {
    expect(OWNER_HIDDEN_FIELDS).toContain("domainOwnership");
  });

  it("includes websiteManager", () => {
    expect(OWNER_HIDDEN_FIELDS).toContain("websiteManager");
  });

  it("includes currentTemplate", () => {
    expect(OWNER_HIDDEN_FIELDS).toContain("currentTemplate");
  });
});

describe("shouldShowTab", () => {
  // salon_owner: settings tab hidden
  it("hides settings tab for salon_owner", () => {
    expect(shouldShowTab("settings", "salon_owner")).toBe(false);
  });

  // salon_owner: all other tabs visible
  it("shows info tab for salon_owner", () => {
    expect(shouldShowTab("info", "salon_owner")).toBe(true);
  });

  it("shows hours tab for salon_owner", () => {
    expect(shouldShowTab("hours", "salon_owner")).toBe(true);
  });

  it("shows services tab for salon_owner", () => {
    expect(shouldShowTab("services", "salon_owner")).toBe(true);
  });

  it("shows gallery tab for salon_owner", () => {
    expect(shouldShowTab("gallery", "salon_owner")).toBe(true);
  });

  it("shows design tab for salon_owner", () => {
    expect(shouldShowTab("design", "salon_owner")).toBe(true);
  });

  it("shows about tab for salon_owner", () => {
    expect(shouldShowTab("about", "salon_owner")).toBe(true);
  });

  it("shows blog tab for salon_owner", () => {
    expect(shouldShowTab("blog", "salon_owner")).toBe(true);
  });

  it("shows seo tab for salon_owner", () => {
    expect(shouldShowTab("seo", "salon_owner")).toBe(true);
  });

  // admin: all tabs visible (no regression)
  it("shows settings tab for admin (no regression)", () => {
    expect(shouldShowTab("settings", "admin")).toBe(true);
  });

  it("shows all tabs for superadmin", () => {
    for (const tab of ["info", "hours", "services", "gallery", "design", "about", "blog", "seo", "settings"]) {
      expect(shouldShowTab(tab, "superadmin")).toBe(true);
    }
  });

  // null role behaves like salon_owner (most restrictive safe default)
  it("hides settings tab when role is null", () => {
    expect(shouldShowTab("settings", null)).toBe(false);
  });
});

describe("shouldShowField", () => {
  // salon_owner: protected fields hidden
  it("hides domain for salon_owner", () => {
    expect(shouldShowField("domain", "salon_owner")).toBe(false);
  });

  it("hides stagingDomain for salon_owner", () => {
    expect(shouldShowField("stagingDomain", "salon_owner")).toBe(false);
  });

  it("hides siteStatus for salon_owner", () => {
    expect(shouldShowField("siteStatus", "salon_owner")).toBe(false);
  });

  it("hides domainOwnership for salon_owner", () => {
    expect(shouldShowField("domainOwnership", "salon_owner")).toBe(false);
  });

  it("hides websiteManager for salon_owner", () => {
    expect(shouldShowField("websiteManager", "salon_owner")).toBe(false);
  });

  it("hides currentTemplate for salon_owner", () => {
    expect(shouldShowField("currentTemplate", "salon_owner")).toBe(false);
  });

  // non-protected fields are visible for salon_owner
  it("shows name for salon_owner", () => {
    expect(shouldShowField("name", "salon_owner")).toBe(true);
  });

  it("shows services for salon_owner", () => {
    expect(shouldShowField("services", "salon_owner")).toBe(true);
  });

  // admin: all fields visible
  it("shows domain for admin (no regression)", () => {
    expect(shouldShowField("domain", "admin")).toBe(true);
  });

  it("shows siteStatus for superadmin (no regression)", () => {
    expect(shouldShowField("siteStatus", "superadmin")).toBe(true);
  });

  // null role: protected fields hidden
  it("hides domain when role is null", () => {
    expect(shouldShowField("domain", null)).toBe(false);
  });
});

// ── canPublishToProduction ────────────────────────────────────────────────────
import { canPublishToProduction, canSwitchTemplate } from "@/lib/roles";

describe("canPublishToProduction", () => {
  it("returns true for admin", () => {
    expect(canPublishToProduction("admin")).toBe(true);
  });

  it("returns true for superadmin", () => {
    expect(canPublishToProduction("superadmin")).toBe(true);
  });

  it("returns false for salon_owner", () => {
    expect(canPublishToProduction("salon_owner")).toBe(false);
  });

  it("returns false for null", () => {
    expect(canPublishToProduction(null)).toBe(false);
  });

  it("returns false for support role", () => {
    expect(canPublishToProduction("support")).toBe(false);
  });
});

describe("canSwitchTemplate", () => {
  it("returns true for admin", () => {
    expect(canSwitchTemplate("admin")).toBe(true);
  });

  it("returns true for superadmin", () => {
    expect(canSwitchTemplate("superadmin")).toBe(true);
  });

  it("returns false for salon_owner", () => {
    expect(canSwitchTemplate("salon_owner")).toBe(false);
  });

  it("returns false for null", () => {
    expect(canSwitchTemplate(null)).toBe(false);
  });
});
