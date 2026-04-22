import { NextRequest, NextResponse } from "next/server";
import { configEtag, getSalonConfig, saveSalonConfig } from "@/lib/salons";
import { flattenZodErrors, salonSchema, ownerSalonSchema } from "@/lib/schemas/salon";
import { requireSalonAccess } from "@/lib/auth";
import { logEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Fields salon_owner cannot set via PUT.
 * Admin/superadmin/support may set any field.
 */
const OWNER_PROTECTED_FIELDS = [
  "siteStatus",
  "domain",
  "stagingDomain",
  "domainOwnership",
  "websiteManager",
  "currentTemplate",
  "externalProd",
] as const;

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
  let rawBody: Record<string, unknown>;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const isOwner = session.role === "salon_owner";

  let config: unknown;
  let parseResult: ReturnType<typeof salonSchema.safeParse>;

  if (isOwner) {
    // Strip protected fields before validation — owner cannot escalate
    const stripped: Record<string, unknown> = { ...rawBody };
    for (const field of OWNER_PROTECTED_FIELDS) {
      delete stripped[field];
    }
    // Use strict schema — unknown keys are rejected (closes Codex's .passthrough hole)
    parseResult = ownerSalonSchema.safeParse(stripped);
    config = stripped;
  } else {
    // Admin/staff: full schema with passthrough
    parseResult = salonSchema.safeParse(rawBody);
    config = rawBody;
  }

  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        issues: flattenZodErrors(parseResult.error),
      },
      { status: 400 }
    );
  }

  // Normalize hostnames to lowercase before persisting. Filesystem paths and
  // nginx `root` directives are case-sensitive; DNS is not. Storing canonical
  // lowercase here guarantees the CMS editor, the publish target, and the
  // nginx server block all agree on the same directory.
  // Owner PUT never gets this far with these fields (stripped above as protected),
  // so this only fires for admin/staff who can edit domain/stagingDomain.
  const data = parseResult.data as Record<string, unknown>;
  if (typeof data.domain === "string") {
    data.domain = data.domain.toLowerCase();
  }
  if (typeof data.stagingDomain === "string") {
    data.stagingDomain = data.stagingDomain.toLowerCase();
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

  const success = saveSalonConfig(slug, parseResult.data);
  if (!success) {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  // Audit log with diff of changed fields
  const diff: Record<string, [unknown, unknown]> = {};
  if (oldConfig) {
    for (const key of Object.keys(parseResult.data) as (keyof typeof parseResult.data)[]) {
      const oldVal = (oldConfig as Record<string, unknown>)[key as string];
      const newVal = parseResult.data[key];
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

  const newEtag = configEtag(parseResult.data);
  return NextResponse.json({ ok: true, etag: newEtag }, {
    headers: { ETag: newEtag },
  });
}
