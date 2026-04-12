/**
 * Admin endpoint — revoke all sessions for a given email.
 *
 * Use case: terminated staff, compromised account, suspicious activity.
 * Requires admin role.
 *
 * DELETE /api/auth/revoke?email=user@example.com
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { revokeAllSessionsForEmail } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest) {
  // Only admins can revoke sessions
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const email = request.nextUrl.searchParams.get("email");
  if (!email) {
    return NextResponse.json(
      { error: "email query parameter is required" },
      { status: 400 }
    );
  }

  const revoked = revokeAllSessionsForEmail(email);

  return NextResponse.json({
    ok: true,
    email,
    sessions_revoked: revoked,
  });
}
