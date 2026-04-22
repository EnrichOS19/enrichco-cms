/**
 * GET /api/admin/ims-lookup?email=<email>
 *
 * Admin-only. Queries IMS ListMerchants (server-side) and returns the matching
 * merchant record so the admin can confirm they're granting access to the right person.
 *
 * Strategy:
 *   - Authenticate to IMS with a service account (IMS_SERVICE_EMAIL / IMS_SERVICE_PASSWORD).
 *   - Call POST /api/Customer/ListMerchants with pageSize=500 to pull all ~579 records.
 *   - Filter in-process for a case-insensitive email match.
 *   - Cache the IMS service token for 50 minutes (well under 60-min IMS TTL).
 *   - Cache the merchant list for 5 minutes.
 *
 * Returns:
 *   { found: true, name: string, businessName: string, storeID: number }
 *   { found: false }
 *   { found: false, warning: string }  — when IMS is not configured or unreachable
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { findSlugByRvcNo } from "@/lib/salons";

export const dynamic = "force-dynamic";

// ── env var accessors (read at request time so tests can mutate process.env) ──

function getImsAuthUrl() { return process.env.IMS_AUTH_URL ?? "https://imsnext-auth.enrichco.us"; }
function getImsPortalUrl() { return process.env.IMS_PORTAL_URL ?? "https://imsnext-portal.enrichco.us"; }
function getImsServiceEmail() { return process.env.IMS_SERVICE_EMAIL; }
function getImsServicePassword() { return process.env.IMS_SERVICE_PASSWORD; }

// ── in-process cache ──────────────────────────────────────────────────────────

interface ImsTokenCache {
  token: string;
  expiresAt: number; // ms epoch
}

interface ImsMerchant {
  email?: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  storeID?: number;
}

interface ImsMerchantCache {
  merchants: ImsMerchant[];
  fetchedAt: number; // ms epoch
}

let _tokenCache: ImsTokenCache | null = null;
let _merchantCache: ImsMerchantCache | null = null;

/** Reset in-process caches — exposed for unit tests only. */
export function _resetCaches() {
  _tokenCache = null;
  _merchantCache = null;
}

const TOKEN_TTL_MS = 50 * 60 * 1000;   // 50 minutes
const MERCHANT_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── IMS auth ─────────────────────────────────────────────────────────────────

async function getImsServiceToken(): Promise<string | null> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token;
  }

  try {
    const res = await fetch(`${getImsAuthUrl()}/api/Authentication/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: getImsServiceEmail(), password: getImsServicePassword() }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { return?: boolean; token?: string };
    if (!data.return || !data.token) return null;

    _tokenCache = { token: data.token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return data.token;
  } catch {
    return null;
  }
}

// ── IMS merchant list ─────────────────────────────────────────────────────────

async function getMerchantList(token: string): Promise<ImsMerchant[]> {
  if (_merchantCache && Date.now() < _merchantCache.fetchedAt + MERCHANT_TTL_MS) {
    return _merchantCache.merchants;
  }

  try {
    const res = await fetch(`${getImsPortalUrl()}/api/Customer/ListMerchants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ search: "", page: 1, pageSize: 500 }),
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: ImsMerchant[] };
    const merchants = data.data ?? [];
    _merchantCache = { merchants, fetchedAt: Date.now() };
    return merchants;
  } catch {
    return [];
  }
}

// ── route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "?email query param is required" }, { status: 400 });
  }

  // IMS not configured — return graceful degradation
  if (!getImsServiceEmail() || !getImsServicePassword()) {
    return NextResponse.json({
      found: false,
      warning: "IMS lookup not configured — set IMS_SERVICE_EMAIL and IMS_SERVICE_PASSWORD",
    });
  }

  // Get service token
  const token = await getImsServiceToken();
  if (!token) {
    return NextResponse.json({
      found: false,
      warning: "IMS authentication failed — check service credentials",
    });
  }

  // Fetch + search merchant list
  const merchants = await getMerchantList(token);
  const match = merchants.find(
    (m) => typeof m.email === "string" && m.email.toLowerCase() === email
  );

  if (!match) {
    return NextResponse.json({ found: false });
  }

  const name = [match.firstName, match.lastName].filter(Boolean).join(" ");

  // Map IMS storeID → CMS salon slug by matching salon.json.rvcNo. Only ~11
  // of 127 salons have rvcNo populated today; rest return null (no CMS match),
  // which the UI surfaces so the admin still picks a salon manually.
  const suggestedSlug = typeof match.storeID === "number"
    ? findSlugByRvcNo(match.storeID)
    : null;

  return NextResponse.json({
    found: true,
    name: name || null,
    businessName: match.businessName ?? null,
    storeID: match.storeID ?? null,
    suggestedSlug,
  });
}
