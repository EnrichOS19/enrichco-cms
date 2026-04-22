/**
 * Revision History — Restore a revision
 *
 * POST /api/salon/[slug]/revisions/[timestamp]/restore
 *
 * Behavior:
 *   1. Snapshot the current salon.json to a new `pre-restore-<now>` backup
 *      so the restore itself is undoable.
 *   2. Copy the named revision's .bak file over salon.json.
 *   3. For salon_owner sessions, validate the restored payload against
 *      ownerSalonSchema (strict) as a defense-in-depth guard — should a
 *      legacy pre-allowlist backup ever contain protected fields, the
 *      restore is rejected before audit + response.
 *   4. Emit an audit_log entry with action="restore".
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSalonAccess } from "@/lib/auth";
import { logEvent } from "@/lib/audit";
import {
  readSalonConfigBackup,
  restoreSalonConfigWithUndo,
  getSalonSiteDir,
} from "@/lib/salons";
import { ownerSalonSchema } from "@/lib/schemas/salon";

export const dynamic = "force-dynamic";

const VALID_ID_RE = /^[A-Za-z0-9._:-]+$/;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; timestamp: string }> }
) {
  const { slug, timestamp } = await params;
  const auth = await requireSalonAccess(request, slug);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  if (!timestamp || timestamp.includes("/") || timestamp.includes("\\") || timestamp.includes("..") || !VALID_ID_RE.test(timestamp)) {
    return NextResponse.json({ error: "Invalid revision id" }, { status: 400 });
  }

  const siteDir = getSalonSiteDir(slug);
  if (!siteDir) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  // Owner defense-in-depth: peek at the backup contents first and reject if
  // it contains fields the owner isn't allowed to set today. Protects against
  // restoring a legacy bak file that predates OWNER_PROTECTED_FIELDS stripping.
  if (session.role === "salon_owner") {
    const peek = readSalonConfigBackup(slug, timestamp);
    if (!peek) {
      return NextResponse.json({ error: "Revision not found" }, { status: 404 });
    }
    const parsed = ownerSalonSchema.safeParse(peek.content);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Revision contains fields your role cannot restore. Ask an admin." },
        { status: 400 }
      );
    }
  }

  const result = restoreSalonConfigWithUndo(slug, timestamp);
  if (!result) {
    return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  }

  logEvent({
    email: session.email,
    action: "restore",
    slug,
    diff: JSON.stringify({ restoredFrom: timestamp, preRestoreId: result.preRestoreId }),
  });

  return NextResponse.json({
    ok: true,
    restoredFrom: timestamp,
    backupId: result.preRestoreId,
  });
}
