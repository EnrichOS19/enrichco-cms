import { NextRequest, NextResponse } from "next/server";
import { getAllSalons } from "@/lib/salons";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;

  const salons = getAllSalons();
  return NextResponse.json(salons);
}
