// cms/src/app/api/template/rebuild-all/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { randomUUID } from "crypto";
import { requireSession, requireSuperAdmin } from "@/lib/auth";
import { logEvent } from "@/lib/audit";
import { getAllSalons, getSalonSiteDir, getSalonConfig } from "@/lib/salons";
import { buildAndDeploy, publishLocks } from "@/lib/publish";

export const dynamic = "force-dynamic";

interface JobStatus {
  jobId: string;
  startedAt: string;
  total: number;
  completed: number;
  failed: number;
  dryRun: boolean;
  current: string | null;
  results: { slug: string; ok: boolean; error?: string; deployHash?: string }[];
  done: boolean;
}

function statusPath(jobId: string) {
  return `/tmp/rebuild-job-${jobId}.json`;
}

function writeStatus(jobId: string, status: JobStatus) {
  fs.writeFileSync(statusPath(jobId), JSON.stringify(status, null, 2));
}

async function runRebuildJob(slugs: string[], jobId: string, dryRun: boolean) {
  const status: JobStatus = {
    jobId,
    startedAt: new Date().toISOString(),
    total: slugs.length,
    completed: 0,
    failed: 0,
    dryRun,
    current: null,
    results: [],
    done: false,
  };
  writeStatus(jobId, status);

  for (const slug of slugs) {
    // Don't clobber a live single-site publish
    if (publishLocks.has(slug)) {
      status.failed++;
      status.results.push({ slug, ok: false, error: "Skipped: publish in progress for this slug" });
      writeStatus(jobId, status);
      continue;
    }

    publishLocks.add(slug);
    status.current = slug;
    writeStatus(jobId, status);

    try {
      const siteDir = getSalonSiteDir(slug);
      if (!siteDir) throw new Error("Site directory not found");

      const config = getSalonConfig(slug)?.config;
      const domain = config?.domain;
      if (!domain) throw new Error("No production domain configured");

      const result = await buildAndDeploy(siteDir, domain, slug, dryRun);

      status.completed++;
      status.results.push({ slug, ok: true, deployHash: result.deployHash });
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message || "Unknown error";
      status.failed++;
      status.results.push({ slug, ok: false, error: msg });
    } finally {
      publishLocks.delete(slug);
    }

    writeStatus(jobId, status);
  }

  status.current = null;
  status.done = true;
  writeStatus(jobId, status);
}

// POST — start a batch rebuild job
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  let body: { slugs?: string[]; dryRun?: boolean } = {};
  try { body = await request.json(); } catch {}

  const dryRun = body.dryRun === true;

  let slugs: string[];

  if (Array.isArray(body.slugs) && body.slugs.length > 0) {
    // Validate: only lowercase slug characters, deduplicate
    const seen = new Set<string>();
    slugs = body.slugs.filter(
      (s): s is string =>
        typeof s === "string" &&
        /^[a-z0-9-]+$/.test(s) &&
        !seen.has(s) &&
        !!seen.add(s)
    );
    if (slugs.length === 0) {
      return NextResponse.json({ error: "No valid slugs after filtering" }, { status: 400 });
    }
  } else {
    // Default: all production sites with a configured domain
    const productionSlugs: string[] = [];
    for (const s of getAllSalons()) {
      const config = getSalonConfig(s.slug)?.config;
      if (config?.siteStatus === "production" && config?.domain) {
        productionSlugs.push(s.slug);
      }
    }
    if (productionSlugs.length === 0) {
      return NextResponse.json({ error: "No production sites found" }, { status: 400 });
    }
    slugs = productionSlugs;
  }

  const jobId = randomUUID().slice(0, 8);

  logEvent({
    email: session.email,
    action: dryRun ? "template_rebuild_dry_run" : "template_rebuild_all",
    slug: `${slugs.length} sites`,
    deploy_hash: jobId,
  });

  // Fire and forget — runs in background while route returns immediately
  // NOTE: on single-server deployment this is reliable. If CMS restarts mid-job,
  // in-progress builds are abandoned; their /tmp dirs are cleaned up by buildAndDeploy's finally block.
  setImmediate(() => { runRebuildJob(slugs, jobId, dryRun).catch(console.error); });

  return NextResponse.json({
    jobId,
    total: slugs.length,
    dryRun,
    statusUrl: `/api/template/rebuild-all?jobId=${jobId}`,
  });
}

// GET — poll job status
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;

  const jobId = request.nextUrl.searchParams.get("jobId");
  // Validate job ID format to prevent path traversal on statusPath
  if (!jobId || !/^[a-f0-9-]{8}$/.test(jobId)) {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
  }

  const file = statusPath(jobId);
  if (!fs.existsSync(file)) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json(JSON.parse(fs.readFileSync(file, "utf-8")));
}
