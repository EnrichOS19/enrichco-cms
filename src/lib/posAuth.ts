/**
 * POS auth proxy — wraps the two Mango POS login endpoints.
 *
 * Endpoints (public, no auth required on POS side):
 *   GET https://login.mangoforsalon.com/PosLogin/checkExistEmailStore?login=<email>
 *     → { error_code: 200, error_message: <storeId>, data: <count> }
 *       data==0  → not a store account
 *       data==1  → single store
 *       data>1   → multi-store owner (error_message still has one storeId)
 *
 *   GET https://login.mangoforsalon.com/PosLogin/LoginFirstTime?login=<email>&password=<p>&storeID=<id>&name=<device>[&PairId=<id>]
 *     → { code: 0, urlTarget, PairId, mess: <deviceId> }  on success
 *       code != 0 or mess=="Full" on failure
 *
 * PairId persistence:
 *   Each (email, storeId) pair gets one DB row. On first login we call
 *   LoginFirstTime without PairId and save the returned one. On subsequent
 *   logins we pass it back — reusing the existing device slot so owners never
 *   hit the "Full" limit.
 */

import { getPosPairing, savePosPairing } from "@/lib/db";

const POS_BASE = "https://login.mangoforsalon.com";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StoreLookupResult {
  /** POS storeId string (e.g. "2222"). */
  storeId: string;
  /** Number of stores associated with the email. 1 = single-store, >1 = multi. */
  count: number;
}

export type VerifyPosSuccess = { ok: true; storeId: string; pairId: string };
export type VerifyPosFailure = { ok: false; reason: "bad_credentials" | "full" | "error" };
export type VerifyPosResult = VerifyPosSuccess | VerifyPosFailure;

export interface VerifyPosPasswordArgs {
  email: string;
  password: string;
  storeId: string;
  deviceName: string;
}

// ── checkExistEmailStore ─────────────────────────────────────────────────────

/**
 * Look up whether an email is associated with a POS store.
 * Returns null if the email has no store (staff / non-owner account),
 * or on network / parse failure.
 */
export async function lookupStoreByEmail(
  email: string
): Promise<StoreLookupResult | null> {
  const url = `${POS_BASE}/PosLogin/checkExistEmailStore?login=${encodeURIComponent(email)}`;

  let data: { error_code: number; error_message: string; data: number };
  try {
    const res = await fetch(url);
    data = await res.json();
  } catch {
    // Network error, non-JSON response (e.g. staff accounts return HTML), etc.
    return null;
  }

  if (data.data === 0) return null;

  return { storeId: String(data.error_message), count: Number(data.data) };
}

// ── LoginFirstTime ────────────────────────────────────────────────────────────

/**
 * Verify a POS password for a given storeId.
 *
 * Pairing reuse:
 *   - If a prior pairing row exists for (email, storeId), include its PairId
 *     in the request — this reuses the existing device slot.
 *   - If no row, call without PairId; save the returned PairId on success.
 */
export async function verifyPosPassword(
  args: VerifyPosPasswordArgs
): Promise<VerifyPosResult> {
  const { email, password, storeId, deviceName } = args;

  // Check for an existing pairing to reuse
  const existing = getPosPairing(email, storeId);

  const params = new URLSearchParams({
    login: email,
    password,
    storeID: storeId,
    name: deviceName,
  });
  if (existing) {
    params.set("PairId", existing.pair_id);
  }

  const url = `${POS_BASE}/PosLogin/LoginFirstTime?${params.toString()}`;

  let body: { code: number; urlTarget: string; PairId: string; mess: string };
  try {
    const res = await fetch(url);
    body = await res.json();
  } catch {
    return { ok: false, reason: "error" };
  }

  // "Full" means too many paired devices
  if (body.mess === "Full") {
    return { ok: false, reason: "full" };
  }

  if (body.code !== 0) {
    return { ok: false, reason: "bad_credentials" };
  }

  // Success — persist pairing if this was a new slot
  if (!existing && body.PairId) {
    savePosPairing({ email, storeId, pairId: body.PairId, deviceName });
  }

  return { ok: true, storeId, pairId: body.PairId };
}
