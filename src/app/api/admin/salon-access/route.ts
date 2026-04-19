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
} from "@/lib/db";
import { logEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const slug = request.nextUrl.searchParams.get("slug");
  const email = request.nextUrl.searchParams.get("email");
  if (slug) return NextResponse.json({ slug, users: listUsersForSalon(slug) });
  if (email) return NextResponse.json({ email, slugs: listSalonsForUser(email) });
  return NextResponse.json({ error: "Provide ?slug or ?email" }, { status: 400 });
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
  logEvent({ email: auth.session.email, action: "salon_access_grant", slug, diff: JSON.stringify({ to: email }) });
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
