import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { _resetMulesoftWarnDedupForTests } from "../../../../lib/mulesoft/health";

/**
 * Tests for /api/mulesoft/health.
 *
 * The route has three documented modes:
 *
 *   1. Mock (env unset)        -> meta._source: "mock"
 *   2. Live success             -> meta._source: "live-mulesoft"
 *   3. Live attempted, failed   -> meta._source: "mock-fallback"
 *
 * Mode 1 is the prototype's default and what every Vercel preview /
 * CI run hits; modes 2-3 activate when MULESOFT_HEALTH_BASE_URL is
 * set. All three must serve a non-empty FHIR Bundle so the
 * downstream `/proposal/mulesoft` `curl` button always succeeds.
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
  vi.unstubAllGlobals();
});

function stubFetchOk(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
    )
  );
}

function stubFetchStatus(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("upstream error", { status, headers: {} })
    )
  );
}

function fakeBundle(entries = 2) {
  return {
    resourceType: "Bundle",
    type: "searchset",
    meta: {
      lastUpdated: "2026-06-08T00:00:00Z",
      source: "urn:pause-health:mulesoft:pause-patient-bundle-process-api"
    },
    entry: Array.from({ length: entries }, (_, i) => ({
      fullUrl: `urn:uuid:obs-${i}`,
      resource: { resourceType: "Observation", id: `obs-${i}` }
    }))
  };
}

describe("GET /api/mulesoft/health · mock mode (env unset)", () => {
  it("returns 200 with meta._source='mock' and a non-empty bundle", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta._source).toBe("mock");
    expect(json.bundle.resourceType).toBe("Bundle");
    expect(json.bundle.entry.length).toBeGreaterThan(0);
  });

  it("does NOT make a network call when env var is unset", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await GET();
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits the documented Cache-Control header", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/);
  });
});

describe("GET /api/mulesoft/health · live mode", () => {
  it("returns 200 with meta._source='live-mulesoft' and the live bundle on success", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    stubFetchOk(fakeBundle(2));

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta._source).toBe("live-mulesoft");
    expect(json.meta._liveUrl).toBe(`${LIVE_URL}/health`);
    expect(json.bundle.entry).toHaveLength(2);
  });

  it("accepts the { meta, bundle } envelope shape from the Mule app", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    stubFetchOk({
      meta: { _source: "live-mulesoft" },
      bundle: fakeBundle(3)
    });

    const res = await GET();
    const json = await res.json();
    expect(json.meta._source).toBe("live-mulesoft");
    expect(json.bundle.entry).toHaveLength(3);
  });
});

describe("GET /api/mulesoft/health · live mode, upstream failure", () => {
  it("degrades to mock-fallback with the seeded bundle when Mule returns 5xx", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    stubFetchStatus(503);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta._source).toBe("mock-fallback");
    expect(json.meta._liveAttempted).toBe(true);
    expect(json.meta._liveUrl).toBe(`${LIVE_URL}/health`);
    expect(json.bundle.resourceType).toBe("Bundle");
    expect(json.bundle.entry.length).toBeGreaterThan(0);
  });

  it("degrades to mock-fallback when Mule throws a network error", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed: ECONNREFUSED");
      })
    );

    const res = await GET();
    const json = await res.json();
    expect(json.meta._source).toBe("mock-fallback");
  });

  it("degrades to mock-fallback when Mule returns 200 with wrong shape", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    stubFetchOk({ resourceType: "OperationOutcome" });

    const res = await GET();
    const json = await res.json();
    expect(json.meta._source).toBe("mock-fallback");
  });

  it("never throws to the caller -- response is always a 200 JSON body", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("anything at all");
      })
    );

    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      meta: expect.objectContaining({ _source: "mock-fallback" })
    });
  });
});
