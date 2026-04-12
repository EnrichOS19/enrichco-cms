/**
 * Publish Route — Phase 3A
 *
 * Replaces legacy hosting deploy with GCP IAP-tunneled deploy:
 *   1. Build salon site (rm -rf .next out && npm run build)
 *   2. Package output as tar.gz
 *   3. Upload to production server via gcloud compute scp + IAP
 *   4. Extract atomically on the server (keeps public_old for rollback)
 *   5. Log to audit trail
 *
 * SSE progress feed: each step emits an event so the UI shows live status.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSalonConfig, getSalonSiteDir } from "@/lib/salons";
import { exec } from "child_process";
import { promisify } from "util";
import { requireSession } from "@/lib/auth";
import { logEvent } from "@/lib/audit";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";
export const maxDuration = 180; // 3 minutes — builds can take a while

const GCP_PROJECT  = process.env.GCP_PROJECT  || "mangoforsalon-97743";
const GCP_ZONE     = process.env.GCP_ZONE     || "us-east1-c";
const GCP_INSTANCE = process.env.GCP_INSTANCE || "mangotemplate-web-server";
const WEB_ROOT     = process.env.WEB_ROOT     || "/var/www";

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
  const domain = salonResult?.config?.domain;
  if (!domain) {
    return NextResponse.json(
      { error: "Salon has no domain configured. Add a domain field to salon.json before publishing." },
      { status: 422 }
    );
  }

  const steps: string[] = [];
  const tarPath = `/tmp/${slug}-deploy-${Date.now()}.tar.gz`;

  try {
    // Step 1 — Build
    steps.push("Building...");
    await execAsync("rm -rf .next out", { cwd: siteDir, timeout: 10000 });
    const { stdout: buildOut, stderr: buildErr } = await execAsync(
      "npm run build",
      { cwd: siteDir, timeout: 160000 }
    );
    steps.push("Build complete");

    // Step 2 — Package
    steps.push("Packaging...");
    await execAsync(`tar -czf ${tarPath} out/`, { cwd: siteDir, timeout: 30000 });
    steps.push("Package ready");

    // Compute deploy hash for audit trail
    const tarBytes = fs.readFileSync(tarPath);
    const deployHash = crypto.createHash("sha256").update(tarBytes).digest("hex").slice(0, 16);

    // Step 3 — Upload via IAP
    steps.push("Uploading to server...");
    const scpCmd = [
      "gcloud compute scp",
      tarPath,
      `aisquad@${GCP_INSTANCE}:/tmp/`,
      `--zone=${GCP_ZONE}`,
      `--project=${GCP_PROJECT}`,
      "--tunnel-through-iap",
      "--strict-host-key-checking=no",
    ].join(" ");
    await execAsync(scpCmd, { timeout: 60000 });
    steps.push("Upload complete");

    // Step 4 — Extract atomically on server
    steps.push("Deploying on server...");
    const tarName = path.basename(tarPath);
    const webRoot = `${WEB_ROOT}/${domain}`;
    const deployScript = [
      `mkdir -p ${webRoot}`,
      `cd ${webRoot}`,
      `tar -xzf /tmp/${tarName}`,
      `[ -d public ] && mv public public_tombstone || true`,
      `[ -d public_old ] && rm -rf public_old || true`,
      `[ -d public_tombstone ] && mv public_tombstone public_old || true`,
      `mv out public`,
      `sudo chown -R www-data:www-data public 2>/dev/null || true`,
      `rm -f /tmp/${tarName}`,
    ].join(" && ");

    const sshCmd = [
      "gcloud compute ssh",
      `aisquad@${GCP_INSTANCE}`,
      `--zone=${GCP_ZONE}`,
      `--project=${GCP_PROJECT}`,
      "--tunnel-through-iap",
      "--strict-host-key-checking=no",
      `-- "${deployScript}"`,
    ].join(" ");
    await execAsync(sshCmd, { timeout: 60000 });
    steps.push("Deployed ✓");

    // Cleanup local tar
    try { fs.unlinkSync(tarPath); } catch {}

    // Phase 3B: audit log
    logEvent({
      email: session.email,
      action: "publish",
      slug,
      deploy_hash: deployHash,
    });

    return NextResponse.json({
      ok: true,
      domain,
      steps,
      deploy_hash: deployHash,
      build: { stdout: buildOut, stderr: buildErr },
    });
  } catch (error: unknown) {
    // Cleanup tar on failure
    try { if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath); } catch {}

    const err = error as { message?: string; stdout?: string; stderr?: string };
    return NextResponse.json(
      {
        error: "Publish failed",
        steps,
        message: err.message || "Unknown error",
        stdout: err.stdout || "",
        stderr: err.stderr || "",
      },
      { status: 500 }
    );
  }
}
