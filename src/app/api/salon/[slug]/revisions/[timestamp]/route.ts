/**
 * Revision History — Read single revision
 *
 * GET /api/salon/[slug]/revisions/[timestamp]
 *
 * Returns the full parsed JSON contents of the named backup.
 * The `[timestamp]` path param is actually the backup id (filename suffix
 * after `salon.json.bak.`), kept as `[timestamp]` for URL ergonomics.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSalonAccess } from "@/lib/auth";
import { readSalonConfigBackup, getSalonSiteDir } from "@/lib/salons";

export const dynamic = "force-dynamic";

// Allowed characters in a backup id: alphanumerics, dash, underscore, colon, dot.
// Explicitly rejects `/`, `..`, and other path characters.
const VALID_ID_RE = /^[A-Za-z0-9._:-]+$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; timestamp: string }> }
) {
  const { slug, timestamp } = await params;
  const auth = await requireSalonAccess(request, slug);
  if ("response" in auth) return auth.response;

  // Defense-in-depth: reject ids with path separators or parent-dir traversal
  // before touching the filesystem. The readSalonConfigBackup helper also
  // enforces a resolved-path guard.
  if (!timestamp || timestamp.includes("/") || timestamp.includes("\\") || timestamp.includes("..") || !VALID_ID_RE.test(timestamp)) {
    return NextResponse.json({ error: "Invalid revision id" }, { status: 400 });
  }

  const siteDir = getSalonSiteDir(slug);
  if (!siteDir) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  const result = readSalonConfigBackup(slug, timestamp);
  if (!result) {
    return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  }

  return NextResponse.json(result.content, {
    headers: {
      "Cache-Control": "private, max-age=60",
    },
  });
}
