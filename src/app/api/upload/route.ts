import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireSession } from "@/lib/auth";
import { getSalonSiteDir } from "@/lib/salons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function sanitizeSlug(slug: string) {
  return slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function fileExtension(filename: string) {
  return path.extname(filename).toLowerCase();
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const rawSlug = formData.get("slug");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (typeof rawSlug !== "string" || !rawSlug.trim()) {
      return NextResponse.json({ error: "Salon slug is required" }, { status: 400 });
    }

    const slug = sanitizeSlug(rawSlug);
    if (!slug) {
      return NextResponse.json({ error: "Invalid salon slug" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File must be smaller than 5MB" }, { status: 400 });
    }

    const ext = fileExtension(file.name);
    if (!ALLOWED_TYPES.has(file.type) || !ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json({ error: "Only JPG, PNG, and WebP files are allowed" }, { status: 400 });
    }

    // Phase 2 fix: save to salon site's public/assets/gallery/ — NOT CMS public/uploads/
    const siteDir = getSalonSiteDir(slug);
    if (!siteDir) {
      return NextResponse.json({ error: "Salon not found" }, { status: 404 });
    }

    const galleryDir = path.join(siteDir, "public", "assets", "gallery");
    fs.mkdirSync(galleryDir, { recursive: true });

    const baseName = path.basename(file.name, ext).replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const filename = `${baseName || "image"}-${uniqueSuffix}${ext}`;
    const savePath = path.join(galleryDir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(savePath, buffer);

    // URL that the live salon static site serves
    const url = `/assets/gallery/${filename}`;
    return NextResponse.json({ ok: true, url, filename });
  } catch (error) {
    console.error("Upload failed", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
