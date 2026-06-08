import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetMulesoftWarnDedupForTests,
  fetchLiveHealthBundle,
  getHealthBundlePreferLive,
  isMulesoftHealthLive
} from "./health";

/**
 * Tests for the live MuleSoft Experience-API client.
 *
 * Mirrors the live/mock matrix lib/salesforce/grounding.test.ts pins
 * for the Care Router's grounding path:
 *
 *   1. Configuration detection: isMulesoftHealthLive() honors the env
 *      var and rejects obviously-broken values.
 *   2. Fetch success: bare-bundle and { meta, bundle } envelope
 *      shapes both resolve.
 *   3. Fetch failures: non-2xx, network/abort, malformed JSON, wrong
 *      shape -- each returns null and emits exactly one warn.
 *   4. getHealthBundlePreferLive: live success returns live; live
 *      failure transparently degrades to mock.
 */

const ENV_KEY = "MULESOFT_HEALTH_BASE_URL";
const LIVE_URL = "https://pause-mulesoft-health-v1.us-e2.cloudhub.io";

beforeEach(() => {
  delete process.env[ENV_KEY];
  _resetMulesoftWarnDedupForTests();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOk(body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  ) as unknown as typeof fetch;
}

function mockFetchStatus(status: number, body: unknown = "boom"): typeof fetch {
  return vi.fn(async () =>
    new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status }
    )
  ) as unknown as typeof fetch;
}

function mockFetchThrows(err: Error): typeof fetch {
  return vi.fn(async () => {
    throw err;
  }) as unknown as typeof fetch;
}

function fakeBundle(entries = 4) {
  return {
    resourceType: "Bundle",
    type: "searchset",
    meta: { lastUpdated: "2026-06-08T00:00:00Z" },
    entry: Array.from({ length: entries }, (_, i) => ({
      fullUrl: `urn:uuid:obs-${i}`,
      resource: { resourceType: "Observation", id: `obs-${i}` }
    }))
  };
}

describe("isMulesoftHealthLive", () => {
  it("returns false when env var is unset", () => {
    expect(isMulesoftHealthLive()).toBe(false);
  });

  it("returns false for an obviously broken value (no scheme)", () => {
    process.env[ENV_KEY] = "pause-mulesoft-health-v1.us-e2.cloudhub.io";
    expect(isMulesoftHealthLive()).toBe(false);
  });

  it("returns true for an https URL", () => {
    process.env[ENV_KEY] = LIVE_URL;
    expect(isMulesoftHealthLive()).toBe(true);
  });

  it("accepts http for local CloudHub tunnel testing", () => {
    process.env[ENV_KEY] = "http://localhost:8081";
    expect(isMulesoftHealthLive()).toBe(true);
  });

  it("trims surrounding whitespace before checking", () => {
    process.env[ENV_KEY] = `   ${LIVE_URL}   `;
    expect(isMulesoftHealthLive()).toBe(true);
  });

  it("explicit baseUrl argument overrides env", () => {
    process.env[ENV_KEY] = LIVE_URL;
    expect(isMulesoftHealthLive("")).toBe(false);
    expect(isMulesoftHealthLive("https://other.example.com")).toBe(true);
  });
});

describe("fetchLiveHealthBundle · success paths", () => {
  it("returns the bundle when Mule responds with a bare FHIR Bundle", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const expected = fakeBundle(3);
    const fetchImpl = mockFetchOk(expected);
    const out = await fetchLiveHealthBundle({ fetchImpl });
    expect(out?.entry).toHaveLength(3);
    expect(out?.resourceType).toBe("Bundle");
    expect(fetchImpl).toHaveBeenCalledWith(
      `${LIVE_URL}/health`,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("returns the bundle when Mule responds with the { meta, bundle } envelope", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const expected = fakeBundle(5);
    const fetchImpl = mockFetchOk({
      meta: { _source: "live-mulesoft" },
      bundle: expected
    });
    const out = await fetchLiveHealthBundle({ fetchImpl });
    expect(out?.entry).toHaveLength(5);
  });

  it("strips a trailing slash from the base URL", async () => {
    process.env[ENV_KEY] = `${LIVE_URL}/`;
    const fetchImpl = mockFetchOk(fakeBundle());
    await fetchLiveHealthBundle({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${LIVE_URL}/health`,
      expect.anything()
    );
  });

  it("sends the X-Pause-Source header so Mule can distinguish prototype traffic", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const fetchImpl = mockFetchOk(fakeBundle());
    await fetchLiveHealthBundle({ fetchImpl });
    const init = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Pause-Source"]).toBe("pause-health.ai/prototype");
    expect(headers.Accept).toBe("application/json");
  });
});

describe("fetchLiveHealthBundle · failure paths", () => {
  it("returns null and warns on non-2xx", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const out = await fetchLiveHealthBundle({
      fetchImpl: mockFetchStatus(503, "service unavailable")
    });
    expect(out).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect((console.warn as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]).toMatch(
      /health\.live-fetch\.http/
    );
  });

  it("returns null and warns on network error", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const out = await fetchLiveHealthBundle({
      fetchImpl: mockFetchThrows(new TypeError("fetch failed: ECONNREFUSED"))
    });
    expect(out).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("returns null and warns on malformed JSON", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const fetchImpl = vi.fn(
      async () =>
        new Response("not-json{", {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
    ) as unknown as typeof fetch;
    const out = await fetchLiveHealthBundle({ fetchImpl });
    expect(out).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("returns null and warns when shape is wrong (no resourceType)", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const out = await fetchLiveHealthBundle({
      fetchImpl: mockFetchOk({ random: "garbage" })
    });
    expect(out).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("returns null and warns when base URL has no http(s) scheme", async () => {
    process.env[ENV_KEY] = "ftp://nope.example.com";
    const out = await fetchLiveHealthBundle();
    expect(out).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("returns null without warning when env var is unset (fast path)", async () => {
    delete process.env[ENV_KEY];
    const out = await fetchLiveHealthBundle();
    expect(out).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("deduplicates repeated warnings within the same failure bucket", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const fetchImpl = mockFetchStatus(503);
    await fetchLiveHealthBundle({ fetchImpl });
    await fetchLiveHealthBundle({ fetchImpl });
    await fetchLiveHealthBundle({ fetchImpl });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("emits separate warnings for distinct failure buckets", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    await fetchLiveHealthBundle({ fetchImpl: mockFetchStatus(503) });
    await fetchLiveHealthBundle({
      fetchImpl: mockFetchThrows(new TypeError("ECONNREFUSED"))
    });
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});

describe("getHealthBundlePreferLive", () => {
  it("returns source='mock' without any fetch when env is unset", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const out = await getHealthBundlePreferLive({ fetchImpl });
    expect(out.source).toBe("mock");
    expect(out.liveUrl).toBeUndefined();
    expect(out.bundle.entry.length).toBeGreaterThan(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns source='live' + liveUrl on successful Mule response", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const out = await getHealthBundlePreferLive({
      fetchImpl: mockFetchOk(fakeBundle(2))
    });
    expect(out.source).toBe("live");
    expect(out.liveUrl).toBe(`${LIVE_URL}/health`);
    expect(out.bundle.entry).toHaveLength(2);
  });

  it("transparently degrades to mock when Mule returns non-2xx", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const out = await getHealthBundlePreferLive({
      fetchImpl: mockFetchStatus(503)
    });
    expect(out.source).toBe("mock");
    // The mock bundle still has the seeded entries so the caller
    // serves a useful response even when the live path fails.
    expect(out.bundle.entry.length).toBeGreaterThan(0);
  });

  it("transparently degrades to mock when Mule responds with bad shape", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const out = await getHealthBundlePreferLive({
      fetchImpl: mockFetchOk({ resourceType: "OperationOutcome" })
    });
    expect(out.source).toBe("mock");
  });
});
