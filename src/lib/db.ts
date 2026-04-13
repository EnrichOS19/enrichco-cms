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
    CREATE INDEX IF NOT EXISTS idx_sessions_email    ON sessions(email);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS otp_codes (
      id           TEXT PRIMARY KEY,
      email        TEXT NOT NULL,
      code_hash    TEXT NOT NULL,
      ims_payload  TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL,
      used         INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_otp_email   ON otp_codes(email);
    CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);

    CREATE TABLE IF NOT EXISTS reset_tokens (
      id           TEXT PRIMARY KEY,
      email        TEXT NOT NULL,
      token_hash   TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL,
      used         INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_reset_email   ON reset_tokens(email);
    CREATE INDEX IF NOT EXISTS idx_reset_expires ON reset_tokens(expires_at);
  `);

  return _db;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

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

// ─── OTP ────────────────────────────────────────────────────────────────────

export const OTP_TTL_SECONDS = 5 * 60; // 5 minutes

export interface DbOtp {
  id: string;
  email: string;
  code_hash: string;
  ims_payload: string;
  created_at: number;
  expires_at: number;
  used: number;
}

/** Store a new OTP for the given email. Invalidates all previous unused OTPs for that email. */
export function storeOtp(email: string, code: string, imsPayload: object): string {
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const expires_at = now + OTP_TTL_SECONDS;

  // Invalidate any existing unused OTPs for this email
  db.prepare(
    `UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0`
  ).run(email.toLowerCase());

  // Hash the 6-digit code before storing
  const codeHash = crypto
    .createHash("sha256")
    .update(code)
    .digest("hex");

  db.prepare(
    `INSERT INTO otp_codes (id, email, code_hash, ims_payload, created_at, expires_at, used)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(id, email.toLowerCase(), codeHash, JSON.stringify(imsPayload), now, expires_at);

  return id;
}

/**
 * Verify an OTP.
 * Returns true if the code matches and is not expired or already used.
 * The OTP is marked as used after successful verification (single use).
 */
export function verifyOtp(email: string, code: string): boolean {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const row = db.prepare(
    `SELECT * FROM otp_codes
     WHERE email = ? AND used = 0 AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(email.toLowerCase(), now) as DbOtp | undefined;

  if (!row) return false;

  const codeHash = crypto
    .createHash("sha256")
    .update(code)
    .digest("hex");

  if (codeHash !== row.code_hash) return false;

  // Mark as used (single use)
  db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).run(row.id);
  return true;
}

/** Purge expired OTP codes. */
export function purgeExpiredOtps(): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(
    `DELETE FROM otp_codes WHERE expires_at < ?`
  ).run(now);
  return result.changes;
}

// ─── Password Reset Tokens ──────────────────────────────────────────────────

export const RESET_TOKEN_TTL_SECONDS = 30 * 60; // 30 minutes

export interface DbResetToken {
  id: string;
  email: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
  used: number;
}

/**
 * Generate a password reset token for the given email.
 * Invalidates all previous unused tokens for that email.
 * Returns the raw token (sent to user via email) — hash stored in DB.
 */
export function createResetToken(email: string): string {
  const db = getDb();
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const id = crypto.randomBytes(16).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const expires_at = now + RESET_TOKEN_TTL_SECONDS;

  db.prepare(`UPDATE reset_tokens SET used = 1 WHERE email = ? AND used = 0`).run(email.toLowerCase());
  db.prepare(
    `INSERT INTO reset_tokens (id, email, token_hash, created_at, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)`
  ).run(id, email.toLowerCase(), tokenHash, now, expires_at);

  return rawToken;
}

/**
 * Verify a raw reset token.
 * Returns the associated email if valid and not expired/used.
 * Marks the token as used after verification (single use).
 */
export function verifyResetToken(rawToken: string): string | null {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const row = db.prepare(
    `SELECT * FROM reset_tokens WHERE token_hash = ? AND used = 0 AND expires_at > ?`
  ).get(tokenHash, now) as DbResetToken | undefined;

  if (!row) return null;

  db.prepare(`UPDATE reset_tokens SET used = 1 WHERE id = ?`).run(row.id);
  return row.email;
}

// ─── OTP payload (IMS data stored at login time) ────────────────────────────

export interface ImsPayload {
  email: string;
  role: string;
}

/**
 * Get the IMS payload stored alongside the most recent unused OTP for an email.
 * Returns null if no valid OTP exists.
 */
export function getOtpPayload(email: string): ImsPayload | null {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const row = db.prepare(
    `SELECT ims_payload FROM otp_codes
     WHERE email = ? AND used = 0 AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(email.toLowerCase(), now) as { ims_payload: string } | undefined;

  if (!row) return null;

  try {
    return JSON.parse(row.ims_payload) as ImsPayload;
  } catch {
    return null;
  }
}
