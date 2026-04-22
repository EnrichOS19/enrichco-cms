import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { listUsers, updateUserRole, deactivateUser, reactivateUser, inviteUser, type UserRole } from "@/lib/db";

/** GET /api/admin/users — list all users (superadmin only) */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("response" in auth) return auth.response;

  const users = listUsers();
  return NextResponse.json(users);
}

/** POST /api/admin/users — invite (pre-register) a user (superadmin only) */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body?.email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  const role = body.role === "admin" ? "admin" : "support";
  const created = inviteUser(body.email, role as UserRole, body.name || "");
  if (!created) {
    return NextResponse.json({ error: "User already exists" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, email: body.email, role, message: "User invited" }, { status: 201 });
}

/** PATCH /api/admin/users — update a user's role (superadmin only) */
export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.role) {
    return NextResponse.json({ error: "email and role are required" }, { status: 400 });
  }

  const validRoles: UserRole[] = ["admin", "support"];
  if (!validRoles.includes(body.role)) {
    return NextResponse.json({ error: "Invalid role. Must be 'admin' or 'support'" }, { status: 400 });
  }

  const updated = updateUserRole(body.email, body.role);
  if (!updated) {
    return NextResponse.json({ error: "User not found or cannot change super admin role" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, email: body.email, role: body.role });
}

/** DELETE /api/admin/users — deactivate a user (superadmin only) */
export async function DELETE(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("response" in auth) return auth.response;

  const { email, reactivate } = await request.json().catch(() => ({ email: null, reactivate: false }));
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  if (reactivate) {
    const ok = reactivateUser(email);
    return ok
      ? NextResponse.json({ ok: true, message: `${email} reactivated` })
      : NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const ok = deactivateUser(email);
  if (!ok) {
    return NextResponse.json({ error: "User not found or cannot deactivate super admin" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, message: `${email} deactivated` });
}
