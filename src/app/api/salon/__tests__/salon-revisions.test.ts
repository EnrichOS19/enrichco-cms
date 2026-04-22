/**
 * Revision history — MVP.
 *
 * Covers the three routes:
 *   GET  /api/salon/[slug]/revisions
 *   GET  /api/salon/[slug]/revisions/[timestamp]
 *   POST /api/salon/[slug]/revisions/[timestamp]/restore
 *
 * Uses a real temp SITES_DIR so the salons-lib helpers execute their actual
 * filesystem logic. Audit-log and auth layers are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";

process.env.CMS_AUTH_DISABLED = "false";

// ── auth mock ───────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireSalonAccess: vi.fn(),
  };
});

// ── audit mock — findAuditEntryNearTimestamp is controlled per test ─────────
vi.mock("@/lib/audit", () => ({
  findAuditEntryNearTimestamp: vi.fn(() => null),
  logEvent: vi.fn(),
}));

// NOTE: do NOT mock "@/lib/salons" — we want real fs helpers.

import { requireSalonAccess } from "@/lib/auth";
import { findAuditEntryNearTimestamp, logEvent } from "@/lib/audit";
import { GET as listGET } from "@/app/api/salon/[slug]/revisions/route";
import { GET as readGET } from "@/app/api/salon/[slug]/revisions/[timestamp]/route";
import { POST as restorePOST } from "@/app/api/salon/[slug]/revisions/[timestamp]/restore/route";

// ── helpers ─────────────────────────────────────────────────────────────────

function adminSession(email = "admin@enrichco.us") {
  return { id: "s1", email, role: "admin" as const };
}

function ownerSession(email = "owner@ntv.com") {
  return { id: "s2", email, role: "salon_owner" as const };
}

function makeGet(url: string) {
  return new NextRequest(url, { method: "GET" });
}

function makePost(url: string) {
  return new NextRequest(url, { method: "POST" });
}

let tempDir: string;
const SLUG = "test-salon";

// Minimal valid salon.json matching salonSchema / ownerSalonSchema required fields.
const VALID_CONFIG = {
  name: "Test Salon",
  tagline: "",
  description: "",
  address: { street: "", city: "", state: "", zip: "" },
  phone: "",
  email: "",
  hours: [],
  social: {},
  booking: { url: "" },
  branding: { primaryColor: "#ff0000", accentColor: "#0000ff" },
  services: [],
  gallery: [],
};

function writeCurrentConfig(content: object) {
  const configDir = path.join(tempDir, `${SLUG}-website`, "config");
  fs.writeFileSync(path.join(configDir, "salon.json"), JSON.stringify(content, null, 2));
}

function writeBackup(id: string, content: object, mtimeMs?: number) {
  const configDir = path.join(tempDir, `${SLUG}-website`, "config");
  const file = path.join(configDir, `salon.json.bak.${id}`);
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  if (mtimeMs !== undefined) {
    const ms = mtimeMs / 1000;
    fs.utimesSync(file, ms, ms);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cms-rev-"));
  process.env.SITES_DIR = tempDir;
  const configDir = path.join(tempDir, `${SLUG}-website`, "config");
  fs.mkdirSync(configDir, { recursive: true });
  writeCurrentConfig(VALID_CONFIG);
  vi.mocked(requireSalonAccess).mockResolvedValue({ session: adminSession() });
});

afterEach(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  delete process.env.SITES_DIR;
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/salon/[slug]/revisions", () => {
  it("returns empty array when there are no backups", async () => {
    const res = await listGET(makeGet(`http://x/api/salon/${SLUG}/revisions`), {
      params: Promise.resolve({ slug: SLUG }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revisions).toEqual([]);
  });

  it("extracts timestamp from ISO-style backup filename", async () => {
    writeBackup("2026-04-21T18-42-00-000Z", VALID_CONFIG);
    const res = await listGET(makeGet(`http://x/api/salon/${SLUG}/revisions`), {
      params: Promise.resolve({ slug: SLUG }),
    });
    const body = await res.json();
    expect(body.revisions).toHaveLength(1);
    expect(body.revisions[0].id).toBe("2026-04-21T18-42-00-000Z");
    expect(body.revisions[0].timestamp).toBe("2026-04-21T18:42:00.000Z");
    expect(body.revisions[0].fileBytes).toBeGreaterThan(0);
  });

  it("collapses rapid-fire saves from the same author within 10s into one entry", async () => {
    // Three bak files 2 seconds apart — should fold into one with unioned fields.
    const base = Date.UTC(2026, 3, 21, 18, 42, 0);
    writeBackup("2026-04-21T18-42-00-000Z", VALID_CONFIG, base);
    writeBackup("2026-04-21T18-42-02-000Z", VALID_CONFIG, base + 2000);
    writeBackup("2026-04-21T18-42-04-000Z", VALID_CONFIG, base + 4000);

    // All three audit rows share the same author; each carries a different changed field.
    vi.mocked(findAuditEntryNearTimestamp).mockImplementation((_slug, tsMs) => {
      if (tsMs >= base + 4000) return { id: "a", email: "quan@x.com", action: "save", slug: SLUG, timestamp: base + 4000, diff: JSON.stringify({ gallery: [1, 2] }) };
      if (tsMs >= base + 2000) return { id: "b", email: "quan@x.com", action: "save", slug: SLUG, timestamp: base + 2000, diff: JSON.stringify({ services: [1, 2] }) };
      return { id: "c", email: "quan@x.com", action: "save", slug: SLUG, timestamp: base, diff: JSON.stringify({ name: [1, 2] }) };
    });

    const res = await listGET(makeGet(`http://x/api/salon/${SLUG}/revisions`), {
      params: Promise.resolve({ slug: SLUG }),
    });
    const body = await res.json();
    expect(body.revisions).toHaveLength(1);
    const sorted = [...(body.revisions[0].changedFields as string[])].sort();
    expect(sorted).toEqual(["gallery", "name", "services"]);
    // Head is the newest entry.
    expect(body.revisions[0].id).toBe("2026-04-21T18-42-04-000Z");
  });

  it("does NOT collapse adjacent backups from different authors", async () => {
    const base = Date.UTC(2026, 3, 21, 18, 42, 0);
    writeBackup("2026-04-21T18-42-00-000Z", VALID_CONFIG, base);
    writeBackup("2026-04-21T18-42-03-000Z", VALID_CONFIG, base + 3000);

    vi.mocked(findAuditEntryNearTimestamp).mockImplementation((_slug, tsMs) => {
      const email = tsMs >= base + 3000 ? "admin@enrichco.us" : "owner@salon.com";
      return { id: "x", email, action: "save", slug: SLUG, timestamp: tsMs, diff: JSON.stringify({ name: [1, 2] }) };
    });

    const res = await listGET(makeGet(`http://x/api/salon/${SLUG}/revisions`), {
      params: Promise.resolve({ slug: SLUG }),
    });
    const body = await res.json();
    expect(body.revisions).toHaveLength(2);
  });

  it("attributes author from audit_log within ±5s tolerance", async () => {
    const ts = Date.UTC(2026, 3, 21, 18, 42, 0);
    writeBackup("2026-04-21T18-42-00-000Z", VALID_CONFIG, ts);
    vi.mocked(findAuditEntryNearTimestamp).mockReturnValue({
      id: "a",
      email: "jane@enrichco.us",
      action: "save",
      slug: SLUG,
      timestamp: ts + 200,
      diff: JSON.stringify({ hours: ["old", "new"], name: ["a", "b"] }),
    });

    const res = await listGET(makeGet(`http://x/api/salon/${SLUG}/revisions`), {
      params: Promise.resolve({ slug: SLUG }),
    });
    const body = await res.json();
    expect(body.revisions[0].author).toBe("jane@enrichco.us");
    expect(body.revisions[0].action).toBe("save");
    expect(body.revisions[0].changedFields).toEqual(["hours", "name"]);
  });
});

describe("GET /api/salon/[slug]/revisions/[timestamp]", () => {
  it("returns the parsed contents of the backup", async () => {
    const snapshot = { ...VALID_CONFIG, name: "Older Name" };
    writeBackup("2026-04-21T18-42-00-000Z", snapshot);
    const res = await readGET(
      makeGet(`http://x/api/salon/${SLUG}/revisions/2026-04-21T18-42-00-000Z`),
      { params: Promise.resolve({ slug: SLUG, timestamp: "2026-04-21T18-42-00-000Z" }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Older Name");
  });

  it("rejects path traversal in the id param", async () => {
    const res = await readGET(
      makeGet(`http://x/api/salon/${SLUG}/revisions/..%2F..%2Fetc%2Fpasswd`),
      { params: Promise.resolve({ slug: SLUG, timestamp: "../../etc/passwd" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for an id that does not exist on disk", async () => {
    const res = await readGET(
      makeGet(`http://x/api/salon/${SLUG}/revisions/nonexistent-id`),
      { params: Promise.resolve({ slug: SLUG, timestamp: "nonexistent-id" }) }
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/salon/[slug]/revisions/[timestamp]/restore", () => {
  it("swaps backup content into salon.json, writes a pre-restore undo bak, and logs audit", async () => {
    const oldSnapshot = { ...VALID_CONFIG, name: "Restored Name" };
    writeBackup("2026-04-21T18-42-00-000Z", oldSnapshot);

    const res = await restorePOST(
      makePost(`http://x/api/salon/${SLUG}/revisions/2026-04-21T18-42-00-000Z/restore`),
      { params: Promise.resolve({ slug: SLUG, timestamp: "2026-04-21T18-42-00-000Z" }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.restoredFrom).toBe("2026-04-21T18-42-00-000Z");
    expect(body.backupId).toMatch(/^pre-restore-/);

    // salon.json now matches the restored snapshot
    const configDir = path.join(tempDir, `${SLUG}-website`, "config");
    const live = JSON.parse(fs.readFileSync(path.join(configDir, "salon.json"), "utf-8"));
    expect(live.name).toBe("Restored Name");

    // Pre-restore undo backup exists
    const files = fs.readdirSync(configDir);
    expect(files.some((f) => f.startsWith("salon.json.bak.pre-restore-"))).toBe(true);

    // Audit event emitted
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "restore", slug: SLUG }),
    );
  });

  it("owner restoring a bak file with legacy protected fields is rejected", async () => {
    vi.mocked(requireSalonAccess).mockResolvedValue({ session: ownerSession() });
    // Legacy bak contains a protected field (domain) that ownerSalonSchema.strict() rejects.
    writeBackup("2026-04-21T18-42-00-000Z", { ...VALID_CONFIG, domain: "legacy.com" });

    const res = await restorePOST(
      makePost(`http://x/api/salon/${SLUG}/revisions/2026-04-21T18-42-00-000Z/restore`),
      { params: Promise.resolve({ slug: SLUG, timestamp: "2026-04-21T18-42-00-000Z" }) }
    );
    expect(res.status).toBe(400);

    // salon.json was NOT modified — current content preserved.
    const configDir = path.join(tempDir, `${SLUG}-website`, "config");
    const live = JSON.parse(fs.readFileSync(path.join(configDir, "salon.json"), "utf-8"));
    expect(live.name).toBe(VALID_CONFIG.name);
    expect(live.domain).toBeUndefined();
  });

  it("two simultaneous restore calls both succeed with distinct pre-restore backup ids", async () => {
    writeBackup("2026-04-21T18-42-00-000Z", { ...VALID_CONFIG, name: "A" });
    writeBackup("2026-04-21T18-43-00-000Z", { ...VALID_CONFIG, name: "B" });

    const [resA, resB] = await Promise.all([
      restorePOST(
        makePost(`http://x/api/salon/${SLUG}/revisions/2026-04-21T18-42-00-000Z/restore`),
        { params: Promise.resolve({ slug: SLUG, timestamp: "2026-04-21T18-42-00-000Z" }) }
      ),
      restorePOST(
        makePost(`http://x/api/salon/${SLUG}/revisions/2026-04-21T18-43-00-000Z/restore`),
        { params: Promise.resolve({ slug: SLUG, timestamp: "2026-04-21T18-43-00-000Z" }) }
      ),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const bodyA = await resA.json();
    const bodyB = await resB.json();
    expect(bodyA.backupId).not.toBe(bodyB.backupId);
    expect(bodyA.backupId).toBeTruthy();
    expect(bodyB.backupId).toBeTruthy();

    // Two distinct pre-restore undo backups should exist on disk.
    const configDir = path.join(tempDir, `${SLUG}-website`, "config");
    const preRestores = fs.readdirSync(configDir).filter((f) => f.startsWith("salon.json.bak.pre-restore-"));
    expect(preRestores.length).toBe(2);
  });

  it("rejects path traversal on restore", async () => {
    const res = await restorePOST(
      makePost(`http://x/api/salon/${SLUG}/revisions/..%2F..%2Fevil/restore`),
      { params: Promise.resolve({ slug: SLUG, timestamp: "../../evil" }) }
    );
    expect(res.status).toBe(400);
  });
});

// Silence unused-var warning for NextResponse import used via ambient type.
void NextResponse;
