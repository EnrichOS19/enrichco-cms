/**
 * Simple in-memory rate limiter for auth endpoints.
 * Does NOT require Redis — safe for single-instance Next.js deployments.
 * For multi-instance deployments, replace with Redis-backed implementation.
 *
 * Usage:
 *   const { allowed, remaining, resetIn } = checkRateLimit(key, { limit: 5, windowSec: 60 });
 *   if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
 */

interface RateLimitEntry {
  count: number;
  resetAt: number; // Unix ms
}

const store = new Map<string, RateLimitEntry>();

/** Remove stale entries periodically to prevent memory leaks. */
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) store.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // seconds until window resets
}

export interface RateLimitOptions {
  limit: number;
  windowSec: number;
}

/**
 * Check (and update) a rate limit counter for the given key.
 * Returns whether the request is allowed and how many more are permitted.
 */
export function checkRateLimit(
  key: string,
  opts: RateLimitOptions
): RateLimitResult {
  cleanup();

  const now = Date.now();
  const windowMs = opts.windowSec * 1000;
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // New or expired window
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: opts.limit - 1, resetIn: opts.windowSec };
  }

  if (entry.count >= opts.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: opts.limit - entry.count,
    resetIn: Math.ceil((entry.resetAt - now) / 1000),
  };
}

/**
 * Add standard rate-limit headers to a NextResponse.
 */
export function withRateLimitHeaders(
  res: NextResponse,
  result: RateLimitResult
): NextResponse {
  res.headers.set("X-RateLimit-Remaining", String(result.remaining));
  res.headers.set("X-RateLimit-Reset", String(result.resetIn));
  if (!result.allowed) {
    res.headers.set("Retry-After", String(result.resetIn));
  }
  return res;
}

import { NextResponse } from "next/server";
