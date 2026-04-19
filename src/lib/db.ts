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

    CREATE TABLE IF NOT EXISTS trusted_devices (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_devices_email ON trusted_devices(email);

    CREATE TABLE IF NOT EXISTS users (
      email      TEXT PRIMARY KEY,
      role       TEXT NOT NULL DEFAULT 'support',
      name       TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      last_login INTEGER NOT NULL,
      active     INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS users_salons (
      user_email TEXT NOT NULL,
      slug       TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      PRIMARY KEY (user_email, slug)
    );
    CREATE INDEX IF NOT EXISTS idx_users_salons_email ON users_salons(user_email);
    CREATE INDEX IF NOT EXISTS idx_users_salons_slug  ON users_salons(slug);
  `);

  // Cleanup expired data on first connection
  const now = Math.floor(Date.now() / 1000);
  _db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now);
  _db.prepare(`DELETE FROM otp_codes WHERE expires_at < ?`).run(now);
  _db.prepare(`DELETE FROM reset_tokens WHERE expires_at < ?`).run(now);

  return _db;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours
export const SESSION_TTL_REMEMBER = 30 * 24 * 60 * 60; // 30 days
export const DEVICE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

export interface DbSession {
  id: string;
  email: string;
  role: string;
  created_at: number;
  expires_at: number;
  revoked: number;
}

/** Create a new session. Returns the session ID (set as cookie value). */
export function createSession(email: string, role: string, rememberMe = false): string {
  const db = getDb();
  const id = crypto.randomBytes(32).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const ttl = rememberMe ? SESSION_TTL_REMEMBER : SESSION_TTL_SECONDS;
  const expires_at = now + ttl;

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

  const codeHash = crypto
    .createHash("sha256")
    .update(code)
    .digest("hex");

  // Atomic: UPDATE WHERE used=0 AND hash matches — single statement prevents TOCTOU race
  const result = db.prepare(
    `UPDATE otp_codes SET used = 1
     WHERE id = (
       SELECT id FROM otp_codes
       WHERE email = ? AND used = 0 AND expires_at > ? AND code_hash = ?
       ORDER BY created_at DESC LIMIT 1
     ) AND used = 0`
  ).run(email.toLowerCase(), now, codeHash);

  return result.changes > 0;
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
 * Validate a raw reset token WITHOUT consuming it.
 * Returns the associated email if valid and not expired/used, null otherwise.
 * Use this for GET requests that display the reset form — the token stays usable.
 */
export function validateResetToken(rawToken: string): string | null {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const row = db.prepare(
    `SELECT * FROM reset_tokens WHERE token_hash = ? AND used = 0 AND expires_at > ?`
  ).get(tokenHash, now) as DbResetToken | undefined;

  if (!row) return null;
  return row.email;
}

/**
 * Verify a raw reset token (consuming version).
 * Returns the associated email if valid and not expired/used.
 * Marks the token as used after verification (single use).
 */
export function verifyResetToken(rawToken: string): string | null {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  // Atomic: UPDATE WHERE used=0 to prevent TOCTOU race
  const result = db.prepare(
    `UPDATE reset_tokens SET used = 1
     WHERE token_hash = ? AND used = 0 AND expires_at > ?`
  ).run(tokenHash, now);

  if (result.changes === 0) return null;

  // Fetch the email from the now-consumed token
  const row = db.prepare(
    `SELECT email FROM reset_tokens WHERE token_hash = ? AND used = 1`
  ).get(tokenHash) as { email: string } | undefined;

  return row?.email ?? null;
}

// ─── OTP payload (IMS data stored at login time) ────────────────────────────

export interface ImsPayload {
  email: string;
  role: string;
}

/**
 * Get the IMS payload stored alongside the most recent OTP for an email.
 * We do NOT filter on `used` because the OTP may have just been verified
 * (marking it used) before we can read the payload — the payload is only
 * needed once, immediately after a successful verifyOtp().
 */
export function getOtpPayload(email: string): ImsPayload | null {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const row = db.prepare(
    `SELECT ims_payload FROM otp_codes
     WHERE email = ? AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(email.toLowerCase(), now) as { ims_payload: string } | undefined;

  if (!row) return null;

  try {
    return JSON.parse(row.ims_payload) as ImsPayload;
  } catch {
    return null;
  }
}

// ─── Users ─────────────────────────────────────────────────────────────────

const SUPER_ADMIN_EMAIL = (process.env.CMS_SUPER_ADMIN_EMAIL || "sean.nguyen@enrichco.us").toLowerCase();

export type UserRole = "superadmin" | "admin" | "support" | "salon_owner";

/** True if the role has unrestricted access to all salons. */
export function isStaffRole(role: UserRole): boolean {
  return role === "superadmin" || role === "admin" || role === "support";
}

export interface DbUser {
  email: string;
  role: UserRole;
  name: string;
  created_at: number;
  last_login: number;
  active: number;
}

/** Get the effective role for an email. Super admin is always enforced from env. */
export function getEffectiveRole(email: string, imsRole?: string): UserRole {
  if (email.toLowerCase() === SUPER_ADMIN_EMAIL) return "superadmin";
  const db = getDb();
  const row = db.prepare(`SELECT role FROM users WHERE email = ? AND active = 1`).get(email.toLowerCase()) as { role: string } | undefined;
  if (row) return row.role as UserRole;
  // Fallback to IMS role for first-time users
  if (imsRole === "admin") return "admin";
  return "support";
}

/** Upsert a user on login. Creates if new, updates last_login if existing. */
export function upsertUserOnLogin(email: string, role: UserRole, name?: string): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const existing = db.prepare(`SELECT email FROM users WHERE email = ?`).get(email.toLowerCase());
  if (existing) {
    db.prepare(`UPDATE users SET last_login = ? WHERE email = ?`).run(now, email.toLowerCase());
  } else {
    db.prepare(
      `INSERT INTO users (email, role, name, created_at, last_login, active) VALUES (?, ?, ?, ?, ?, 1)`
    ).run(email.toLowerCase(), role, name || "", now, now);
  }
}

/** List all users. Super admin role is enforced dynamically. */
export function listUsers(): DbUser[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM users ORDER BY created_at ASC`).all() as DbUser[];
  return rows.map((u) => ({
    ...u,
    role: u.email === SUPER_ADMIN_EMAIL ? "superadmin" : u.role,
  }));
}

/** Update a user's role. Cannot change super admin. */
export function updateUserRole(email: string, newRole: UserRole): boolean {
  if (email.toLowerCase() === SUPER_ADMIN_EMAIL) return false; // Can't change super admin
  if (newRole === "superadmin") return false; // Can't promote to super admin
  const db = getDb();
  const result = db.prepare(`UPDATE users SET role = ? WHERE email = ? AND active = 1`).run(newRole, email.toLowerCase());
  return result.changes > 0;
}

/** Deactivate a user (soft delete). Cannot deactivate super admin. */
export function deactivateUser(email: string): boolean {
  if (email.toLowerCase() === SUPER_ADMIN_EMAIL) return false;
  const db = getDb();
  const result = db.prepare(`UPDATE users SET active = 0 WHERE email = ?`).run(email.toLowerCase());
  return result.changes > 0;
}

/** Reactivate a user. */
export function reactivateUser(email: string): boolean {
  const db = getDb();
  const result = db.prepare(`UPDATE users SET active = 1 WHERE email = ?`).run(email.toLowerCase());
  return result.changes > 0;
}

// ─── Users × Salons (per-salon access scoping for salon_owner role) ────────

/** Grant a user access to a specific salon slug. Idempotent (PK on email+slug). */
export function grantSalonAccess(email: string, slug: string, grantedBy: string): boolean {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare(
      `INSERT OR IGNORE INTO users_salons (user_email, slug, granted_by, granted_at) VALUES (?, ?, ?, ?)`
    ).run(email.toLowerCase(), slug, grantedBy.toLowerCase(), now);
    return true;
  } catch {
    return false;
  }
}

/** Revoke a user's access to a specific salon slug. */
export function revokeSalonAccess(email: string, slug: string): boolean {
  const db = getDb();
  const result = db.prepare(
    `DELETE FROM users_salons WHERE user_email = ? AND slug = ?`
  ).run(email.toLowerCase(), slug);
  return result.changes > 0;
}

/** List every slug a user has explicit access to. Empty for staff roles —
 *  staff bypass this table entirely via isStaffRole(). */
export function listSalonsForUser(email: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT slug FROM users_salons WHERE user_email = ? ORDER BY slug`
  ).all(email.toLowerCase()) as { slug: string }[];
  return rows.map((r) => r.slug);
}

/** List every user with access to a specific slug (admin view). */
export function listUsersForSalon(slug: string): Array<{ email: string; granted_by: string; granted_at: number }> {
  const db = getDb();
  return db.prepare(
    `SELECT user_email AS email, granted_by, granted_at FROM users_salons WHERE slug = ? ORDER BY granted_at ASC`
  ).all(slug) as Array<{ email: string; granted_by: string; granted_at: number }>;
}

/** Returns true if the user is explicitly granted access to this slug. */
export function userHasSalonAccess(email: string, slug: string): boolean {
  const db = getDb();
  const row = db.prepare(
    `SELECT 1 FROM users_salons WHERE user_email = ? AND slug = ? LIMIT 1`
  ).get(email.toLowerCase(), slug);
  return row !== undefined;
}

/** Check if an email is the super admin. */
export function isSuperAdmin(email: string): boolean {
  return email.toLowerCase() === SUPER_ADMIN_EMAIL;
}

// ─── Trusted Devices ───────────────────────────────────────────────────────

/** Trust a device for an email. Returns the device token (set as cookie). */
export function trustDevice(email: string): string {
  const db = getDb();
  const id = crypto.randomBytes(32).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const expires_at = now + DEVICE_TTL_SECONDS;
  db.prepare(
    `INSERT INTO trusted_devices (id, email, created_at, expires_at) VALUES (?, ?, ?, ?)`
  ).run(id, email.toLowerCase(), now, expires_at);
  return id;
}

/** Check if a device token is valid for an email. */
export function isDeviceTrusted(deviceId: string, email: string): boolean {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    `SELECT id FROM trusted_devices WHERE id = ? AND email = ? AND expires_at > ?`
  ).get(deviceId, email.toLowerCase(), now);
  return !!row;
}

/** Invite (pre-register) a user with a role. Returns false if already exists. */
export function inviteUser(email: string, role: UserRole, name?: string): boolean {
  if (role === "superadmin") return false;
  const db = getDb();
  const existing = db.prepare(`SELECT email FROM users WHERE email = ?`).get(email.toLowerCase());
  if (existing) return false;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO users (email, role, name, created_at, last_login, active) VALUES (?, ?, ?, ?, 0, 1)`
  ).run(email.toLowerCase(), role, name || "", now);
  return true;
}
