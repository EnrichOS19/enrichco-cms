import { NextResponse } from "next/server";

export async function GET() {
  let dbStatus = "ok";
  try {
    // Verify SQLite is accessible
    const { getSession } = await import("@/lib/db");
    getSession("health-check-probe"); // Will return null but proves DB is queryable
  } catch {
    dbStatus = "error";
  }

  const status = dbStatus === "ok" ? "ok" : "degraded";
  return NextResponse.json({
    status,
    uptime: Math.floor(process.uptime()),
    db: dbStatus,
  });
}
