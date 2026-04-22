/**
 * findSlugByRvcNo — Phase 2 auto-suggest helper.
 *
 * Maps an IMS storeID → CMS salon slug by matching salon.json.rvcNo.
 * Uses a real temp SITES_DIR so the scan runs against actual filesystem.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { findSlugByRvcNo } from "@/lib/salons";

let tempDir: string;

function writeSalon(dirName: string, data: unknown) {
  const configDir = path.join(tempDir, dirName, "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "salon.json"), JSON.stringify(data, null, 2));
}

function writeRawSalon(dirName: string, content: string) {
  const configDir = path.join(tempDir, dirName, "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "salon.json"), content);
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cms-rvc-"));
  process.env.SITES_DIR = tempDir;
});

afterEach(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  delete process.env.SITES_DIR;
});

describe("findSlugByRvcNo", () => {
  it("returns the slug for a salon with a matching rvcNo", () => {
    writeSalon("ntv-beauty-studio-website", { slug: "ntv-beauty-studio", rvcNo: 2222 });
    writeSalon("other-salon-website", { slug: "other-salon", rvcNo: 3333 });

    expect(findSlugByRvcNo(2222)).toBe("ntv-beauty-studio");
    expect(findSlugByRvcNo(3333)).toBe("other-salon");
  });

  it("returns null when no salon matches the rvcNo", () => {
    writeSalon("ntv-beauty-studio-website", { slug: "ntv-beauty-studio", rvcNo: 2222 });
    expect(findSlugByRvcNo(9999)).toBeNull();
  });

  it("returns null when no salons exist at all", () => {
    expect(findSlugByRvcNo(2222)).toBeNull();
  });

  it("skips directories prefixed with underscore (_removed_*, _archived_*)", () => {
    writeSalon("_removed_ghost-salon", { slug: "ghost-salon", rvcNo: 2222 });
    writeSalon("_archived_old-salon", { slug: "old-salon", rvcNo: 2222 });
    expect(findSlugByRvcNo(2222)).toBeNull();
  });

  it("is resilient to a corrupt salon.json — does not throw and keeps scanning", () => {
    writeRawSalon("broken-salon-website", "{not valid json");
    writeSalon("good-salon-website", { slug: "good-salon", rvcNo: 2222 });
    // Should not throw, should still find the good salon
    expect(() => findSlugByRvcNo(2222)).not.toThrow();
    expect(findSlugByRvcNo(2222)).toBe("good-salon");
  });

  it("derives slug from dir name (stripping -website) when salon.json lacks a slug field", () => {
    writeSalon("legacy-salon-website", { rvcNo: 5555 }); // no slug field
    expect(findSlugByRvcNo(5555)).toBe("legacy-salon");
  });

  it("returns null for non-finite rvcNo input (NaN, Infinity)", () => {
    writeSalon("x-website", { slug: "x", rvcNo: 1 });
    expect(findSlugByRvcNo(Number.NaN)).toBeNull();
    expect(findSlugByRvcNo(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("skips dirs missing config/salon.json", () => {
    fs.mkdirSync(path.join(tempDir, "empty-dir"), { recursive: true });
    writeSalon("has-config-website", { slug: "has-config", rvcNo: 7777 });
    expect(findSlugByRvcNo(7777)).toBe("has-config");
  });
});
