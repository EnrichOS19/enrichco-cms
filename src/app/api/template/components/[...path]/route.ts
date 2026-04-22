// cms/src/app/api/template/components/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireSession, requireSuperAdmin } from "@/lib/auth";
import { logEvent } from "@/lib/audit";
import { TEMPLATE_DIR, templateFileSha256 } from "@/lib/template";

export const dynamic = "force-dynamic";

// Only allow simple .tsx/.ts filenames — no path traversal possible
function safeFilename(parts: string[]): string | null {
  if (parts.length !== 1) return null;
  if (!/^[a-zA-Z0-9_-]+\.(tsx|ts)$/.test(parts[0])) return null;
  return parts[0];
}

// GET: any authenticated user can read (agents need this for diff/inspect before patching)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;

  const { path: pathParts } = await params;
  const filename = safeFilename(pathParts);
  if (!filename) return NextResponse.json({ error: "Invalid filename" }, { status: 400 });

  const filePath = path.join(TEMPLATE_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Template file not found" }, { status: 404 });
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const sha256 = templateFileSha256(filename)!;
  return NextResponse.json({ filename, content, sha256 });
}

// PATCH: superadmin only; requires expected_sha256 for compare-and-swap (prevents blind overwrites)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const auth = await requireSuperAdmin(request);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const { path: pathParts } = await params;
  const filename = safeFilename(pathParts);
  if (!filename) return NextResponse.json({ error: "Invalid filename" }, { status: 400 });

  let body: { content?: string; expected_sha256?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "body.content required" }, { status: 400 });
  }
  if (typeof body.expected_sha256 !== "string") {
    return NextResponse.json(
      { error: 'body.expected_sha256 required (compare-and-swap). Use "new" if creating.' },
      { status: 400 }
    );
  }

  const filePath = path.join(TEMPLATE_DIR, filename);
  const currentSha = templateFileSha256(filename);

  // File doesn't exist yet — only allowed if caller signals intent with "new"
  if (currentSha === null && body.expected_sha256 !== "new") {
    return NextResponse.json(
      { error: 'File does not exist. Pass expected_sha256: "new" to create it.' },
      { status: 409 }
    );
  }

  // File exists — SHA must match to prevent overwriting concurrent edits
  if (currentSha !== null && currentSha !== body.expected_sha256) {
    return NextResponse.json(
      { error: "SHA mismatch — file was modified since you read it", current_sha256: currentSha },
      { status: 409 }
    );
  }

  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  }
  if (!fs.existsSync(TEMPLATE_DIR)) {
    fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  }

  fs.writeFileSync(filePath, body.content, "utf-8");
  const newSha = templateFileSha256(filename)!;

  logEvent({
    email: session.email,
    action: "template_component_update",
    slug: filename,
    deploy_hash: newSha.slice(0, 16),
  });

  return NextResponse.json({ ok: true, filename, sha256: newSha });
}
