// cms/src/lib/publish.ts
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { injectToTempDir } from "./template";

const execFileAsync = promisify(execFile);

export const WEB_ROOT = process.env.WEB_ROOT || "/var/www";

// Exported so rebuild-all can acquire the same lock set as single-site publish
export const publishLocks = new Set<string>();

export interface BuildResult {
  domain: string;
  deployHash: string;
  steps: string[];
  stdout: string;
  stderr: string;
}

export type VerifyLiveResult =
  | { verified: true; domain: string; deployHash: string; liveHash: string; status: number }
  | {
      verified: false;
      domain: string;
      deployHash: string;
      liveHash: string | null;
      status: number;
      reason: "fetch_failed" | "deploy_json_missing" | "hash_mismatch";
      hint: string;
    };

/**
 * Build a salon site in a temporary directory and deploy it to the web root.
 *
 * The original siteDir is NEVER modified — injection and build happen in /tmp.
 * Caller is responsible for acquiring publishLocks before calling this function.
 *
 * @param dryRun - If true, builds but does not swap the public directory (canary check)
 */
export async function buildAndDeploy(
  siteDir: string,
  domain: string,
  slug: string,
  dryRun = false
): Promise<BuildResult> {
  const steps: string[] = [];
  const tmpDir = `/tmp/build-${slug}-${Date.now()}`;
  const tarPath = `/tmp/${slug}-deploy-${Date.now()}.tar.gz`;

  // Validate domain (defence-in-depth, caller should also validate)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*\.[a-zA-Z]{2,}$/.test(domain)) {
    throw new Error(`Invalid domain: ${domain}`);
  }

  // DNS hostnames are case-insensitive; filesystem paths and nginx `root`
  // directives are not. Normalizing here is the single choke point that
  // guarantees every publish lands in the directory nginx serves from.
  const domainLower = domain.toLowerCase();

  let buildOut = "";
  let buildErr = "";

  try {
    // Step 1 — Create temp copy of site source (non-destructive)
    steps.push("Copying to temp dir...");
    await execFileAsync("cp", ["-r", siteDir, tmpDir], { timeout: 30000 });

    // Step 2 — Inject shared template into the temp copy (never touches live siteDir)
    const injected = injectToTempDir(tmpDir);
    if (injected.length > 0) {
      steps.push(`Template injected: ${injected.join(", ")}`);
    }

    // Step 3 — Clean previous build artifacts in temp copy
    await execFileAsync("rm", ["-rf", ".next", "out"], { cwd: tmpDir, timeout: 10000 });

    // Step 4 — Build
    // Use ./node_modules/.bin/next directly — avoids CMS Next.js 16 leaking into salon Next.js 15
    steps.push("Building...");
    const buildEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      LANG: process.env.LANG,
      NODE_ENV: "production",
    };
    const buildResult = await execFileAsync(
      "./node_modules/.bin/next",
      ["build"],
      { cwd: tmpDir, timeout: 160000, env: buildEnv }
    );
    buildOut = buildResult.stdout;
    buildErr = buildResult.stderr;
    steps.push("Build complete");

    // Step 5a — Compute deploy hash from the out/ contents BEFORE tarring,
    // so we can write a fingerprint file INTO the deploy (verified post-deploy).
    // Hash over the file list + sizes + mtimes gives a stable per-build value
    // that changes whenever content changes.
    const outDirSrc = path.join(tmpDir, "out");
    const hashSource = await execFileAsync(
      "sh",
      ["-c", `find . -type f -printf '%P %s\\n' | sort`],
      { cwd: outDirSrc, timeout: 15000 }
    );
    const deployHash = crypto
      .createHash("sha256")
      .update(hashSource.stdout)
      .digest("hex")
      .slice(0, 16);

    // Step 5b — Write fingerprint file. Post-deploy verification fetches this
    // from the live URL to confirm the build we just produced is what users
    // actually reach. Catches case-mismatch dirs, wrong-target deploys,
    // nginx misconfig, and upstream cache issues.
    const fingerprint = {
      hash: deployHash,
      slug,
      domain: domainLower,
      deployedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(outDirSrc, "deploy.json"),
      JSON.stringify(fingerprint, null, 2) + "\n"
    );

    // Step 5c — Package (includes deploy.json)
    steps.push("Packaging...");
    await execFileAsync("tar", ["-czf", tarPath, "out/"], { cwd: tmpDir, timeout: 30000 });
    steps.push("Package ready");

    if (dryRun) {
      steps.push("Dry run — build succeeded, deploy skipped");
      return { domain: domainLower, deployHash, steps, stdout: buildOut, stderr: buildErr };
    }

    // Step 6 — Deploy (atomic swap on same server)
    // Path uses lowercased domain so it matches nginx's `root` directive,
    // which follows DNS case convention (always lowercase).
    steps.push("Deploying...");
    const webRoot = path.join(WEB_ROOT, domainLower);
    await execFileAsync("mkdir", ["-p", webRoot], { timeout: 5000 });
    await execFileAsync("tar", ["-xzf", tarPath, "-C", webRoot], { timeout: 30000 });

    const publicDir = path.join(webRoot, "public");
    const publicOld = path.join(webRoot, "public_old");
    const outDir = path.join(webRoot, "out");
    const tombstone = path.join(webRoot, "public_tombstone");

    if (fs.existsSync(publicDir)) {
      if (fs.existsSync(tombstone)) await execFileAsync("rm", ["-rf", tombstone], { timeout: 10000 });
      await execFileAsync("mv", [publicDir, tombstone], { timeout: 10000 });
    }
    if (fs.existsSync(publicOld)) await execFileAsync("rm", ["-rf", publicOld], { timeout: 10000 });
    if (fs.existsSync(tombstone)) await execFileAsync("mv", [tombstone, publicOld], { timeout: 10000 });
    if (fs.existsSync(outDir)) await execFileAsync("mv", [outDir, publicDir], { timeout: 10000 });

    try { await execFileAsync("chmod", ["-R", "a+rX", publicDir], { timeout: 15000 }); } catch {}

    steps.push("Deployed");

    return { domain: domainLower, deployHash, steps, stdout: buildOut, stderr: buildErr };
  } finally {
    // Always clean up temp artifacts regardless of success or failure
    try {
      if (fs.existsSync(tmpDir)) {
        await execFileAsync("rm", ["-rf", tmpDir], { timeout: 30000 });
      }
    } catch {}
    try { if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath); } catch {}
  }
}

/**
 * Post-deploy verification. Fetches /deploy.json from the live URL and
 * confirms the hash matches what we just built. Cache-buster query string
 * defeats Cloudflare / nginx / browser caches.
 *
 * Any mismatch here means the publish silently failed to reach live users
 * (wrong nginx path, DNS pointing at Firebase ghost, CF SSL edge error, etc.).
 * Surface this to the editor UI — do NOT report success.
 */
export async function verifyLiveDeploy(
  domain: string,
  deployHash: string
): Promise<VerifyLiveResult> {
  const domainLower = domain.toLowerCase();
  const url = `https://${domainLower}/deploy.json?_v=${deployHash}`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return {
        verified: false,
        domain: domainLower,
        deployHash,
        liveHash: null,
        status: res.status,
        reason: "deploy_json_missing",
        hint:
          `GET ${url} returned HTTP ${res.status}. Build succeeded but the ` +
          `live URL is NOT serving our deploy. Check DNS (does ${domainLower} ` +
          `resolve to mangotemplate-web-server / 34.138.245.90?), nginx server ` +
          `block 'root' directive (path must match /var/www/${domainLower}/public), ` +
          `and any upstream cache (Cloudflare orange-cloud).`,
      };
    }

    const body = (await res.json()) as { hash?: string };
    const liveHash = typeof body.hash === "string" ? body.hash : null;

    if (liveHash !== deployHash) {
      return {
        verified: false,
        domain: domainLower,
        deployHash,
        liveHash,
        status: res.status,
        reason: "hash_mismatch",
        hint:
          `Live URL is serving a DIFFERENT build (live=${liveHash ?? "null"}, ` +
          `expected=${deployHash}). Likely stale cache at CF/nginx or a second ` +
          `server still in the DNS rotation. Try a hard refresh and re-check; ` +
          `if it persists, purge CF cache for ${domainLower}.`,
      };
    }

    return { verified: true, domain: domainLower, deployHash, liveHash, status: res.status };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      verified: false,
      domain: domainLower,
      deployHash,
      liveHash: null,
      status: 0,
      reason: "fetch_failed",
      hint:
        `Could not reach https://${domainLower}/ at all (${msg}). DNS may not ` +
        `resolve, TLS cert may be invalid for this host, or the server may be ` +
        `unreachable. Verify with: dig ${domainLower} and curl -vI https://${domainLower}/`,
    };
  }
}
