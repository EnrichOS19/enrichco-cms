import { NextRequest, NextResponse } from "next/server";
import { configEtag, getSalonConfig, saveSalonConfig } from "@/lib/salons";
import { flattenZodErrors, salonSchema } from "@/lib/schemas/salon";
import { requireSalonAccess } from "@/lib/auth";
import { logEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await requireSalonAccess(request, slug);
  if ("response" in auth) return auth.response;

  const result = getSalonConfig(slug);
  if (!result) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }
  const etag = configEtag(result.config);
  return NextResponse.json(result.config, {
    headers: { ETag: etag },
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await requireSalonAccess(request, slug);
  if ("response" in auth) return auth.response;
  const { session } = auth;

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

  // Optimistic concurrency: if client sent If-Match, compare against current etag.
  // Clients that don't send If-Match still save (soft rollout) but a diagnostic header is returned.
  const ifMatch = request.headers.get("If-Match");
  if (ifMatch && oldConfig) {
    const currentEtag = configEtag(oldConfig);
    if (ifMatch !== currentEtag && ifMatch !== `"${currentEtag}"`) {
      return NextResponse.json(
        {
          error: "Stale edit — another save happened since you loaded this salon. Reload and retry.",
          currentEtag,
        },
        { status: 409 }
      );
    }
  }

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

  const newEtag = configEtag(parsed.data);
  return NextResponse.json({ ok: true, etag: newEtag }, {
    headers: { ETag: newEtag },
  });
}
