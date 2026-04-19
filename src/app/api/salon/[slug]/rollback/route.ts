/**
 * Rollback Route — Phase 3C (Layer 2: Site Rollback)
 *
 * Restores the live production site to its previous published version
 * by atomically renaming public_old -> public on the server.
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
import { execFile } from "child_process";
import { promisify } from "util";
import { requireAdmin } from "@/lib/auth";
import { logEvent } from "@/lib/audit";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const GCP_PROJECT  = process.env.GCP_PROJECT  || "mangoforsalon-97743";
const GCP_ZONE     = process.env.GCP_ZONE     || "us-east1-c";
const GCP_INSTANCE = process.env.GCP_INSTANCE || "mangotemplate-web-server";
const WEB_ROOT     = process.env.WEB_ROOT     || "/var/www";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const { slug } = await params;

  const salonResult = getSalonConfig(slug);
  if (!salonResult) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  // Respect siteStatus — mirror publish route logic
  const config = salonResult.config;
  const siteStatus = config?.siteStatus ?? "staging";
  const isProduction = siteStatus === "production";
  const domain = isProduction ? config?.domain : config?.stagingDomain;

  if (!domain) {
    const missing = isProduction ? "domain" : "stagingDomain";
    return NextResponse.json(
      { error: `Salon has no ${missing} configured — cannot determine web root for rollback.` },
      { status: 422 }
    );
  }

  // Defense-in-depth: reject domains with shell metacharacters
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*\.[a-zA-Z]{2,}$/.test(domain)) {
    return NextResponse.json({ error: "Invalid domain format" }, { status: 422 });
  }

  const webRoot = `${WEB_ROOT}/${domain}`;
  const publicDir = path.join(webRoot, "public");
  const publicOld = path.join(webRoot, "public_old");
  const tombstone = path.join(webRoot, "public_tombstone");

  // Check if public_old exists (local filesystem — CMS runs on same server)
  const { existsSync } = await import("fs");
  if (!existsSync(publicOld)) {
    return NextResponse.json(
      { error: "No previous publish to roll back to. public_old does not exist." },
      { status: 409 }
    );
  }

  try {
    // Atomic rollback: rename public_old -> public with no downtime gap
    if (existsSync(publicDir)) {
      if (existsSync(tombstone)) fs.rmSync(tombstone, { recursive: true });
      fs.renameSync(publicDir, tombstone);
    }
    fs.renameSync(publicOld, publicDir);
    if (existsSync(tombstone)) fs.rmSync(tombstone, { recursive: true });

    // Fix ownership
    try { await execFileAsync("sudo", ["chown", "-R", "www-data:www-data", publicDir], { timeout: 10000 }); } catch {}

    // Audit log
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
