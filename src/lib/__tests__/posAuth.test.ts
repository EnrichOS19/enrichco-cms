/**
 * Story 1 — POS auth proxy unit tests.
 *
 * These tests mock the POS HTTP endpoints and the DB pairing table so no
 * network calls or real SQLite files are needed.
 *
 * TDD: red first — run before posAuth.ts exists to confirm the suite fails,
 *      then implement until green.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── fetch mock setup ─────────────────────────────────────────────────────────
// We mock global fetch so posAuth.ts uses our stubs.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── DB pairing mock ──────────────────────────────────────────────────────────
// posAuth.ts uses getPosPairing / savePosPairing from @/lib/db — mock that
// module so we don't need a real SQLite file.
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getPosPairing: vi.fn(),
    savePosPairing: vi.fn(),
  };
});

import { lookupStoreByEmail, verifyPosPassword } from "@/lib/posAuth";
import { getPosPairing, savePosPairing } from "@/lib/db";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeFetchResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// ── lookupStoreByEmail ────────────────────────────────────────────────────────

describe("lookupStoreByEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for unknown email (data==0)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse({ error_code: 200, error_message: "", data: 0 })
    );
    const result = await lookupStoreByEmail("nobody@example.com");
    expect(result).toBeNull();
  });

  it("returns storeId string for single-store owner (data==1)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse({ error_code: 200, error_message: "2222", data: 1 })
    );
    const result = await lookupStoreByEmail("owner@ntv.com");
    expect(result).toEqual({ storeId: "2222", count: 1 });
  });

  it("returns count > 1 for multi-store owner", async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse({ error_code: 200, error_message: "783", data: 3 })
    );
    const result = await lookupStoreByEmail("multi@example.com");
    expect(result).toEqual({ storeId: "783", count: 3 });
  });

  it("returns null when POS returns non-JSON (staff accounts)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("not json"); },
      text: async () => "<!DOCTYPE html>",
    } as unknown as Response);
    const result = await lookupStoreByEmail("andy.tran@mangoforsalon.com");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await lookupStoreByEmail("owner@example.com");
    expect(result).toBeNull();
  });
});

// ── verifyPosPassword ─────────────────────────────────────────────────────────

describe("verifyPosPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing pairing
    vi.mocked(getPosPairing).mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns success + pairId on correct credentials (no existing pairing)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse({ code: 0, urlTarget: "https://pos.example.com", PairId: "pair-abc", mess: "device-123" })
    );
    vi.mocked(savePosPairing).mockReturnValue(undefined);

    const result = await verifyPosPassword({
      email: "owner@ntv.com",
      password: "correctpass",
      storeId: "2222",
      deviceName: "CMS-Web",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pairId).toBe("pair-abc");
      expect(result.storeId).toBe("2222");
    }
    // Should save the pairing for next time
    expect(savePosPairing).toHaveBeenCalledWith(
      expect.objectContaining({ email: "owner@ntv.com", storeId: "2222", pairId: "pair-abc" })
    );
  });

  it("reuses an existing pairId (passes it to LoginFirstTime)", async () => {
    vi.mocked(getPosPairing).mockReturnValue({
      email: "owner@ntv.com",
      store_id: "2222",
      pair_id: "existing-pair",
      device_name: "CMS-Web",
      created_at: 0,
    });
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse({ code: 0, urlTarget: "", PairId: "existing-pair", mess: "device-123" })
    );

    const result = await verifyPosPassword({
      email: "owner@ntv.com",
      password: "pass",
      storeId: "2222",
      deviceName: "CMS-Web",
    });

    expect(result.ok).toBe(true);
    // Verify the fetch URL included the existing pairId
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("PairId=existing-pair");
    // Should NOT call savePosPairing again (pairing already exists)
    expect(savePosPairing).not.toHaveBeenCalled();
  });

  it("returns failure on wrong password (non-zero code)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse({ code: 1, urlTarget: "", PairId: "", mess: "Invalid password" })
    );

    const result = await verifyPosPassword({
      email: "owner@ntv.com",
      password: "wrongpass",
      storeId: "2222",
      deviceName: "CMS-Web",
    });
    expect(result.ok).toBe(false);
  });

  it("returns failure when mess=='Full' (too many devices)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse({ code: 1, urlTarget: "", PairId: "", mess: "Full" })
    );

    const result = await verifyPosPassword({
      email: "owner@ntv.com",
      password: "pass",
      storeId: "2222",
      deviceName: "CMS-Web",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("full");
    }
  });

  it("returns failure on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await verifyPosPassword({
      email: "owner@ntv.com",
      password: "pass",
      storeId: "2222",
      deviceName: "CMS-Web",
    });
    expect(result.ok).toBe(false);
  });
});
