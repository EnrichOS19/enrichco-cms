import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TEMPLATES_DIR = process.env.TEMPLATES_DIR || path.join(
  process.env.HOME || "/Users/aisquad",
  "salon-websites",
  "templates",
  "library"
);

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;

  const manifestPath = path.join(TEMPLATES_DIR, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json(
      { error: "Template manifest not found" },
      { status: 404 }
    );
  }

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);
    return NextResponse.json({ templates: manifest.templates || [] });
  } catch {
    return NextResponse.json(
      { error: "Failed to read template manifest" },
      { status: 500 }
    );
  }
}
