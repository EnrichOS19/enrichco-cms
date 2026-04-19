/**
 * Admin — grant/revoke salon access for salon_owner users.
 *
 * Staff-only (requireAdmin). Owners cannot manage their own or others' access.
 *
 *   GET   ?slug=<slug>            → list users with access to this salon
 *   GET   ?email=<email>          → list slugs this user has access to
 *   POST  { email, slug }         → grant
 *   DELETE { email, slug }        → revoke
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  grantSalonAccess,
  revokeSalonAccess,
  listSalonsForUser,
  listUsersForSalon,
  listAllGrants,
  setSalonGrantStoreId,
} from "@/lib/db";
import { logEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const slug = request.nextUrl.searchParams.get("slug");
  const email = request.nextUrl.searchParams.get("email");
  const all = request.nextUrl.searchParams.get("all");

  if (all === "true") {
    const raw = listAllGrants();
    const grants = raw.map((g) => ({
      email: g.user_email,
      slug: g.slug,
      grantedBy: g.granted_by,
      grantedAt: g.granted_at,
      imsStoreId: g.ims_store_id ?? null,
    }));
    return NextResponse.json({ grants });
  }

  if (slug) return NextResponse.json({ slug, users: listUsersForSalon(slug) });
  if (email) return NextResponse.json({ email, slugs: listSalonsForUser(email) });
  return NextResponse.json({ error: "Provide ?slug, ?email, or ?all=true" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : null;
  const slug = typeof body?.slug === "string" ? body.slug.trim() : null;
  if (!email || !slug) {
    return NextResponse.json({ error: "email and slug are required" }, { status: 400 });
  }

  const ok = grantSalonAccess(email, slug, auth.session.email);

  // If the caller supplied an IMS store ID (from ims-lookup), record it on the grant
  const imsStoreId = typeof body?.ims_store_id === "string" ? body.ims_store_id.trim() : null;
  if (ok && imsStoreId) {
    setSalonGrantStoreId(email, slug, imsStoreId);
  }

  logEvent({ email: auth.session.email, action: "salon_access_grant", slug, diff: JSON.stringify({ to: email, imsStoreId }) });
  return NextResponse.json({ ok });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : null;
  const slug = typeof body?.slug === "string" ? body.slug.trim() : null;
  if (!email || !slug) {
    return NextResponse.json({ error: "email and slug are required" }, { status: 400 });
  }

  const ok = revokeSalonAccess(email, slug);
  logEvent({ email: auth.session.email, action: "salon_access_revoke", slug, diff: JSON.stringify({ from: email }) });
  return NextResponse.json({ ok });
}
