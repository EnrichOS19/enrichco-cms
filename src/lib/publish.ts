// cms/src/lib/publish.ts
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { injectToTempDir } from "./template";
import { PLACEHOLDER_PATTERN } from "./schemas/salon";

const execFileAsync = promisify(execFile);

export const WEB_ROOT = process.env.WEB_ROOT || "/var/www";

// Exported so rebuild-all can acquire the same lock set as single-site publish
export const publishLocks = new Set<string>();

/**
 * Walk salon.json and throw if any string value still carries an onboarding
 * seed sentinel (e.g. "VENUS_PLACEHOLDER"). Prevents publishing a site with
 * fake data. Layer 1 (schema) catches this on save; this catches anything
 * already persisted from before the schema fix.
 */
export function assertNoPlaceholders(
  obj: unknown,
  pathSegments: string[] = []
): void {
  if (typeof obj === "string") {
    if (PLACEHOLDER_PATTERN.test(obj)) {
      throw new Error(
        `Publish blocked — salon.json field "${pathSegments.join(".")}" still contains a placeholder sentinel: ${JSON.stringify(obj)}. ` +
          `Set a real value through the CMS editor before publishing.`
      );
    }
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => assertNoPlaceholders(item, [...pathSegments, String(i)]));
    return;
  }
  if (obj && typeof obj === "object") {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      assertNoPlaceholders(value, [...pathSegments, key]);
    }
  }
}

export interface BuildResult {
  domain: string;
  deployHash: string;
  steps: string[];
  stdout: string;
  stderr: string;
  warnings?: string[];
}

/** Result of buildSiteTarball — reusable across multiple deployTarball calls */
export interface TarballResult {
  tarPath: string;
  deployHash: string;
  slug: string;
  steps: string[];
  stdout: string;
  stderr: string;
  /** Caller must invoke cleanup() when done (even on error) to remove /tmp artifacts */
  cleanup: () => void;
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
 * Build a salon site into a tarball.
 *
 * The original siteDir is NEVER modified — injection and build happen in /tmp.
 * Caller must call result.cleanup() when done (even on error) to remove /tmp artifacts.
 *
 * @param dryRun - If true, builds but does not produce a tarball (canary check)
 */
export async function buildSiteTarball(
  siteDir: string,
  slug: string,
  dryRun = false
): Promise<TarballResult> {
  const steps: string[] = [];
  const tmpDir = `/tmp/build-${slug}-${Date.now()}`;
  const tarPath = `/tmp/${slug}-deploy-${Date.now()}.tar.gz`;
  let buildOut = "";
  let buildErr = "";

  const cleanup = () => {
    try { if (fs.existsSync(tmpDir)) { execFile("rm", ["-rf", tmpDir], () => {}); } } catch {}
    try { if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath); } catch {}
  };

  try {
    // Step 0 — Pre-flight: reject salon.json with placeholder sentinels.
    const cfgPath = path.join(siteDir, "config", "salon.json");
    try {
      const rawCfg = fs.readFileSync(cfgPath, "utf-8");
      const parsed = JSON.parse(rawCfg);
      assertNoPlaceholders(parsed);
      steps.push("Pre-flight: no placeholder sentinels in salon.json");
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`salon.json at ${cfgPath} is not valid JSON: ${err.message}`);
      }
      throw err;
    }

    // Step 1 — Create temp copy of site source (non-destructive)
    steps.push("Copying to temp dir...");
    await execFileAsync("cp", ["-r", siteDir, tmpDir], { timeout: 30000 });

    // Step 2 — Inject shared template into the temp copy
    const injected = injectToTempDir(tmpDir);
    if (injected.length > 0) {
      steps.push(`Template injected: ${injected.join(", ")}`);
    }

    // Step 3 — Clean previous build artifacts in temp copy
    await execFileAsync("rm", ["-rf", ".next", "out"], { cwd: tmpDir, timeout: 10000 });

    // Step 4 — Build
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

    // Step 5a — Compute deploy hash from the out/ contents BEFORE tarring.
    //
    // CONTENT-based hash: sha256 per file's bytes, combined into a top-level
    // hash over `relpath\0sha256\n` sorted lines. Two builds that edit copy
    // without changing file count or any file's byte length MUST produce
    // distinct hashes (caught in PR #1 adversarial review).
    const outDirSrc = path.join(tmpDir, "out");
    const manifest = await execFileAsync(
      "sh",
      [
        "-c",
        `find . -type f -print0 | sort -z | xargs -0 sha256sum | awk '{ h=$1; $1=""; p=substr($0,3); printf "%s\\0%s\\n", p, h }'`,
      ],
      { cwd: outDirSrc, timeout: 60000, maxBuffer: 50 * 1024 * 1024 }
    );
    const deployHash = crypto
      .createHash("sha256")
      .update(manifest.stdout)
      .digest("hex")
      .slice(0, 16);

    // Step 5a.5 — Post-build placeholder scan across all text assets.
    const textExtensions = [
      "*.html", "*.htm", "*.txt", "*.js", "*.mjs", "*.json", "*.xml",
      "*.css", "*.svg", "*.webmanifest", "*.rsc", "*.map"
    ];
    const findArgs = [outDirSrc, "-type", "f", "("];
    textExtensions.forEach((ext, i) => {
      if (i > 0) findArgs.push("-o");
      findArgs.push("-name", ext);
    });
    findArgs.push(")");
    const buildTextFiles = (
      await execFileAsync("find", findArgs, { timeout: 15000 })
    ).stdout
      .split("\n")
      .filter((p) => p.trim().length > 0);
    for (const filePath of buildTextFiles) {
      const content = fs.readFileSync(filePath, "utf-8");
      const match = content.match(PLACEHOLDER_PATTERN);
      if (match) {
        const rel = path.relative(outDirSrc, filePath);
        throw new Error(
          `Publish blocked — built ${rel} contains a placeholder sentinel (${JSON.stringify(match[0])}). ` +
            `Fix the source (${siteDir}/src/) or salon.json, then republish.`
        );
      }
    }
    steps.push(`Post-build: ${buildTextFiles.length} text assets scanned, no placeholders`);

    // Step 5b — Write fingerprint file (slug + hash baked in).
    // deployTarball will OVERWRITE domain/deployedAt per-target before extracting,
    // but the hash is the same for both targets (same build).
    const fingerprint = {
      hash: deployHash,
      slug,
      domain: "pending",
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
      return { tarPath, deployHash, slug, steps, stdout: buildOut, stderr: buildErr, cleanup };
    }

    return { tarPath, deployHash, slug, steps, stdout: buildOut, stderr: buildErr, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

/**
 * Deploy a pre-built tarball to a target domain.
 *
 * Extracts the tarball, performs an atomic swap of the public dir,
 * then fixes ownership/permissions so the NEXT publish can rm -rf public_old.
 *
 * Can be called multiple times with the same tarball (e.g. preview + live).
 */
export async function deployTarball(
  tarPath: string,
  domain: string,
  deployHash: string,
  slug: string
): Promise<{ domain: string; steps: string[]; warnings: string[] }> {
  const steps: string[] = [];

  // Validate domain
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*\.[a-zA-Z]{2,}$/.test(domain)) {
    throw new Error(`Invalid domain: ${domain}`);
  }
  const domainLower = domain.toLowerCase();

  // Step 6 — Deploy (atomic swap on same server)
  steps.push(`Deploying to ${domainLower}...`);
  const webRoot = path.join(WEB_ROOT, domainLower);
  await execFileAsync("mkdir", ["-p", webRoot], { timeout: 5000 });
  await execFileAsync("tar", ["-xzf", tarPath, "-C", webRoot], { timeout: 30000 });

  // Patch deploy.json domain field so /deploy.json returns the correct domain
  const extractedOut = path.join(webRoot, "out");
  const deployJsonPath = path.join(extractedOut, "deploy.json");
  try {
    const fingerprint = JSON.parse(fs.readFileSync(deployJsonPath, "utf-8")) as Record<string, unknown>;
    fingerprint.domain = domainLower;
    fingerprint.deployedAt = new Date().toISOString();
    fs.writeFileSync(deployJsonPath, JSON.stringify(fingerprint, null, 2) + "\n");
  } catch {
    // Non-fatal — hash verification will catch it if it matters
  }

  const publicDir = path.join(webRoot, "public");
  const publicOld = path.join(webRoot, "public_old");
  const outDir = path.join(webRoot, "out");
  const warnings: string[] = [];

  // Atomic swap — 3 steps, no tombstone intermediary:
  //   1. rm -rf public_old  (if exists)
  //   2. mv public → public_old  (atomic rename, keeps rollback point)
  //   3. mv out → public  (atomic rename, with rollback on failure)
  if (fs.existsSync(publicOld)) await execFileAsync("rm", ["-rf", publicOld], { timeout: 10000 });
  if (fs.existsSync(publicDir)) await execFileAsync("mv", [publicDir, publicOld], { timeout: 10000 });
  try {
    await execFileAsync("mv", [outDir, publicDir], { timeout: 10000 });
  } catch (swapErr) {
    // mv out→public failed — restore public_old so the site stays live
    if (fs.existsSync(publicOld)) {
      try { await execFileAsync("mv", [publicOld, publicDir], { timeout: 10000 }); } catch {}
    }
    throw swapErr;
  }

  // Fix ownership + permissions so the NEXT publish can rm -rf public_old.
  // On failure: site IS live — don't roll back. Collect warning instead.
  try { await execFileAsync("chmod", ["-R", "a+rX", publicDir], { timeout: 15000 }); } catch (err) {
    const msg = `chmod a+rX failed: ${(err as Error).message}; next publish may fail`;
    warnings.push(msg);
    console.error(`[publish] ${msg}`);
  }
  try {
    await execFileAsync("chown", ["-R", "www-data:www-data", publicDir], { timeout: 15000 });
  } catch (err) {
    const msg = `chown www-data failed: ${(err as Error).message}; next publish may fail`;
    warnings.push(msg);
    console.error(`[publish] ${msg}`);
  }
  try {
    await execFileAsync("chmod", ["-R", "u+rwX,g+rwX", publicDir], { timeout: 15000 });
  } catch (err) {
    const msg = `chmod group-write failed: ${(err as Error).message}; next publish may fail`;
    warnings.push(msg);
    console.error(`[publish] ${msg}`);
  }
  try {
    await execFileAsync("chmod", ["g+s", webRoot], { timeout: 5000 });
  } catch (err) {
    const msg = `setgid on webRoot failed: ${(err as Error).message}; next publish may fail`;
    warnings.push(msg);
    console.error(`[publish] ${msg}`);
  }

  // Record expected hash for Layer 4 drift-check cron. Best-effort.
  try {
    const driftDir = "/var/log/cms-drift";
    if (fs.existsSync(driftDir)) {
      const row = `${slug}\t${deployHash}\t${domainLower}\t${new Date().toISOString()}\n`;
      fs.appendFileSync(path.join(driftDir, "expected-hashes.tsv"), row);
    }
  } catch (err) {
    console.error(`[publish] failed to record expected hash: ${(err as Error).message}`);
  }

  steps.push(`Deployed to ${domainLower}`);
  return { domain: domainLower, steps, warnings };
}

/**
 * Build a salon site in a temporary directory and deploy it to the web root.
 *
 * Backward-compatible wrapper around buildSiteTarball + deployTarball.
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
  // Validate domain early (buildSiteTarball doesn't need it, deployTarball will validate again)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*\.[a-zA-Z]{2,}$/.test(domain)) {
    throw new Error(`Invalid domain: ${domain}`);
  }
  const domainLower = domain.toLowerCase();

  const tarball = await buildSiteTarball(siteDir, slug, dryRun);
  try {
    if (dryRun) {
      return {
        domain: domainLower,
        deployHash: tarball.deployHash,
        steps: tarball.steps,
        stdout: tarball.stdout,
        stderr: tarball.stderr,
      };
    }

    const deployResult = await deployTarball(tarball.tarPath, domain, tarball.deployHash, slug);
    return {
      domain: domainLower,
      deployHash: tarball.deployHash,
      steps: [...tarball.steps, ...deployResult.steps],
      stdout: tarball.stdout,
      stderr: tarball.stderr,
      warnings: deployResult.warnings.length > 0 ? deployResult.warnings : undefined,
    };
  } finally {
    tarball.cleanup();
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
