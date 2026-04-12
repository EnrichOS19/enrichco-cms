/**
 * SQLite session store for CMS authentication.
 * Replaces stateless HMAC tokens with server-side sessions that can be revoked.
 *
 * Sessions are 8 hours by default (one work shift).
 * Admin can revoke all sessions for a user instantly via DELETE /api/auth/revoke.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const DB_PATH =
  process.env.CMS_DB_PATH ||
  path.join(process.cwd(), "data", "cms.sqlite");

// Ensure data directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      role       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  return _db;
}

export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

export interface DbSession {
  id: string;
  email: string;
  role: string;
  created_at: number;
  expires_at: number;
  revoked: number;
}

/** Create a new session. Returns the session ID (set as cookie value). */
export function createSession(email: string, role: string): string {
  const db = getDb();
  const id = crypto.randomBytes(32).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const expires_at = now + SESSION_TTL_SECONDS;

  db.prepare(
    `INSERT INTO sessions (id, email, role, created_at, expires_at, revoked)
     VALUES (?, ?, ?, ?, ?, 0)`
  ).run(id, email, role, now, expires_at);

  return id;
}

/** Look up a session. Returns null if missing, revoked, or expired. */
export function getSession(id: string): DbSession | null {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    `SELECT * FROM sessions WHERE id = ? AND revoked = 0 AND expires_at > ?`
  ).get(id, now) as DbSession | undefined;
  return row ?? null;
}

/** Revoke a single session by ID. */
export function revokeSession(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE sessions SET revoked = 1 WHERE id = ?`).run(id);
}

/** Revoke ALL active sessions for an email (e.g. terminated staff). */
export function revokeAllSessionsForEmail(email: string): number {
  const db = getDb();
  const result = db.prepare(
    `UPDATE sessions SET revoked = 1 WHERE email = ? AND revoked = 0`
  ).run(email);
  return result.changes;
}

/** List active sessions for an email (admin use). */
export function listSessionsForEmail(email: string): DbSession[] {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(
    `SELECT * FROM sessions WHERE email = ? AND revoked = 0 AND expires_at > ? ORDER BY created_at DESC`
  ).all(email, now) as DbSession[];
}

/** Purge expired sessions (run periodically). */
export function purgeExpiredSessions(): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(
    `DELETE FROM sessions WHERE expires_at < ?`
  ).run(now);
  return result.changes;
}
