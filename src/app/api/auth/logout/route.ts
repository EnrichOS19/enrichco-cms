import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { revokeSession } from "@/lib/db";

export async function POST(request: NextRequest) {
  // Revoke the server-side session so the token can't be reused
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (token) {
    revokeSession(token);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_NAME);
  res.cookies.delete("cms-user");
  return res;
}
