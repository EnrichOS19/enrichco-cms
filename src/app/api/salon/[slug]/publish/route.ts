/**
 * Publish Route — Phase 3B
 *
 * Auth + validation + lock → delegates to buildAndDeploy() from lib/publish.ts.
 * Build happens in a temp copy of the site; source tree is never mutated.
 * Shared template components are injected before every build.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSalonConfig, getSalonSiteDir } from "@/lib/salons";
import { requireSession } from "@/lib/auth";
import { logEvent } from "@/lib/audit";
import { buildAndDeploy, publishLocks } from "@/lib/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const { slug } = await params;
  const siteDir = getSalonSiteDir(slug);
  if (!siteDir) {
    return NextResponse.json({ error: "Salon site directory not found" }, { status: 404 });
  }

  const salonResult = getSalonConfig(slug);
  const config = salonResult?.config;
  const siteStatus = config?.siteStatus ?? "staging";

  const targetOverride = request.nextUrl.searchParams.get("target");
  const isProduction = targetOverride === "staging" ? false : siteStatus === "production";

  const domain = isProduction ? config?.domain : config?.stagingDomain;
  if (!domain) {
    const missing = isProduction ? "domain" : "stagingDomain";
    return NextResponse.json(
      { error: `Salon has no ${missing} configured. Set it in the Settings tab before publishing.` },
      { status: 422 }
    );
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*\.[a-zA-Z]{2,}$/.test(domain)) {
    return NextResponse.json({ error: "Invalid domain format" }, { status: 422 });
  }

  if (publishLocks.has(slug)) {
    return NextResponse.json(
      { error: "A publish for this salon is already in progress. Please wait for it to finish." },
      { status: 429 }
    );
  }
  publishLocks.add(slug);

  try {
    const result = await buildAndDeploy(siteDir, domain, slug);

    logEvent({
      email: session.email,
      action: isProduction ? "publish_production" : "publish_staging",
      slug,
      deploy_hash: result.deployHash,
    });

    return NextResponse.json({
      ok: true,
      domain,
      siteStatus,
      steps: result.steps,
      deploy_hash: result.deployHash,
      build: { stdout: result.stdout, stderr: result.stderr },
    });
  } catch (error: unknown) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    const sanitize = (s: string) =>
      s.replace(/\/Users\/[^\s:]+/g, "[path]").replace(/\/opt\/[^\s:]+/g, "[path]");
    return NextResponse.json(
      {
        error: "Publish failed",
        message: sanitize(err.message || "Unknown error"),
      },
      { status: 500 }
    );
  } finally {
    publishLocks.delete(slug);
  }
}
