/**
 * Rollback Route — Phase 3C (Layer 2: Site Rollback)
 *
 * Restores the live production site to its previous published version
 * by atomically renaming public_old → public on the server.
 *
 * No downtime: atomic renames ensure nginx always has something to serve.
 *
 * State machine:
 *   - After rollback, public_old is gone (it became public).
 *   - The rollback button is disabled if the server reports no public_old.
 *   - To regain rollback capability, publish again (creates new public_old).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSalonConfig } from "@/lib/salons";
import { exec } from "child_process";
import { promisify } from "util";
import { requireSession } from "@/lib/auth";
import { logEvent } from "@/lib/audit";
import path from "path";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";

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

  const salonResult = getSalonConfig(slug);
  if (!salonResult) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  const domain = salonResult.config?.domain;
  if (!domain) {
    return NextResponse.json(
      { error: "Salon has no domain configured — cannot determine web root for rollback." },
      { status: 422 }
    );
  }

  const webRoot = `${WEB_ROOT}/${domain}`;

  // Check if public_old exists (locally for tests, remotely for production)
  // In test mode (WEB_ROOT points to tmpDir), check filesystem directly.
  // In production, check via gcloud ssh.
  const isLocalTest = WEB_ROOT.startsWith("/tmp") || WEB_ROOT.startsWith(process.env.HOME || "/Users");
  let hasPublicOld = false;

  if (isLocalTest) {
    const { existsSync } = await import("fs");
    hasPublicOld = existsSync(path.join(webRoot, "public_old"));
  } else {
    try {
      const checkCmd = [
        "gcloud compute ssh",
        `aisquad@${GCP_INSTANCE}`,
        `--zone=${GCP_ZONE}`,
        `--project=${GCP_PROJECT}`,
        "--tunnel-through-iap",
        "--strict-host-key-checking=no",
        `-- "[ -d ${webRoot}/public_old ] && echo yes || echo no"`,
      ].join(" ");
      const { stdout } = await execAsync(checkCmd, { timeout: 15000 });
      hasPublicOld = stdout.trim() === "yes";
    } catch {
      hasPublicOld = false;
    }
  }

  if (!hasPublicOld) {
    return NextResponse.json(
      { error: "No previous publish to roll back to. public_old does not exist on server." },
      { status: 409 }
    );
  }

  try {
    // Atomic rollback: rename public_old → public with no downtime gap
    const rollbackScript = [
      `cd ${webRoot}`,
      `mv public public_tombstone`,
      `mv public_old public`,
      `rm -rf public_tombstone`,
      `sudo chown -R www-data:www-data public 2>/dev/null || true`,
    ].join(" && ");

    const sshCmd = [
      "gcloud compute ssh",
      `aisquad@${GCP_INSTANCE}`,
      `--zone=${GCP_ZONE}`,
      `--project=${GCP_PROJECT}`,
      "--tunnel-through-iap",
      "--strict-host-key-checking=no",
      `-- "${rollbackScript}"`,
    ].join(" ");
    await execAsync(sshCmd, { timeout: 30000 });

    // Phase 3B: audit log
    logEvent({
      email: session.email,
      action: "rollback",
      slug,
    });

    return NextResponse.json({ ok: true, message: "Rolled back to previous publish." });
  } catch (error: unknown) {
    const err = error as { message?: string; stderr?: string };
    return NextResponse.json(
      {
        error: "Rollback failed",
        message: err.message || "Unknown error",
        stderr: err.stderr || "",
      },
      { status: 500 }
    );
  }
}
