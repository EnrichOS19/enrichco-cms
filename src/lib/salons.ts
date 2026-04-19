import fs from "fs";
import path from "path";
import { SalonConfig, SalonSummary } from "./types";

const SITES_DIR = process.env.SITES_DIR || path.join(process.env.HOME || "/Users/aisquad", "salon-websites", "sites");

function getSalonDirs(): { dirName: string; slug: string; configPath: string }[] {
  const entries = fs.readdirSync(SITES_DIR, { withFileTypes: true });
  const seen = new Map<string, { dirName: string; slug: string; configPath: string }>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_removed") || entry.name.startsWith(".")) continue;
    const configPath = path.join(SITES_DIR, entry.name, "config", "salon.json");
    if (!fs.existsSync(configPath)) continue;

    // Derive slug: remove -website suffix if present
    const slug = entry.name.replace(/-website$/, "");

    // Deduplicate: prefer the -website version over bare directory
    const existing = seen.get(slug);
    if (existing) {
      if (entry.name.endsWith("-website")) {
        seen.set(slug, { dirName: entry.name, slug, configPath });
      }
      // else keep existing (it's already the -website version or first found)
    } else {
      seen.set(slug, { dirName: entry.name, slug, configPath });
    }
  }

  return Array.from(seen.values());
}

function inferStatus(config: SalonConfig, dirName: string): "Demo Ready" | "Approved" | "New" {
  const hasServices = config.services && config.services.length > 0;
  const hasGallery = config.gallery && config.gallery.length > 0;
  const hasBranding = config.branding?.primaryColor && config.branding.primaryColor !== "#000000";
  const hasBooking = config.booking?.url && !config.booking.placeholder;

  if (hasServices && hasGallery && hasBranding && hasBooking) return "Approved";
  if (hasServices && hasGallery && hasBranding) return "Demo Ready";
  return "New";
}

export function getAllSalons(): SalonSummary[] {
  const dirs = getSalonDirs();
  const salons: SalonSummary[] = [];

  for (const { dirName, slug, configPath } of dirs) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const config: SalonConfig = JSON.parse(raw);

      const serviceCount = config.services?.reduce((acc, cat) => acc + (cat.items?.length || 0), 0) || 0;

      salons.push({
        slug,
        name: config.name || slug,
        city: config.address?.city || "",
        state: config.address?.state || "",
        status: inferStatus(config, dirName),
        phone: config.phone || "",
        serviceCount,
        galleryCount: config.gallery?.length || 0,
        domainOwnership: config.domainOwnership,
        websiteManager: config.websiteManager,
        dirName,
      });
    } catch {
      // Skip broken configs
    }
  }

  return salons.sort((a, b) => a.name.localeCompare(b.name));
}

export function findSalonDir(slug: string): string | null {
  // Try slug-website first, then slug alone
  const candidates = [`${slug}-website`, slug];
  for (const name of candidates) {
    const configPath = path.join(SITES_DIR, name, "config", "salon.json");
    if (fs.existsSync(configPath)) return name;
  }
  return null;
}

export function getSalonConfig(slug: string): { config: SalonConfig; dirName: string } | null {
  const dirName = findSalonDir(slug);
  if (!dirName) return null;

  const configPath = path.join(SITES_DIR, dirName, "config", "salon.json");
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return { config: JSON.parse(raw), dirName };
  } catch {
    return null;
  }
}

/** SHA-256 of the canonical JSON representation — used as an ETag for optimistic locking. */
export function configEtag(config: SalonConfig): string {
  const { createHash } = require("crypto") as typeof import("crypto");
  return createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 16);
}

export function saveSalonConfig(slug: string, config: SalonConfig): boolean {
  const dirName = findSalonDir(slug);
  if (!dirName) return false;

  const configDir = path.join(SITES_DIR, dirName, "config");
  const configPath = path.join(configDir, "salon.json");
  try {
    // Back up existing config before overwriting.
    // Timestamped filename sorts chronologically via basic string sort (ISO-like).
    if (fs.existsSync(configPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(configDir, `salon.json.bak.${ts}`);
      fs.copyFileSync(configPath, backupPath);

      // Rotate: keep only the last 10 backups, ranked by mtime (handles
      // any legacy UUID-named backups already on disk).
      const backups = fs.readdirSync(configDir)
        .filter((f) => f.startsWith("salon.json.bak."))
        .map((f) => ({ f, m: fs.statSync(path.join(configDir, f)).mtimeMs }))
        .sort((a, b) => a.m - b.m);
      if (backups.length > 10) {
        for (const old of backups.slice(0, backups.length - 10)) {
          try { fs.unlinkSync(path.join(configDir, old.f)); } catch {}
        }
      }
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function listSalonConfigBackups(slug: string): string[] {
  const dirName = findSalonDir(slug);
  if (!dirName) return [];
  const configDir = path.join(SITES_DIR, dirName, "config");
  try {
    return fs.readdirSync(configDir)
      .filter((f) => f.startsWith("salon.json.bak."))
      .map((f) => ({ f, m: fs.statSync(path.join(configDir, f)).mtimeMs }))
      .sort((a, b) => a.m - b.m)
      .map((x) => x.f)
      .reverse();
  } catch {
    return [];
  }
}

export function restoreSalonConfig(slug: string, backupName: string): boolean {
  const dirName = findSalonDir(slug);
  if (!dirName) return false;
  const configDir = path.join(SITES_DIR, dirName, "config");
  const backupPath = path.join(configDir, backupName);
  const configPath = path.join(configDir, "salon.json");
  if (!fs.existsSync(backupPath)) return false;
  try {
    fs.copyFileSync(backupPath, configPath);
    return true;
  } catch {
    return false;
  }
}

export function getSalonSiteDir(slug: string): string | null {
  const dirName = findSalonDir(slug);
  if (!dirName) return null;
  return path.join(/*turbopackIgnore: true*/ SITES_DIR, dirName);
}
