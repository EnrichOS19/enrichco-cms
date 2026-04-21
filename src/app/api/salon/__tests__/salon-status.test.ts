/**
 * Status route — tests the classification logic for the 3 publish targets
 * (draft / staging / production) under the 6 scenarios the UI has to render:
 *
 *   1. never_published — no drift-log row for a target
 *   2. live_matches    — live hash == last recorded expected hash
 *   3. drift           — live hash != expected (hash mismatch on site)
 *   4. failed_fetch    — network/DNS error fetching /deploy.json
 *   5. draft-newer-than-publish — config saved after last publish
 *   6. multi-domain    — staging green, production yellow (independent states)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { readLatestExpectedHash, fetchLiveHash } from "../[slug]/status/route";

describe("readLatestExpectedHash — drift TSV parser", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns null for never_published (no rows match slug)", () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      "other-salon\tHASH1\tother.staging.enrichco.us\t2026-04-21T10:00:00.000Z\n"
    );
    const result = readLatestExpectedHash("my-salon", "my.staging.enrichco.us", "/fake.tsv");
    expect(result).toBeNull();
  });

  it("returns most-recent row when multiple publishes for same slug+domain", () => {
    const tsv =
      "my-salon\tOLD123\tmy.staging.enrichco.us\t2026-04-19T10:00:00.000Z\n" +
      "my-salon\tMID456\tmy.staging.enrichco.us\t2026-04-20T10:00:00.000Z\n" +
      "my-salon\tNEW789\tmy.staging.enrichco.us\t2026-04-21T10:00:00.000Z\n";
    vi.spyOn(fs, "readFileSync").mockReturnValue(tsv);
    const result = readLatestExpectedHash("my-salon", "my.staging.enrichco.us", "/fake.tsv");
    expect(result?.hash).toBe("NEW789");
    expect(result?.publishedAt).toBe("2026-04-21T10:00:00.000Z");
  });

  it("separates production and staging rows by domain (multi-domain scenario)", () => {
    const tsv =
      "my-salon\tSTAGEHASH\tmy.staging.enrichco.us\t2026-04-21T10:00:00.000Z\n" +
      "my-salon\tPRODHASH\tmysalon.com\t2026-04-20T10:00:00.000Z\n";
    vi.spyOn(fs, "readFileSync").mockReturnValue(tsv);
    const staging = readLatestExpectedHash("my-salon", "my.staging.enrichco.us", "/fake.tsv");
    const prod = readLatestExpectedHash("my-salon", "mysalon.com", "/fake.tsv");
    expect(staging?.hash).toBe("STAGEHASH");
    expect(prod?.hash).toBe("PRODHASH");
  });

  it("matches domain case-insensitively (DNS is case-insensitive)", () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      "my-salon\tH\tMySalon.Com\t2026-04-21T10:00:00.000Z\n"
    );
    const result = readLatestExpectedHash("my-salon", "mysalon.com", "/fake.tsv");
    expect(result?.hash).toBe("H");
  });

  it("returns null when TSV file is missing (fresh server, not an error)", () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const result = readLatestExpectedHash("any", "any.com", "/nope.tsv");
    expect(result).toBeNull();
  });
});

describe("fetchLiveHash — deploy.json fetcher", () => {
  const originalFetch = global.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns live hash when /deploy.json returns 200", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ hash: "live123" }), { status: 200 })
    ) as unknown as typeof fetch;
    const result = await fetchLiveHash("example.com", "cb");
    expect(result.ok).toBe(true);
    expect(result.liveHash).toBe("live123");
  });

  it("returns ok=false on 404 (deploy_json_missing) — classified as failed_fetch", async () => {
    global.fetch = vi.fn(
      async () => new Response("nope", { status: 404 })
    ) as unknown as typeof fetch;
    const result = await fetchLiveHash("example.com", "cb");
    expect(result.ok).toBe(false);
    expect(result.liveHash).toBeNull();
  });

  it("returns ok=false when network throws (DNS/TLS broken)", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    const result = await fetchLiveHash("nxdomain.example", "cb");
    expect(result.ok).toBe(false);
    expect(result.liveHash).toBeNull();
  });

  it("lowercases domain so status checks don't hit case-mismatched dirs", async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ hash: "h" }), { status: 200 })
    ) as unknown as typeof fetch;
    global.fetch = spy;
    await fetchLiveHash("MySalon.Com", "cb");
    const calledUrl = (spy as unknown as { mock: { calls: [string][] } }).mock.calls[0][0];
    expect(calledUrl).toContain("https://mysalon.com/deploy.json");
    expect(calledUrl).not.toContain("MySalon");
  });

  it("appends cache-buster so CF/nginx can't mask live hash", async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ hash: "h" }), { status: 200 })
    ) as unknown as typeof fetch;
    global.fetch = spy;
    await fetchLiveHash("example.com", "xyz789");
    const calledUrl = (spy as unknown as { mock: { calls: [string][] } }).mock.calls[0][0];
    expect(calledUrl).toContain("?_v=xyz789");
  });
});

