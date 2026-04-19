import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireSalonAccess } from "@/lib/auth";
import { getSalonSiteDir, getSalonConfig, saveSalonConfig } from "@/lib/salons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml"]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".svg"]);

/** GET /api/salon/[slug]/logo — check if a logo exists, or serve raw image with ?raw=1 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await requireSalonAccess(request, slug);
  if ("response" in auth) return auth.response;

  const siteDir = getSalonSiteDir(slug);
  if (!siteDir) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  const logoPath = path.join(siteDir, "public", "assets", "logo.png");
  const hasLogo = fs.existsSync(logoPath);

  // Serve raw image for editor preview
  if (request.nextUrl.searchParams.get("raw") === "1" && hasLogo) {
    const buffer = fs.readFileSync(logoPath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
      },
    });
  }

  const result = getSalonConfig(slug);
  const configLogo = result?.config?.branding?.logo;

  return NextResponse.json({
    hasLogo,
    path: hasLogo ? "/assets/logo.png" : null,
    configLogo: configLogo || null,
  });
}

/** POST /api/salon/[slug]/logo — upload a new logo */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await requireSalonAccess(request, slug);
  if ("response" in auth) return auth.response;

  const siteDir = getSalonSiteDir(slug);
  if (!siteDir) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Logo must be smaller than 5MB" }, { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_TYPES.has(file.type) || !ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: "Logo must be JPG, PNG, WebP, or SVG" },
        { status: 400 }
      );
    }

    const assetsDir = path.join(siteDir, "public", "assets");
    fs.mkdirSync(assetsDir, { recursive: true });

    // Back up existing logo before overwriting
    const logoPath = path.join(assetsDir, "logo.png");
    if (fs.existsSync(logoPath)) {
      const backupPath = path.join(assetsDir, `logo.png.bak.${Date.now()}`);
      fs.copyFileSync(logoPath, backupPath);
    }

    // Save new logo as logo.png (templates expect this exact filename)
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(logoPath, buffer);

    // Update config branding.logo field
    const result = getSalonConfig(slug);
    if (result) {
      const config = result.config;
      if (!config.branding) {
        (config as Record<string, unknown>).branding = {};
      }
      (config.branding as Record<string, unknown>).logo = "/assets/logo.png";
      saveSalonConfig(slug, config);
    }

    return NextResponse.json({
      ok: true,
      path: "/assets/logo.png",
      size: file.size,
    });
  } catch (error) {
    console.error("[logo] Upload failed:", error);
    return NextResponse.json({ error: "Logo upload failed" }, { status: 500 });
  }
}

/** DELETE /api/salon/[slug]/logo — remove the logo */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await requireSalonAccess(request, slug);
  if ("response" in auth) return auth.response;

  const siteDir = getSalonSiteDir(slug);
  if (!siteDir) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  const logoPath = path.join(siteDir, "public", "assets", "logo.png");
  if (fs.existsSync(logoPath)) {
    // Back up before deleting
    const backupPath = path.join(path.dirname(logoPath), `logo.png.bak.${Date.now()}`);
    fs.copyFileSync(logoPath, backupPath);
    fs.unlinkSync(logoPath);
  }

  // Clear config field
  const result = getSalonConfig(slug);
  if (result) {
    const config = result.config;
    if (config.branding) {
      delete (config.branding as Record<string, unknown>).logo;
    }
    saveSalonConfig(slug, config);
  }

  return NextResponse.json({ ok: true });
}
