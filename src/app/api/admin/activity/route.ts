import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { getAllAuditLog } from "@/lib/audit";

/** GET /api/admin/activity — recent audit log (superadmin only) */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("response" in auth) return auth.response;

  const limit = Number(request.nextUrl.searchParams.get("limit")) || 50;
  const entries = getAllAuditLog(Math.min(limit, 200));
  return NextResponse.json(entries);
}
