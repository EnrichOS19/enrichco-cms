/**
 * Audit Trail — Phase 3B
 *
 * Append-only SQLite log of every save, publish, upload, rollback, and restore.
 * Never deletes records. Admin-queryable via /admin/audit.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const DB_PATH =
  process.env.CMS_DB_PATH ||
  path.join(process.cwd(), "data", "cms.sqlite");

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db && (DB_PATH === (_db as any).__path)) return _db;

  const db = new Database(DB_PATH);
  (db as any).__path = DB_PATH;
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id           TEXT PRIMARY KEY,
      timestamp    INTEGER NOT NULL,
      email        TEXT NOT NULL,
      action       TEXT NOT NULL,
      slug         TEXT NOT NULL,
      diff         TEXT,
      deploy_hash  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_slug ON audit_log(slug);
    CREATE INDEX IF NOT EXISTS idx_audit_ts   ON audit_log(timestamp);
  `);

  _db = db;
  return db;
}

export type AuditAction = "save" | "publish" | "publish_staging" | "publish_production" | "publish_preview" | "publish_live" | "publish_live_failed" | "publish_verify_failed_prod" | "publish_verify_failed_staging" | "publish_verify_failed_preview" | "publish_verify_failed_live" | "upload" | "rollback" | "restore" | "template_switch" | "template_component_update" | "template_batch_patch" | "template_rebuild_all" | "template_rebuild_dry_run" | "salon_access_grant" | "salon_access_revoke";

export interface AuditEntry {
  id: string;
  timestamp: number;
  email: string;
  action: AuditAction;
  slug: string;
  diff?: string;
  deploy_hash?: string;
}

export interface LogEventParams {
  email: string;
  action: AuditAction;
  slug: string;
  diff?: string;
  deploy_hash?: string;
}

/** Append an event to the audit log. */
export function logEvent(params: LogEventParams): void {
  const db = getDb();
  const id = crypto.randomUUID();
  const timestamp = Date.now();

  db.prepare(`
    INSERT INTO audit_log (id, timestamp, email, action, slug, diff, deploy_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    timestamp,
    params.email,
    params.action,
    params.slug,
    params.diff ?? null,
    params.deploy_hash ?? null
  );
}

/** Get audit log entries for a salon, newest first. */
export function getAuditLog(slug: string, limit = 100): AuditEntry[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM audit_log WHERE slug = ? ORDER BY timestamp DESC LIMIT ?
  `).all(slug, limit) as AuditEntry[];
}

/** Get all audit entries (admin view), newest first. */
export function getAllAuditLog(limit = 500): AuditEntry[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?
  `).all(limit) as AuditEntry[];
}

/**
 * Find the audit entry for a slug that most likely corresponds to a given
 * backup timestamp. Matches within +/- toleranceMs and returns the closest
 * entry by absolute time delta, or null if none.
 *
 * Default tolerance is 5 seconds — the save → backup write → audit log insert
 * happen in the same request so they're usually within tens of milliseconds,
 * but disk + db latency can push that out a bit under load.
 */
export function findAuditEntryNearTimestamp(
  slug: string,
  timestampMs: number,
  toleranceMs = 5000
): AuditEntry | null {
  const db = getDb();
  const lo = timestampMs - toleranceMs;
  const hi = timestampMs + toleranceMs;
  const rows = db.prepare(`
    SELECT * FROM audit_log
    WHERE slug = ? AND timestamp BETWEEN ? AND ?
    ORDER BY ABS(timestamp - ?) ASC
    LIMIT 1
  `).all(slug, lo, hi, timestampMs) as AuditEntry[];
  return rows[0] ?? null;
}

/** Reset module-level DB handle (for tests that swap CMS_DB_PATH). */
export function resetDb(): void {
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
  }
}
