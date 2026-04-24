/**
 * Publish route — externalProd guard.
 *
 * Verifies that:
 *   - Production publish returns 422 when config.externalProd === true
 *   - Staging publish still works when externalProd === true
 *   - Schema accepts externalProd: true, false, and undefined
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";

process.env.CMS_AUTH_DISABLED = "false";

// ── auth mock ────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireSalonAccess: vi.fn(),
  };
});

// ── publish lib mock — we don't want to shell out to real builds ─────────────
const buildSiteTarballMock = vi.fn();
const deployTarballMock = vi.fn();
const verifyLiveDeployMock = vi.fn();
vi.mock("@/lib/publish", () => ({
  buildSiteTarball: (...args: unknown[]) => buildSiteTarballMock(...args),
  deployTarball: (...args: unknown[]) => deployTarballMock(...args),
  verifyLiveDeploy: (...args: unknown[]) => verifyLiveDeployMock(...args),
  publishLocks: new Set<string>(),
}));

// ── audit mock ───────────────────────────────────────────────────────────────
vi.mock("@/lib/audit", () => ({
  logEvent: vi.fn(),
}));

import { requireSalonAccess } from "@/lib/auth";
import { POST as publishPOST } from "@/app/api/salon/[slug]/publish/route";
import { salonSchema } from "@/lib/schemas/salon";

// ── helpers ─────────────────────────────────────────────────────────────────

function adminSession() {
  return { id: "s-admin", email: "admin@enrichco.us", role: "admin" as const };
}

let tempDir: string;
const SLUG = "externalprod-salon";

const CONFIG_PROD_EXTERNAL = {
  name: "External Prod Salon",
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
  domain: "salon-live.example.com",
  stagingDomain: "salon-staging.example.com",
  siteStatus: "production",
  externalProd: true,
};

function writeConfig(content: object) {
  const configDir = path.join(tempDir, `${SLUG}-website`, "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "salon.json"), JSON.stringify(content, null, 2));
}

function makePost(url: string) {
  return new NextRequest(url, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cms-extprod-"));
  process.env.SITES_DIR = tempDir;
  vi.mocked(requireSalonAccess).mockResolvedValue({ session: adminSession() } as unknown as Awaited<ReturnType<typeof requireSalonAccess>>);
  // Default: build + deploy + verify succeed so the guard is the only blocker we can test.
  buildSiteTarballMock.mockResolvedValue({
    tarPath: "/tmp/test.tar.gz",
    deployHash: "hash",
    slug: SLUG,
    steps: [],
    stdout: "",
    stderr: "",
    cleanup: vi.fn(),
  });
  deployTarballMock.mockResolvedValue({ domain: "whatever.example.com", steps: [], warnings: [] });
  verifyLiveDeployMock.mockResolvedValue({ verified: true });
});

afterEach(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  delete process.env.SITES_DIR;
});

// ── tests ───────────────────────────────────────────────────────────────────

describe("POST /api/salon/[slug]/publish — externalProd guard", () => {
  it("externalProd=true blocks live portion — target=live skips live deploy", async () => {
    writeConfig(CONFIG_PROD_EXTERNAL);
    const res = await publishPOST(
      makePost(`http://x/api/salon/${SLUG}/publish?target=live`),
      { params: Promise.resolve({ slug: SLUG }) }
    );
    // Preview still succeeds; live is skipped due to externalProd
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.externalProdBlocked).toBe(true);
    expect(body.live).toBeNull();
    // buildSiteTarball IS called (preview still builds)
    expect(buildSiteTarballMock).toHaveBeenCalled();
    // deployTarball called once (preview only, not live)
    expect(deployTarballMock).toHaveBeenCalledTimes(1);
    expect(deployTarballMock).toHaveBeenCalledWith(
      expect.any(String),
      CONFIG_PROD_EXTERNAL.stagingDomain,
      expect.any(String),
      SLUG
    );
  });

  it("target=preview (legacy target=staging) works even when externalProd=true", async () => {
    writeConfig(CONFIG_PROD_EXTERNAL);
    const res = await publishPOST(
      makePost(`http://x/api/salon/${SLUG}/publish?target=staging`),
      { params: Promise.resolve({ slug: SLUG }) }
    );
    // target=staging is treated as preview — externalProd guard doesn't fire
    expect(buildSiteTarballMock).toHaveBeenCalled();
    expect(deployTarballMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it("does NOT block live publish when externalProd=false", async () => {
    writeConfig({ ...CONFIG_PROD_EXTERNAL, externalProd: false });
    const res = await publishPOST(
      makePost(`http://x/api/salon/${SLUG}/publish?target=live`),
      { params: Promise.resolve({ slug: SLUG }) }
    );
    expect(buildSiteTarballMock).toHaveBeenCalled();
    // Both preview + live deployed
    expect(deployTarballMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.externalProdBlocked).toBeUndefined();
  });
});

// ── schema tests ────────────────────────────────────────────────────────────

describe("salonSchema — externalProd field", () => {
  const base = {
    name: "X",
    address: { street: "", city: "", state: "", zip: "" },
    branding: { primaryColor: "#ff0000", accentColor: "#0000ff" },
  };

  it("accepts externalProd: true", () => {
    const parsed = salonSchema.safeParse({ ...base, externalProd: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.externalProd).toBe(true);
  });

  it("accepts externalProd: false", () => {
    const parsed = salonSchema.safeParse({ ...base, externalProd: false });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.externalProd).toBe(false);
  });

  it("accepts omitted externalProd (backward compat)", () => {
    const parsed = salonSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.externalProd).toBeUndefined();
  });
});
