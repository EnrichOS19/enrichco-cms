/**
 * Revision History — List route
 *
 * GET /api/salon/[slug]/revisions
 *
 * Returns up to 100 most recent salon.json backups for the salon, newest first.
 * Enriches each entry with author / action / changedFields from the audit_log
 * (matched on ±5s timestamp tolerance).
 *
 * Rapid-fire saves (< 10s apart with the same author) collapse into a single
 * entry so auto-save noise doesn't clutter the view.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSalonAccess } from "@/lib/auth";
import { findAuditEntryNearTimestamp } from "@/lib/audit";
import { listSalonConfigBackupMeta, getSalonSiteDir } from "@/lib/salons";

export const dynamic = "force-dynamic";

const MAX_REVISIONS = 100;
const COLLAPSE_WINDOW_MS = 10_000;

export interface RevisionEntry {
  id: string;
  timestamp: string;
  fileBytes: number;
  author: string | null;
  action: string | null;
  changedFields: string[] | null;
}

function changedFieldsFromDiff(diff: string | undefined | null): string[] | null {
  if (!diff) return null;
  try {
    const parsed = JSON.parse(diff);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.keys(parsed);
    }
  } catch {
    // Legacy rows store non-JSON strings (e.g. "salon.json.bak.xxx") — ignore.
  }
  return null;
}

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

  const backups = listSalonConfigBackupMeta(slug).slice(0, MAX_REVISIONS);

  // Attach audit metadata per backup.
  const hydrated: (RevisionEntry & { timestampMs: number })[] = backups.map((b) => {
    const audit = findAuditEntryNearTimestamp(slug, b.timestampMs, 5000);
    return {
      id: b.id,
      timestamp: b.timestamp,
      timestampMs: b.timestampMs,
      fileBytes: b.fileBytes,
      author: audit?.email ?? null,
      action: audit?.action ?? null,
      changedFields: changedFieldsFromDiff(audit?.diff),
    };
  });

  // Collapse rapid-fire saves (< 10s apart, same author) into the newer entry.
  // Entries are newest-first, so walk forward and fold older neighbors into
  // the current head when the author+time window matches.
  const collapsed: RevisionEntry[] = [];
  for (const entry of hydrated) {
    const head = collapsed[collapsed.length - 1] as (RevisionEntry & { timestampMs?: number }) | undefined;
    const headMs = head ? Date.parse(head.timestamp) : NaN;
    const sameAuthor =
      head !== undefined &&
      head.author !== null &&
      entry.author !== null &&
      head.author === entry.author;
    const withinWindow =
      head !== undefined &&
      Number.isFinite(headMs) &&
      headMs - entry.timestampMs < COLLAPSE_WINDOW_MS &&
      headMs - entry.timestampMs >= 0;

    if (sameAuthor && withinWindow) {
      // Fold: union changedFields into the newer head entry. Keep head's id/timestamp.
      const merged = new Set<string>([...(head!.changedFields ?? []), ...(entry.changedFields ?? [])]);
      head!.changedFields = merged.size > 0 ? Array.from(merged) : head!.changedFields;
    } else {
      const { timestampMs: _omit, ...publicFields } = entry;
      void _omit;
      collapsed.push(publicFields);
    }
  }

  return NextResponse.json(
    { revisions: collapsed },
    {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    }
  );
}
