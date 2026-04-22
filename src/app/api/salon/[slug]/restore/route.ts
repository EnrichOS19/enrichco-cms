/**
 * Restore Route — Phase 3C (Layer 1: Config Rollback)
 *
 * GET  /api/salon/[slug]/restore  — list available backups
 * POST /api/salon/[slug]/restore  — restore salon.json from a named backup
 *
 * Backups are created automatically on every PUT /api/salon/[slug] save.
 * Each backup is named salon.json.bak.<uuid> to avoid timestamp collisions.
 * Last 10 backups per salon are kept; older ones are rotated out.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSalonSiteDir, listSalonConfigBackups, restoreSalonConfig } from "@/lib/salons";
import { requireSalonAccess } from "@/lib/auth";
import { logEvent } from "@/lib/audit";
import path from "path";

export const dynamic = "force-dynamic";

/** GET — list available backup filenames for a salon */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await requireSalonAccess(request, slug);
  if ("response" in auth) return auth.response;

  const siteDir = getSalonSiteDir(slug);
  if (!siteDir) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  const backups = listSalonConfigBackups(slug);
  return NextResponse.json({ backups });
}

/** POST — restore salon.json from a named backup */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await requireSalonAccess(request, slug);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  let body: { backup?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.backup || typeof body.backup !== "string") {
    return NextResponse.json(
      { error: "backup filename is required" },
      { status: 400 }
    );
  }

  // Security: only allow filenames that match the backup pattern
  if (!body.backup.startsWith("salon.json.bak.")) {
    return NextResponse.json(
      { error: "Invalid backup filename" },
      { status: 400 }
    );
  }

  const siteDir = getSalonSiteDir(slug);
  if (!siteDir) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  // Path traversal guard: resolved backup path must stay inside the config dir
  const configDir = path.join(siteDir, "config");
  const resolvedBackupPath = path.resolve(configDir, body.backup);
  if (!resolvedBackupPath.startsWith(path.resolve(configDir) + path.sep)) {
    return NextResponse.json(
      { error: "Invalid backup filename" },
      { status: 400 }
    );
  }

  const success = restoreSalonConfig(slug, body.backup);
  if (!success) {
    return NextResponse.json(
      { error: "Backup file not found" },
      { status: 404 }
    );
  }

  // Phase 3B: audit log
  logEvent({
    email: session.email,
    action: "restore",
    slug,
    diff: body.backup,
  });

  return NextResponse.json({ ok: true, restored: body.backup });
}
