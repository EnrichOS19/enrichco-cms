// cms/src/app/api/template/batch-patch/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireSuperAdmin } from "@/lib/auth";
import { logEvent } from "@/lib/audit";
import { TEMPLATE_DIR, templateFileSha256 } from "@/lib/template";

export const dynamic = "force-dynamic";

interface Patch {
  old: string;
  new: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  let body: { file?: string; patches?: Patch[]; expected_sha256?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.file || !/^[a-zA-Z0-9_-]+\.(tsx|ts)$/.test(body.file)) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }
  if (!Array.isArray(body.patches) || body.patches.length === 0) {
    return NextResponse.json({ error: "patches must be a non-empty array" }, { status: 400 });
  }
  for (const p of body.patches) {
    if (typeof p.old !== "string" || typeof p.new !== "string") {
      return NextResponse.json({ error: "Each patch needs string old and new" }, { status: 400 });
    }
    if (p.old.length === 0) {
      return NextResponse.json({ error: "Patch old string cannot be empty" }, { status: 400 });
    }
  }
  if (typeof body.expected_sha256 !== "string") {
    return NextResponse.json({ error: "expected_sha256 required (compare-and-swap)" }, { status: 400 });
  }

  const filePath = path.join(TEMPLATE_DIR, body.file);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: `Template file not found: ${body.file}` }, { status: 404 });
  }

  // Compare-and-swap guard — reject if file changed since caller read it
  const currentSha = templateFileSha256(body.file)!;
  if (currentSha !== body.expected_sha256) {
    return NextResponse.json(
      { error: "SHA mismatch — file was modified since you read it", current_sha256: currentSha },
      { status: 409 }
    );
  }

  let content = fs.readFileSync(filePath, "utf-8");
  const results: { old: string; count: number }[] = [];

  for (const patch of body.patches) {
    let count = 0;
    const escaped = patch.old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    content = content.replace(new RegExp(escaped, "g"), () => { count++; return patch.new; });
    results.push({ old: patch.old, count });
  }

  // Reject if any patch matched zero times — prevents silent no-ops from wrong strings
  const zeroMatches = results.filter((r) => r.count === 0);
  if (zeroMatches.length > 0) {
    return NextResponse.json(
      {
        error: "One or more patches matched zero times — no changes written",
        zero_matches: zeroMatches.map((r) => r.old),
      },
      { status: 422 }
    );
  }

  // Backup and write
  fs.copyFileSync(filePath, `${filePath}.bak`);
  fs.writeFileSync(filePath, content, "utf-8");

  const newSha = templateFileSha256(body.file)!;

  logEvent({
    email: session.email,
    action: "template_batch_patch",
    slug: body.file,
    deploy_hash: newSha.slice(0, 16),
  });

  return NextResponse.json({ ok: true, file: body.file, sha256: newSha, results });
}
