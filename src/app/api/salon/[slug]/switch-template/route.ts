import { NextRequest, NextResponse } from "next/server";
import { getSalonSiteDir, getSalonConfig } from "@/lib/salons";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { requireAdmin } from "@/lib/auth";
import { logEvent } from "@/lib/audit";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const maxDuration = 180; // Raised from 90s — builds regularly exceed 90s

const TEMPLATES_DIR = process.env.TEMPLATES_DIR || path.join(
  process.env.HOME || "/Users/aisquad",
  "salon-websites",
  "templates",
  "library"
);

function copyDirSync(src: string, dest: string, exclude: string[] = []) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, exclude);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const { slug } = await params;
  const { templateId } = await request.json();

  if (!templateId) {
    return NextResponse.json(
      { success: false, message: "templateId is required" },
      { status: 400 }
    );
  }

  // Resolve template directory
  const manifestPath = path.join(TEMPLATES_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json(
      { success: false, message: "Template manifest not found" },
      { status: 404 }
    );
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const template = manifest.templates?.find(
    (t: { id: string }) => t.id === templateId
  );
  if (!template) {
    return NextResponse.json(
      { success: false, message: `Template "${templateId}" not found in manifest` },
      { status: 404 }
    );
  }

  // Resolve template path (relative paths are relative to TEMPLATES_DIR)
  const templatePath = path.resolve(TEMPLATES_DIR, template.path);

  // Path traversal guard: resolved path must be within TEMPLATES_DIR
  const resolvedTemplatesDir = path.resolve(TEMPLATES_DIR);
  if (!templatePath.startsWith(resolvedTemplatesDir + path.sep) && templatePath !== resolvedTemplatesDir) {
    return NextResponse.json(
      { success: false, message: "Invalid template path" },
      { status: 400 }
    );
  }

  if (!fs.existsSync(templatePath)) {
    return NextResponse.json(
      { success: false, message: `Template directory not found: ${templatePath}` },
      { status: 404 }
    );
  }

  // Resolve salon site directory
  const siteDir = getSalonSiteDir(slug);
  if (!siteDir) {
    return NextResponse.json(
      { success: false, message: `Salon site directory not found for "${slug}"` },
      { status: 404 }
    );
  }

  try {
    // 1. Preserve the salon's config/salon.json
    const salonConfigPath = path.join(siteDir, "config", "salon.json");
    let preservedConfig: string | null = null;
    if (fs.existsSync(salonConfigPath)) {
      preservedConfig = fs.readFileSync(salonConfigPath, "utf-8");
    }

    // Also preserve public/assets if it exists (salon images)
    const assetsDir = path.join(siteDir, "public", "assets");
    const tempAssetsDir = path.join(siteDir, ".tmp-assets-backup");
    if (fs.existsSync(assetsDir)) {
      copyDirSync(assetsDir, tempAssetsDir);
    }

    // 2. Copy template files to site dir, excluding config dir and node_modules
    copyDirSync(templatePath, siteDir, ["node_modules", ".next", "config", "public"]);

    // Copy template public dir but not assets (we preserved salon assets)
    const templatePublicDir = path.join(templatePath, "public");
    if (fs.existsSync(templatePublicDir)) {
      copyDirSync(templatePublicDir, path.join(siteDir, "public"), ["assets"]);
    }

    // 3. Restore preserved config
    if (preservedConfig) {
      const configDir = path.join(siteDir, "config");
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(salonConfigPath, preservedConfig, "utf-8");
    }

    // Restore preserved assets
    if (fs.existsSync(tempAssetsDir)) {
      if (!fs.existsSync(path.join(siteDir, "public"))) {
        fs.mkdirSync(path.join(siteDir, "public"), { recursive: true });
      }
      copyDirSync(tempAssetsDir, assetsDir);
      fs.rmSync(tempAssetsDir, { recursive: true, force: true });
    }

    // Update currentTemplate in salon config
    if (preservedConfig) {
      const configObj = JSON.parse(preservedConfig);
      configObj.currentTemplate = templateId;
      fs.writeFileSync(salonConfigPath, JSON.stringify(configObj, null, 2), "utf-8");
    }

    // 4. npm install (only if no node_modules) && build with explicit bin to avoid Next 16 conflict
    if (!fs.existsSync(path.join(siteDir, "node_modules"))) {
      await execFileAsync("npm", ["install"], { cwd: siteDir, timeout: 90000 });
    }
    await execFileAsync("./node_modules/.bin/next", ["build"], { cwd: siteDir, timeout: 90000 });

    // 5. Get domain for GCP deploy — respect siteStatus like publish route
    const salonResult = getSalonConfig(slug);
    const siteStatus = salonResult?.config?.siteStatus ?? "staging";
    const isProduction = siteStatus === "production";
    const domain = isProduction ? salonResult?.config?.domain : salonResult?.config?.stagingDomain;
    if (!domain) {
      const missing = isProduction ? "domain" : "stagingDomain";
      return NextResponse.json(
        { success: false, message: `Salon has no ${missing} configured. Set it in the Settings tab before switching templates.` },
        { status: 422 }
      );
    }

    // Defense-in-depth: reject domains with shell metacharacters
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.\-]*\.[a-zA-Z]{2,}$/.test(domain)) {
      return NextResponse.json({ success: false, message: "Invalid domain format" }, { status: 422 });
    }

    // 6. Local deploy (same as publish route — CMS runs on same server)
    const tarPath = `/tmp/${slug}-tpl-${Date.now()}.tar.gz`;
    await execFileAsync("tar", ["-czf", tarPath, "out/"], { cwd: siteDir, timeout: 30000 });

    const tarBytes = fs.readFileSync(tarPath);
    const deployHash = crypto.createHash("sha256").update(tarBytes).digest("hex").slice(0, 16);

    const WEB_ROOT = process.env.WEB_ROOT || "/var/www";
    const webRoot = `${WEB_ROOT}/${domain}`;
    const publicDir = path.join(webRoot, "public");
    const publicOld = path.join(webRoot, "public_old");
    const outDir = path.join(webRoot, "out");
    const tombstone = path.join(webRoot, "public_tombstone");

    // Create web root + extract tar
    await execFileAsync("mkdir", ["-p", webRoot], { timeout: 5000 });
    await execFileAsync("tar", ["-xzf", tarPath, "-C", webRoot], { timeout: 30000 });

    // Atomic swap: out → public (keep public_old for rollback)
    if (fs.existsSync(publicDir)) {
      if (fs.existsSync(tombstone)) fs.rmSync(tombstone, { recursive: true });
      fs.renameSync(publicDir, tombstone);
    }
    if (fs.existsSync(publicOld)) fs.rmSync(publicOld, { recursive: true });
    if (fs.existsSync(tombstone)) fs.renameSync(tombstone, publicOld);
    if (fs.existsSync(outDir)) fs.renameSync(outDir, publicDir);

    // Fix ownership
    try { await execFileAsync("sudo", ["chown", "-R", "www-data:www-data", publicDir], { timeout: 10000 }); } catch {}

    // Cleanup
    try { fs.unlinkSync(tarPath); } catch {}

    // Audit log
    logEvent({
      email: session.email,
      action: "template_switch",
      slug,
      deploy_hash: deployHash,
    });

    return NextResponse.json({
      success: true,
      message: `Template switched to "${template.name}" and deployed.`,
    });
  } catch (error: unknown) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    return NextResponse.json(
      {
        success: false,
        message: err.message || "Template switch failed",
        stdout: err.stdout || "",
        stderr: err.stderr || "",
      },
      { status: 500 }
    );
  }
}
