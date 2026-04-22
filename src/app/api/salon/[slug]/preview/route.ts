/**
 * Preview Route
 *
 * POST /api/salon/[slug]/preview — saves config, serves preview
 * GET  /api/salon/[slug]/preview — serves the preview HTML
 *
 * Strategy:
 * 1. If salon has a live staging/production URL → redirect there (instant)
 * 2. If salon has a built out/ directory → serve it directly
 * 3. If neither → attempt build (only works on server with shared_node_modules)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSalonConfig, saveSalonConfig, getSalonSiteDir } from "@/lib/salons";
import { requireSalonAccess } from "@/lib/auth";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/** POST — save and return preview URL */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await requireSalonAccess(request, slug);
  if ("response" in auth) return auth.response;

  const salonResult = getSalonConfig(slug);
  if (!salonResult) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  // Save pending config changes if body provided
  const body = await request.json().catch(() => null);
  if (body) {
    const merged = { ...salonResult.config, ...body };
    saveSalonConfig(slug, merged);
  }

  const config = salonResult.config;
  const isProduction = (config.siteStatus ?? "staging") === "production";

  // Strategy 1: Use live URL if available
  const liveUrl = isProduction && config.domain
    ? `https://${config.domain}`
    : config.stagingDomain
      ? `https://${config.stagingDomain}`
      : null;

  if (liveUrl) {
    return NextResponse.json({
      ok: true,
      previewUrl: liveUrl,
      mode: "live",
      message: "Opening current live site. Publish to see your latest changes.",
    });
  }

  // Strategy 2: Serve from existing out/ directory
  const siteDir = getSalonSiteDir(slug);
  if (siteDir) {
    const outDir = path.join(siteDir, "out");
    if (fs.existsSync(outDir) && fs.existsSync(path.join(outDir, "index.html"))) {
      return NextResponse.json({
        ok: true,
        previewUrl: `/api/salon/${slug}/preview`,
        mode: "local",
        message: "Serving from last build. Publish to update.",
      });
    }
  }

  // Strategy 3: No preview available
  return NextResponse.json({
    ok: false,
    error: "No preview available. This salon has no staging URL and no local build. Publish to staging first to generate a preview.",
  }, { status: 422 });
}

/** GET — serve the built preview HTML or redirect to live */
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

  const outDir = path.join(siteDir, "out");
  if (!fs.existsSync(outDir)) {
    // Try redirect to live URL
    const salonResult = getSalonConfig(slug);
    if (salonResult) {
      const config = salonResult.config;
      const url = config.domain ? `https://${config.domain}` : config.stagingDomain ? `https://${config.stagingDomain}` : null;
      if (url) {
        return NextResponse.redirect(url);
      }
    }

    return new Response(
      `<html><body style="background:#111;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <h2>No preview available</h2>
          <p style="color:#888">Publish to staging first to generate a preview.</p>
        </div>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  // Serve files from out/
  const urlPath = request.nextUrl.searchParams.get("path") || "index.html";
  const safePath = urlPath.replace(/\.\./g, "").replace(/^\//, "");
  let filePath = path.resolve(outDir, safePath);

  // Containment check
  if (!filePath.startsWith(outDir)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Try file, then file.html, then dir/index.html
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(filePath + ".html")) filePath = filePath + ".html";
    else if (fs.existsSync(path.join(filePath, "index.html"))) filePath = path.join(filePath, "index.html");
    else return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const content = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript",
    ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  };

  return new Response(content, {
    headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream" },
  });
}
