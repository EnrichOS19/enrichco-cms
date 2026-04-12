/**
 * Session management for CMS authentication.
 * Uses server-side SQLite sessions (can be revoked instantly).
 *
 * Auth: IMS (Identity Management System) JWT login.
 * Set CMS_AUTH_DISABLED=true to bypass entirely (local dev only).
 *
 * NOTE: isAuthDisabled() must never return true in production.
 *       next.config.ts enforces a hard startup crash if CMS_SESSION_SECRET
 *       is missing in production, preventing silent auth bypass.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession, type DbSession } from "./db";

export const COOKIE_NAME = "cms-session";
export const MAX_AGE = 8 * 60 * 60; // 8 hours (matches SESSION_TTL_SECONDS in db.ts)

export interface Session {
  id: string;
  email: string;
  role: string;
}

/** True when auth enforcement should be skipped. Only valid in local dev.
 *  Set CMS_AUTH_DISABLED=*** to bypass (matches npm test/dev:test scripts). */
export function isAuthDisabled(): boolean {
  return process.env.CMS_AUTH_DISABLED === "***";
}

/**
 * Get the current session from the request cookie.
 * Returns null if missing, expired, or revoked.
 * Returns a synthetic dev session if auth is disabled.
 */
export async function getSessionFromRequest(
  request: NextRequest
): Promise<Session | null> {
  if (isAuthDisabled()) {
    return { id: "dev", email: "dev@enrichco.us", role: "admin" };
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const row: DbSession | null = getSession(token);
  if (!row) return null;

  return { id: row.id, email: row.email, role: row.role };
}

/**
 * Get the current session from next/headers cookies (for use in Server Components / Route Handlers).
 */
export async function getSessionFromCookies(): Promise<Session | null> {
  if (isAuthDisabled()) {
    return { id: "dev", email: "dev@enrichco.us", role: "admin" };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const row: DbSession | null = getSession(token);
  if (!row) return null;

  return { id: row.id, email: row.email, role: row.role };
}

/**
 * requireSession — use at the top of any Route Handler that needs auth.
 * Returns { session } on success, or { response } with a 401 JSON error.
 *
 * Usage:
 *   const auth = await requireSession(request);
 *   if ('response' in auth) return auth.response;
 *   const { session } = auth;
 */
export async function requireSession(
  request: NextRequest
): Promise<{ session: Session } | { response: NextResponse }> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return {
      response: NextResponse.json(
        { error: "Unauthorized — valid session required" },
        { status: 401 }
      ),
    };
  }
  return { session };
}

/**
 * requireAdmin — like requireSession but also enforces admin role.
 */
export async function requireAdmin(
  request: NextRequest
): Promise<{ session: Session } | { response: NextResponse }> {
  const auth = await requireSession(request);
  if ("response" in auth) return auth;

  if (auth.session.role !== "admin") {
    return {
      response: NextResponse.json(
        { error: "Forbidden — admin role required" },
        { status: 403 }
      ),
    };
  }
  return auth;
}
