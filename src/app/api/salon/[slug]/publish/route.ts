/**
 * Publish Route — Phase 3B
 *
 * Auth + validation + lock → delegates to buildAndDeploy() from lib/publish.ts.
 * Build happens in a temp copy of the site; source tree is never mutated.
 * Shared template components are injected before every build.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSalonConfig, getSalonSiteDir } from "@/lib/salons";
import { requireSalonAccess } from "@/lib/auth";
import { isStaffRole, type UserRole } from "@/lib/db";
import { logEvent } from "@/lib/audit";
import { buildAndDeploy, publishLocks, verifyLiveDeploy } from "@/lib/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await requireSalonAccess(request, slug);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const siteDir = getSalonSiteDir(slug);
  if (!siteDir) {
    return NextResponse.json({ error: "Salon site directory not found" }, { status: 404 });
  }

  const salonResult = getSalonConfig(slug);
  const config = salonResult?.config;
  const siteStatus = config?.siteStatus ?? "staging";

  const targetOverride = request.nextUrl.searchParams.get("target");
  const isProduction = targetOverride === "staging" ? false : siteStatus === "production";

  // Salon owners can publish to staging only. Promoting to production
  // requires a staff (admin/superadmin/support) role — protects live
  // customer-facing domains from owner-side mistakes or compromised accounts.
  if (isProduction && !isStaffRole(session.role as UserRole)) {
    return NextResponse.json(
      {
        error:
          "Forbidden — only staff can publish to production. Publish to staging first and ask an admin to promote.",
      },
      { status: 403 }
    );
  }

  // externalProd salons have a production domain hosted on external infra
  // (not our nginx). Block any production publish attempt so we can't
  // overwrite or break an externally-hosted site. Staging publishes still
  // work normally — CMS owns staging regardless of where production lives.
  if (isProduction && config?.externalProd === true) {
    return NextResponse.json(
      {
        error: "This salon's production site is hosted externally. CMS cannot deploy to it.",
        externalProd: true,
      },
      { status: 422 }
    );
  }

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

    // Post-deploy live-URL verification. Build succeeded + files landed on
    // disk; this step confirms real users actually see the new build.
    const verification = await verifyLiveDeploy(result.domain, result.deployHash);

    if (!verification.verified) {
      // Publish DID NOT reach live users. Log distinctly so drift is visible
      // in the audit log, and return 502 so the editor UI shows an error
      // banner instead of a green "published" confirmation.
      logEvent({
        email: session.email,
        action: isProduction ? "publish_verify_failed_prod" : "publish_verify_failed_staging",
        slug,
        deploy_hash: result.deployHash,
        diff: JSON.stringify({
          domain: result.domain,
          reason: verification.reason,
          liveHash: verification.liveHash,
          status: verification.status,
        }),
      });

      return NextResponse.json(
        {
          ok: false,
          verified: false,
          error: "Publish did not reach live users",
          reason: verification.reason,
          hint: verification.hint,
          domain: result.domain,
          deploy_hash: result.deployHash,
          live_hash: verification.liveHash,
          steps: result.steps,
        },
        { status: 502 }
      );
    }

    logEvent({
      email: session.email,
      action: isProduction ? "publish_production" : "publish_staging",
      slug,
      deploy_hash: result.deployHash,
    });

    return NextResponse.json({
      ok: true,
      verified: true,
      domain: result.domain,
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
