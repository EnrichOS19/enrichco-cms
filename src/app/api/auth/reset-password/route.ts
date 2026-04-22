import { NextRequest, NextResponse } from "next/server";
import { validateResetToken } from "@/lib/db";

/** GET — validate a reset token without consuming it (for the reset form page) */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token is required" }, { status: 400 });

  const email = validateResetToken(token);
  if (!email) return NextResponse.json({ error: "This reset link is invalid or has expired" }, { status: 400 });

  return NextResponse.json({ email });
}

/** POST — disabled until IMS password change API is available.
 *  Returns 501 WITHOUT consuming the token. */
export async function POST() {
  return NextResponse.json(
    {
      error: "Online password reset is not yet available. Please contact your system administrator.",
      admin_reset_required: true,
    },
    { status: 501 }
  );
}
