/**
 * Status Route — tell the editor UI which build is currently LIVE on each
 * target (staging / production) and whether the draft has drifted ahead.
 *
 * Read-only. Never mutates anything. Polled every ~10s by the
 * <PublishStatusBar /> component.
 *
 * The three "where does my content live?" states:
 *   - Draft       → what's in salon.json right now (always the reference)
 *   - Staging     → what was last published to {slug}.staging.enrichco.us
 *   - Production  → what was last published to the real customer-facing domain
 *
 * For each target we return a `state` that maps to a dot color in the UI:
 *   never_published → yellow  (no publish row in drift TSV)
 *   live_matches    → green   (live /deploy.json hash == expected)
 *   drift           → yellow  (live hash != expected, or draft changed since publish)
 *   failed_fetch    → red     (DNS/TLS/network broken)
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { requireSalonAccess } from "@/lib/auth";
import { getSalonConfig, getSalonSiteDir } from "@/lib/salons";

export const dynamic = "force-dynamic";
// Keep short so the polling UI stays fresh; longer than a single poll so
// parallel tabs still benefit and the three upstream fetches aren't redone.
export const maxDuration = 30;

const EXPECTED_HASHES_TSV = "/var/log/cms-drift/expected-hashes.tsv";

export type TargetState =
  | "never_published"
  | "live_matches"
  | "drift"
  | "failed_fetch";

export interface StatusPayload {
  slug: string;
  draft: {
    savedAt: string | null;
    hash: string | null;
  };
  staging: TargetStatus;
  production: TargetStatus;
}

export interface TargetStatus {
  domain: string | null;
  publishedAt: string | null;
  expectedHash: string | null;
  liveHash: string | null;
  state: TargetState;
}

/**
 * Parse the drift TSV and return the MOST RECENT row matching (slug, domain).
 * TSV is appended to by every publish:
 *   slug\thash\tdomain\tISO-timestamp\n
 *
 * Server-only path — tests mock fs.readFileSync. Missing file is not an error
 * (fresh server, or pre-drift-log installs) → returns null.
 */
export function readLatestExpectedHash(
  slug: string,
  domain: string,
  tsvPath: string = EXPECTED_HASHES_TSV
): { hash: string; publishedAt: string } | null {
  let raw: string;
  try {
    raw = fs.readFileSync(tsvPath, "utf-8");
  } catch {
    return null;
  }
  const domainLower = domain.toLowerCase();
  const lines = raw.split("\n");
  // Walk from the end — most recent row wins.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    const [rowSlug, rowHash, rowDomain, rowTs] = line.split("\t");
    if (rowSlug === slug && rowDomain?.toLowerCase() === domainLower) {
      if (rowHash && rowTs) return { hash: rowHash, publishedAt: rowTs };
    }
  }
  return null;
}

/**
 * Fetch {domain}/deploy.json and return its hash.
 * Same wire pattern as verifyLiveDeploy but this one never "fails" — it just
 * reports liveHash=null when the site is unreachable, so the caller can
 * classify the status as failed_fetch vs drift.
 */
export async function fetchLiveHash(
  domain: string,
  cacheBuster: string
): Promise<{ liveHash: string | null; ok: boolean }> {
  const domainLower = domain.toLowerCase();
  const url = `https://${domainLower}/deploy.json?_v=${cacheBuster}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { liveHash: null, ok: false };
    const body = (await res.json()) as { hash?: string };
    return { liveHash: typeof body.hash === "string" ? body.hash : null, ok: true };
  } catch {
    return { liveHash: null, ok: false };
  }
}

export function classifyTarget(
  expected: { hash: string; publishedAt: string } | null,
  live: { liveHash: string | null; ok: boolean },
  draftSavedAt: string | null
): TargetState {
  if (!expected) return "never_published";
  if (!live.ok) return "failed_fetch";
  if (live.liveHash !== expected.hash) return "drift";
  // Live hash matches what we published — but if the CMS draft has been
  // saved AFTER that publish, users hitting the live URL will see stale
  // content. Surface that as drift so the UI prompts "Update preview".
  if (draftSavedAt && expected.publishedAt) {
    const savedMs = Date.parse(draftSavedAt);
    const publishedMs = Date.parse(expected.publishedAt);
    if (!Number.isNaN(savedMs) && !Number.isNaN(publishedMs) && savedMs > publishedMs) {
      return "drift";
    }
  }
  return "live_matches";
}

async function buildTargetStatus(
  slug: string,
  domain: string | null | undefined,
  draftSavedAt: string | null
): Promise<TargetStatus> {
  if (!domain) {
    return {
      domain: null,
      publishedAt: null,
      expectedHash: null,
      liveHash: null,
      state: "never_published",
    };
  }
  const expected = readLatestExpectedHash(slug, domain);
  if (!expected) {
    // No publish has ever happened for this (slug, domain). Skip the live
    // fetch — it can't flip the state to green, so sending one every 10s
    // per open editor tab is wasted bandwidth to the salon site.
    return {
      domain: domain.toLowerCase(),
      publishedAt: null,
      expectedHash: null,
      liveHash: null,
      state: "never_published",
    };
  }
  // Cache-buster: use expected hash (matches verifyLiveDeploy convention).
  const live = await fetchLiveHash(domain, expected.hash);
  return {
    domain: domain.toLowerCase(),
    publishedAt: expected.publishedAt,
    expectedHash: expected.hash,
    liveHash: live.liveHash,
    state: classifyTarget(expected, live, draftSavedAt),
  };
}

/**
 * SHA-256 the on-disk salon.json bytes (first 16 hex chars). Lets the UI
 * tell "draft has drifted past the last publish" apart from "draft matches
 * last publish". This is NOT the deploy hash (which comes from the built
 * out/ directory) — it's a lightweight hint, not a security boundary.
 */
function hashSalonJson(siteDir: string): { hash: string | null; savedAt: string | null } {
  const cfgPath = path.join(siteDir, "config", "salon.json");
  try {
    const bytes = fs.readFileSync(cfgPath);
    const stat = fs.statSync(cfgPath);
    return {
      hash: crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16),
      savedAt: stat.mtime.toISOString(),
    };
  } catch {
    return { hash: null, savedAt: null };
  }
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
    return NextResponse.json({ error: "Salon site directory not found" }, { status: 404 });
  }

  const salonResult = getSalonConfig(slug);
  const config = salonResult?.config;
  if (!config) {
    return NextResponse.json({ error: "Salon config not found" }, { status: 404 });
  }

  const draft = hashSalonJson(siteDir);

  // Run both live checks in parallel — saves ~8s worst case vs serial when
  // a target is down.
  const [staging, production] = await Promise.all([
    buildTargetStatus(slug, config.stagingDomain, draft.savedAt),
    buildTargetStatus(slug, config.domain, draft.savedAt),
  ]);

  const payload: StatusPayload = {
    slug,
    draft,
    staging,
    production,
  };

  return NextResponse.json(payload, {
    headers: {
      // 10s lines up with the client poll interval — keeps the server
      // friendly on tabs left open all day without masking real drift.
      "Cache-Control": "private, max-age=10",
    },
  });
}
