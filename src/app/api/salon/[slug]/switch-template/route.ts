import { NextRequest, NextResponse } from "next/server";
import { getSalonSiteDir } from "@/lib/salons";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { requireSession } from "@/lib/auth";

const execAsync = promisify(exec);

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
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;

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

    // 4. npm install && npm run build
    await execAsync("npm install", { cwd: siteDir, timeout: 90000 });
    await execAsync("npm run build", { cwd: siteDir, timeout: 90000 });

    // 5. Firebase deploy
    const firebaseToken = process.env.FIREBASE_TOKEN;
    const firebaseProject = process.env.FIREBASE_PROJECT || "stg-enrichco-mangosalon-b3a03";
    if (!firebaseToken) {
      return NextResponse.json(
        { success: false, message: "FIREBASE_TOKEN is not configured." },
        { status: 500 },
      );
    }
    const deployCmd = `firebase deploy --only hosting:${slug} --token "${firebaseToken}" --project ${firebaseProject}`;
    await execAsync(deployCmd, { cwd: siteDir, timeout: 90000 });

    return NextResponse.json({
      success: true,
      message: `Template switched to "${template.name}" and deployed successfully.`,
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
