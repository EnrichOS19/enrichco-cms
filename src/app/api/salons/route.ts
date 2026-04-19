import { NextRequest, NextResponse } from "next/server";
import { getAllSalons } from "@/lib/salons";
import { requireSession } from "@/lib/auth";
import { isStaffRole, listSalonsForUser, type UserRole } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const all = getAllSalons();
  const role = session.role as UserRole;
  if (isStaffRole(role)) {
    return NextResponse.json(all);
  }

  // Salon owners (or any non-staff role) see only the salons they own.
  const owned = new Set(listSalonsForUser(session.email));
  const scoped = all.filter((s) => {
    const slug = (s as { slug?: string }).slug ?? "";
    return owned.has(slug);
  });
  return NextResponse.json(scoped);
}
