import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAuthDisabled, COOKIE_NAME } from "@/lib/auth";
import { getSession } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isAuthDisabled()) {
    return NextResponse.json({
      authenticated: true,
      email: "dev@enrichco.us",
      role: "superadmin",
    });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const session = getSession(token);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    email: session.email,
    role: session.role,
  });
}
