import { NextRequest, NextResponse } from "next/server";
import { getSalonConfig, saveSalonConfig } from "@/lib/salons";
import { flattenZodErrors, salonSchema } from "@/lib/schemas/salon";
import { requireSession } from "@/lib/auth";
import { logEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;

  const { slug } = await params;
  const result = getSalonConfig(slug);
  if (!result) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }
  return NextResponse.json(result.config);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const { slug } = await params;

  // Parse body safely
  let config: unknown;
  try {
    config = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = salonSchema.safeParse(config);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        issues: flattenZodErrors(parsed.error),
      },
      { status: 400 }
    );
  }

  // Dry-run mode: validate only, don't save (used by preflight check)
  const isDryRun = request.headers.get("X-Dry-Run") === "true";
  if (isDryRun) {
    return NextResponse.json({ ok: true, dryRun: true });
  }

  // Capture old config for diff
  const existing = getSalonConfig(slug);
  const oldConfig = existing?.config ?? null;

  const success = saveSalonConfig(slug, parsed.data);
  if (!success) {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  // Audit log with diff of changed fields
  const diff: Record<string, [unknown, unknown]> = {};
  if (oldConfig) {
    for (const key of Object.keys(parsed.data) as (keyof typeof parsed.data)[]) {
      const oldVal = (oldConfig as Record<string, unknown>)[key as string];
      const newVal = parsed.data[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        diff[key as string] = [oldVal, newVal];
      }
    }
  }

  logEvent({
    email: session.email,
    action: "save",
    slug,
    diff: Object.keys(diff).length > 0 ? JSON.stringify(diff) : undefined,
  });

  return NextResponse.json({ ok: true });
}
