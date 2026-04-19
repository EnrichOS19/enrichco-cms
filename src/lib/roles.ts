/**
 * Role helpers for CMS access control.
 *
 * Used in the editor UI (page.tsx) to conditionally render tabs, fields,
 * and action buttons based on the authenticated user's role.
 *
 * Server-side enforcement lives in the API routes (Agent A/B scope).
 * This file is client-safe — no DB or auth imports.
 */

/** Roles that are considered "staff" (EnrichCo internal users). */
const STAFF_ROLES = new Set(["admin", "superadmin", "support"]);

/** Roles that are considered "salon owners" (external POS-backed users). */
const OWNER_ROLES = new Set(["salon_owner"]);

/**
 * Tabs hidden from salon owners.
 * Owners cannot access the Settings tab (which contains domain, siteStatus,
 * domainOwnership, websiteManager — infrastructure-level fields).
 */
export const OWNER_HIDDEN_TABS: readonly string[] = ["settings"] as const;

/**
 * Config fields that salon owners cannot see or edit.
 * These are infrastructure / management fields that only staff should touch.
 */
export const OWNER_HIDDEN_FIELDS: readonly string[] = [
  "domain",
  "stagingDomain",
  "siteStatus",
  "domainOwnership",
  "websiteManager",
  "currentTemplate",
] as const;

/** Returns true if the role is a salon owner. */
export function isOwner(role: string | null | undefined): boolean {
  return typeof role === "string" && OWNER_ROLES.has(role);
}

/** Returns true if the role is internal staff (admin / superadmin / support). */
export function isStaff(role: string | null | undefined): boolean {
  return typeof role === "string" && STAFF_ROLES.has(role);
}

/**
 * Returns true if the given tab should be shown for the given role.
 * Staff always see all tabs. Owners are denied OWNER_HIDDEN_TABS.
 * Unknown/null roles are treated as owner-level (most restrictive safe default).
 */
export function shouldShowTab(tabId: string, role: string | null | undefined): boolean {
  if (isStaff(role)) return true;
  return !OWNER_HIDDEN_TABS.includes(tabId);
}

/**
 * Returns true if the given field should be shown / editable for the given role.
 * Staff always see all fields. Owners are denied OWNER_HIDDEN_FIELDS.
 * Unknown/null roles are treated as owner-level.
 */
export function shouldShowField(field: string, role: string | null | undefined): boolean {
  if (isStaff(role)) return true;
  return !OWNER_HIDDEN_FIELDS.includes(field);
}

/**
 * Returns true if the user can trigger a Publish to Production ("Go Live").
 * Only admin and superadmin can publish to production.
 * Salon owners can only publish to staging (Preview).
 */
export function canPublishToProduction(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

/**
 * Returns true if the user can switch the design template.
 * Only staff (admin / superadmin) can change the template.
 */
export function canSwitchTemplate(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}
