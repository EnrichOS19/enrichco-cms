import fs from "fs";
import path from "path";
import { SalonConfig, SalonSummary } from "./types";

// Resolved on every call so tests can override via process.env.SITES_DIR.
function sitesDir(): string {
  return process.env.SITES_DIR || path.join(process.env.HOME || "/Users/aisquad", "salon-websites", "sites");
}

function getSalonDirs(): { dirName: string; slug: string; configPath: string }[] {
  const entries = fs.readdirSync(sitesDir(), { withFileTypes: true });
  const seen = new Map<string, { dirName: string; slug: string; configPath: string }>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_removed") || entry.name.startsWith(".")) continue;
    const configPath = path.join(sitesDir(), entry.name, "config", "salon.json");
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
    const configPath = path.join(sitesDir(), name, "config", "salon.json");
    if (fs.existsSync(configPath)) return name;
  }
  return null;
}

export function getSalonConfig(slug: string): { config: SalonConfig; dirName: string } | null {
  const dirName = findSalonDir(slug);
  if (!dirName) return null;

  const configPath = path.join(sitesDir(), dirName, "config", "salon.json");
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

  const configDir = path.join(sitesDir(), dirName, "config");
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
  const configDir = path.join(sitesDir(), dirName, "config");
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
  const configDir = path.join(sitesDir(), dirName, "config");
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
  return path.join(/*turbopackIgnore: true*/ sitesDir(), dirName);
}

/**
 * Metadata for a single salon config backup (.bak file).
 *
 * `id` is the filename suffix (everything after `salon.json.bak.`) —
 *   use this as the opaque handle for read / restore calls.
 * `timestamp` is an ISO string resolved from the filename (if it parses)
 *   or from the file's mtime (for legacy UUID-named backups).
 * `fileBytes` is the size of the backup file in bytes.
 */
export interface SalonConfigBackupMeta {
  id: string;
  timestamp: string;
  timestampMs: number;
  fileBytes: number;
}

/** Parse an ISO-ish timestamp from the new `salon.json.bak.<ts>` naming scheme.
 *  Returns null if the id doesn't look like an ISO timestamp (e.g. UUID legacy). */
function parseIdAsTimestampMs(id: string): number | null {
  // New format: 2026-04-21T18-42-00-000Z  (colons+dots replaced by dashes)
  // Restore the colons/dot so Date can parse it.
  // Pattern: YYYY-MM-DDTHH-MM-SS-sssZ
  const m = id.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** List backup metadata for a salon, newest first. */
export function listSalonConfigBackupMeta(slug: string): SalonConfigBackupMeta[] {
  const dirName = findSalonDir(slug);
  if (!dirName) return [];
  const configDir = path.join(sitesDir(), dirName, "config");
  try {
    const entries = fs.readdirSync(configDir)
      .filter((f) => f.startsWith("salon.json.bak."))
      .map((f) => {
        const full = path.join(configDir, f);
        const st = fs.statSync(full);
        const id = f.substring("salon.json.bak.".length);
        const parsedMs = parseIdAsTimestampMs(id);
        const timestampMs = parsedMs ?? st.mtimeMs;
        return {
          id,
          timestamp: new Date(timestampMs).toISOString(),
          timestampMs,
          fileBytes: st.size,
        };
      })
      .sort((a, b) => b.timestampMs - a.timestampMs); // newest first
    return entries;
  } catch {
    return [];
  }
}

/** Read the parsed JSON contents of a specific backup by its id. */
export function readSalonConfigBackup(slug: string, id: string): { content: unknown } | null {
  const dirName = findSalonDir(slug);
  if (!dirName) return null;
  const configDir = path.join(sitesDir(), dirName, "config");
  const backupName = `salon.json.bak.${id}`;
  const resolved = path.resolve(configDir, backupName);
  // Path traversal guard — the resolved path must stay inside configDir
  if (!resolved.startsWith(path.resolve(configDir) + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;
  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    return { content: JSON.parse(raw) };
  } catch {
    return null;
  }
}

/**
 * Restore salon.json to the content of a specific backup, preserving undo:
 * writes the current salon.json to a fresh `pre-restore-<ts>` backup first,
 * then copies the named backup over salon.json.
 *
 * Returns the id of the pre-restore backup on success (so the caller can
 * show an "undo" affordance), or null on failure.
 */
export function restoreSalonConfigWithUndo(slug: string, id: string): { preRestoreId: string } | null {
  const dirName = findSalonDir(slug);
  if (!dirName) return null;
  const configDir = path.join(sitesDir(), dirName, "config");
  const configPath = path.join(configDir, "salon.json");

  const backupName = `salon.json.bak.${id}`;
  const resolvedBackup = path.resolve(configDir, backupName);
  if (!resolvedBackup.startsWith(path.resolve(configDir) + path.sep)) return null;
  if (!fs.existsSync(resolvedBackup)) return null;

  try {
    // Snapshot current salon.json as an undo point before overwriting.
    let preRestoreId = "";
    if (fs.existsSync(configPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      preRestoreId = `pre-restore-${ts}`;
      fs.copyFileSync(configPath, path.join(configDir, `salon.json.bak.${preRestoreId}`));
    }
    fs.copyFileSync(resolvedBackup, configPath);
    return { preRestoreId };
  } catch {
    return null;
  }
}
