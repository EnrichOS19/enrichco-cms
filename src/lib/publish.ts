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

    // Step 5 — Package
    steps.push("Packaging...");
    await execFileAsync("tar", ["-czf", tarPath, "out/"], { cwd: tmpDir, timeout: 30000 });
    steps.push("Package ready");

    const tarBytes = fs.readFileSync(tarPath);
    const deployHash = crypto.createHash("sha256").update(tarBytes).digest("hex").slice(0, 16);

    if (dryRun) {
      steps.push("Dry run — build succeeded, deploy skipped");
      return { domain, deployHash, steps, stdout: buildOut, stderr: buildErr };
    }

    // Step 6 — Deploy (atomic swap on same server)
    steps.push("Deploying...");
    const webRoot = path.join(WEB_ROOT, domain);
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

    return { domain, deployHash, steps, stdout: buildOut, stderr: buildErr };
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
