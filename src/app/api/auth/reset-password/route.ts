import { NextRequest, NextResponse } from "next/server";
import { verifyResetToken } from "@/lib/db";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token is required" }, { status: 400 });

  const email = verifyResetToken(token);
  if (!email) return NextResponse.json({ error: "This reset link is invalid or has expired" }, { status: 400 });

  return NextResponse.json({ email });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const { token, newPassword } = body ?? {};

  if (!token || !newPassword) {
    return NextResponse.json({ error: "Token and new password are required" }, { status: 400 });
  }

  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const email = verifyResetToken(token);
  if (!email) return NextResponse.json({ error: "This reset link is invalid or has expired" }, { status: 400 });

  // IMS does not expose a programmatic password reset API.
  // Direct users to contact admin until IMS team adds the endpoint.
  return NextResponse.json(
    {
      error: "Online password reset is not yet available. Please contact your system administrator.",
      admin_reset_required: true,
    },
    { status: 422 }
  );
}
