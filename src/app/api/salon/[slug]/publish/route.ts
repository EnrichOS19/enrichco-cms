/**
 * Publish Route — Phase 3C
 *
 * Accepts a `target` query param:
 *   target=preview (default) → build once, deploy to stagingDomain only
 *   target=live             → build once, deploy to stagingDomain then domain
 *
 * Build artifact (tarball) is reused for both deploys — next build runs only once.
 *
 * Auth + validation + lock → delegates to buildSiteTarball / deployTarball from lib/publish.ts.
 * Build happens in a temp copy of the site; source tree is never mutated.
 * Shared template components are injected before every build.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSalonConfig, getSalonSiteDir } from "@/lib/salons";
import { requireSalonAccess } from "@/lib/auth";
import { isStaffRole, type UserRole } from "@/lib/db";
import { logEvent } from "@/lib/audit";
import { buildSiteTarball, deployTarball, publishLocks, verifyLiveDeploy } from "@/lib/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // two deploys can take up to 5 min

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

  // --- Parse target param ---
  // Default to "preview" for backward compat — callers without target param
  // get the safer staging-only behaviour.
  const rawTarget = request.nextUrl.searchParams.get("target");
  // Legacy: ?target=staging was previously the only override; treat it as "preview".
  const target: "preview" | "live" =
    rawTarget === "live" ? "live" : "preview";

  const wantsLive = target === "live";

  // Salon owners can publish to preview only. Promoting to live requires a
  // staff (admin/superadmin/support) role — protects live customer-facing
  // domains from owner-side mistakes or compromised accounts.
  if (wantsLive && !isStaffRole(session.role as UserRole)) {
    return NextResponse.json(
      {
        error:
          "Forbidden — only staff can publish live. Publish to preview first and ask an admin to go live.",
      },
      { status: 403 }
    );
  }

  // externalProd salons have a production domain hosted on external infra.
  // Block the live-side portion only — preview still works.
  const externalProdBlocked = wantsLive && config?.externalProd === true;

  // Collect target domains
  const previewDomain = config?.stagingDomain ?? null;
  const liveDomain = config?.domain ?? null;

  // Determine what we'll actually deploy to
  const deployToPreview = previewDomain !== null;
  const deployToLive = wantsLive && !externalProdBlocked && liveDomain !== null;

  // If target=live and externalProd blocks the live side, we still run preview
  // but report the externalProd block clearly.

  // Need at least one valid target
  if (!deployToPreview && !deployToLive) {
    const missing = wantsLive ? "domain and stagingDomain" : "stagingDomain";
    return NextResponse.json(
      {
        error: `Salon has no ${missing} configured. Set it in the Settings tab before publishing.`,
      },
      { status: 422 }
    );
  }

  // Validate domains we intend to use
  const domainRe = /^[a-zA-Z0-9][a-zA-Z0-9.\-]*\.[a-zA-Z]{2,}$/;
  if (deployToPreview && !domainRe.test(previewDomain!)) {
    return NextResponse.json({ error: "Invalid stagingDomain format" }, { status: 422 });
  }
  if (deployToLive && !domainRe.test(liveDomain!)) {
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
    // Build once — reuse tarball for both targets
    const tarball = await buildSiteTarball(siteDir, slug);

    const results: {
      target: "preview" | "live";
      domain: string;
      verified: boolean;
      deployHash: string;
      warnings: string[];
      verifyResult?: Awaited<ReturnType<typeof verifyLiveDeploy>>;
    }[] = [];

    // Track per-target outcomes for partial-failure reporting (HIGH 2)
    let previewOk = false;
    let liveOk = false;
    let liveError: string | undefined;

    // Collect all warnings across targets (HIGH 3)
    const allWarnings: string[] = [];

    try {
      // Deploy to preview — wrapped in its own try/catch for partial-failure tracking
      if (deployToPreview) {
        try {
          const previewDeploy = await deployTarball(tarball.tarPath, previewDomain!, tarball.deployHash, slug);
          if (previewDeploy.warnings.length > 0) allWarnings.push(...previewDeploy.warnings);

          const verification = await verifyLiveDeploy(previewDomain!, tarball.deployHash);

          if (!verification.verified) {
            logEvent({
              email: session.email,
              action: "publish_verify_failed_preview",
              slug,
              deploy_hash: tarball.deployHash,
              diff: JSON.stringify({
                domain: previewDomain,
                reason: verification.reason,
                liveHash: (verification as { liveHash?: string | null }).liveHash,
                status: verification.status,
              }),
            });
            // Return early with error — don't proceed to live if preview didn't land
            return NextResponse.json(
              {
                ok: false,
                verified: false,
                error: "Preview publish did not reach live users",
                target: "preview",
                reason: (verification as { reason?: string }).reason,
                hint: (verification as { hint?: string }).hint,
                domain: previewDomain,
                deploy_hash: tarball.deployHash,
                live_hash: (verification as { liveHash?: string | null }).liveHash,
                steps: [...tarball.steps],
                warnings: allWarnings.length > 0 ? allWarnings : undefined,
              },
              { status: 502 }
            );
          }

          logEvent({
            email: session.email,
            action: "publish_preview",
            slug,
            deploy_hash: tarball.deployHash,
            diff: JSON.stringify({
              domain: previewDomain,
              ...(previewDeploy.warnings.length > 0 ? { warnings: previewDeploy.warnings } : {}),
            }),
          });

          previewOk = true;
          results.push({
            target: "preview",
            domain: previewDomain!,
            verified: true,
            deployHash: tarball.deployHash,
            warnings: previewDeploy.warnings,
            verifyResult: verification,
          });
        } catch (previewErr) {
          // Preview itself threw (not a verify failure) — propagate as before
          throw previewErr;
        }
      }

      // Deploy to live — wrapped in its own try/catch so a live failure doesn't
      // hide a successful preview (HIGH 2)
      if (deployToLive) {
        try {
          const liveDeploy = await deployTarball(tarball.tarPath, liveDomain!, tarball.deployHash, slug);
          if (liveDeploy.warnings.length > 0) allWarnings.push(...liveDeploy.warnings);

          const verification = await verifyLiveDeploy(liveDomain!, tarball.deployHash);

          if (!verification.verified) {
            logEvent({
              email: session.email,
              action: "publish_verify_failed_live",
              slug,
              deploy_hash: tarball.deployHash,
              diff: JSON.stringify({
                domain: liveDomain,
                reason: (verification as { reason?: string }).reason,
                liveHash: (verification as { liveHash?: string | null }).liveHash,
                status: verification.status,
              }),
            });

            // Preview may have succeeded — include partial success in response
            return NextResponse.json(
              {
                ok: false,
                verified: false,
                error: "Live publish did not reach live users",
                target: "live",
                reason: (verification as { reason?: string }).reason,
                hint: (verification as { hint?: string }).hint,
                domain: liveDomain,
                deploy_hash: tarball.deployHash,
                live_hash: (verification as { liveHash?: string | null }).liveHash,
                preview_ok: previewOk,
                steps: [...tarball.steps],
                warnings: allWarnings.length > 0 ? allWarnings : undefined,
              },
              { status: 502 }
            );
          }

          logEvent({
            email: session.email,
            action: "publish_live",
            slug,
            deploy_hash: tarball.deployHash,
            diff: JSON.stringify({
              domain: liveDomain,
              ...(liveDeploy.warnings.length > 0 ? { warnings: liveDeploy.warnings } : {}),
            }),
          });

          liveOk = true;
          results.push({
            target: "live",
            domain: liveDomain!,
            verified: true,
            deployHash: tarball.deployHash,
            warnings: liveDeploy.warnings,
            verifyResult: verification,
          });
        } catch (liveErr) {
          // Live deploy threw — preview already succeeded. Report partial success
          // with HTTP 200 + live_ok: false so the caller (and UI) can distinguish
          // from a total failure (HIGH 2).
          const errMsg = liveErr instanceof Error ? liveErr.message : String(liveErr);
          liveError = errMsg;

          logEvent({
            email: session.email,
            action: "publish_preview",
            slug,
            deploy_hash: tarball.deployHash,
            diff: JSON.stringify({ domain: previewDomain }),
          });
          logEvent({
            email: session.email,
            action: "publish_live_failed",
            slug,
            deploy_hash: tarball.deployHash,
            diff: JSON.stringify({ domain: liveDomain, error: errMsg }),
          });
        }
      }
    } finally {
      tarball.cleanup();
    }

    // Partial success: preview OK, live threw
    if (deployToLive && previewOk && !liveOk && liveError !== undefined) {
      return NextResponse.json({
        ok: true,
        preview_ok: true,
        live_ok: false,
        live_error: liveError,
        target,
        deploy_hash: tarball.deployHash,
        domain: previewDomain!,
        preview: { domain: previewDomain!, verified: true },
        live: null,
        steps: tarball.steps,
        build: { stdout: tarball.stdout, stderr: tarball.stderr },
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
      });
    }

    // Build success response
    const previewResult = results.find((r) => r.target === "preview");
    const liveResult = results.find((r) => r.target === "live");

    // Determine published-with-warnings state (HIGH 3)
    const hasWarnings = allWarnings.length > 0;

    return NextResponse.json({
      ok: true,
      verified: true,
      target,
      deploy_hash: tarball.deployHash,
      // Top-level domain for backward compat (callers that read result.domain)
      domain: (liveResult ?? previewResult)!.domain,
      preview: previewResult
        ? { domain: previewResult.domain, verified: previewResult.verified }
        : null,
      live: liveResult
        ? { domain: liveResult.domain, verified: liveResult.verified }
        : null,
      // Inform caller when live was requested but blocked by externalProd
      externalProdBlocked: externalProdBlocked || undefined,
      steps: tarball.steps,
      build: { stdout: tarball.stdout, stderr: tarball.stderr },
      warnings: hasWarnings ? allWarnings : undefined,
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
