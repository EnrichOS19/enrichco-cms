import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { verifyLiveDeploy } from "../publish";

describe("verifyLiveDeploy — post-deploy live URL verification", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns verified=true when live /deploy.json hash matches", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ hash: "abc123def456" }), { status: 200 })
    ) as unknown as typeof fetch;

    const result = await verifyLiveDeploy("lexanails.net", "abc123def456");
    expect(result.verified).toBe(true);
    if (result.verified) {
      expect(result.liveHash).toBe("abc123def456");
      expect(result.domain).toBe("lexanails.net");
    }
  });

  it("lowercases the domain before fetch so case mismatches can never hit dead dirs", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ hash: "h" }), { status: 200 })
    ) as unknown as typeof fetch;
    global.fetch = fetchSpy;

    await verifyLiveDeploy("CaliNailsandSpaVacaville.com", "h");
    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = (fetchSpy as unknown as { mock: { calls: [string][] } }).mock.calls[0][0];
    expect(calledUrl).toContain("https://calinailsandspavacaville.com/deploy.json");
    expect(calledUrl).not.toContain("CaliNails");
  });

  it("flags hash_mismatch when live serves an older build (stale cache / wrong dir)", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ hash: "OLDHASH" }), { status: 200 })
    ) as unknown as typeof fetch;

    const result = await verifyLiveDeploy("example.com", "NEWHASH");
    expect(result.verified).toBe(false);
    if (!result.verified) {
      expect(result.reason).toBe("hash_mismatch");
      expect(result.liveHash).toBe("OLDHASH");
      expect(result.hint).toContain("stale cache");
    }
  });

  it("flags deploy_json_missing on 404 (nginx not serving our deploy)", async () => {
    global.fetch = vi.fn(
      async () => new Response("not found", { status: 404 })
    ) as unknown as typeof fetch;

    const result = await verifyLiveDeploy("example.com", "abc");
    expect(result.verified).toBe(false);
    if (!result.verified) {
      expect(result.reason).toBe("deploy_json_missing");
      expect(result.status).toBe(404);
      expect(result.hint).toContain("DNS");
    }
  });

  it("flags fetch_failed when DNS / TLS / network layer breaks", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;

    const result = await verifyLiveDeploy("does-not-exist.example", "h");
    expect(result.verified).toBe(false);
    if (!result.verified) {
      expect(result.reason).toBe("fetch_failed");
      expect(result.hint).toContain("ENOTFOUND");
    }
  });

  it("appends a cache-buster query param so CF / browser cache can't hide drift", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ hash: "h" }), { status: 200 })
    ) as unknown as typeof fetch;
    global.fetch = fetchSpy;

    await verifyLiveDeploy("example.com", "h");
    const calledUrl = (fetchSpy as unknown as { mock: { calls: [string][] } }).mock.calls[0][0];
    expect(calledUrl).toContain("?_v=h");
  });
});
