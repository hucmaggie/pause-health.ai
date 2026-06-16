import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { _resetProvidersWarnDedupForTests } from "../../../../lib/mulesoft/providers";

/**
 * Tests for /api/mulesoft/providers.
 *
 * Like /health, the route has three modes — mock (env unset), live success,
 * and live-attempted-then-degraded — plus query-param handling the health
 * route doesn't have (zip / menopause / limit / fallback / insurance /
 * distance). The headline regression these pin: the route normalizes the
 * insurance synonym BEFORE handing the query to the live Mule worker (which
 * only lowercases), so ?insurance=United reaches the live API as "uhc" and
 * doesn't silently return zero the way it used to.
 */

const ENV_KEY = "MULESOFT_PROVIDERS_BASE_URL";
const LIVE_URL = "https://pause-mulesoft-health-v1.us-e2.cloudhub.io";
// Auth0 vars must stay unset so getMulesoftBearerToken() short-circuits to null
// without a network call — the only fetch in live mode is then the /providers
// call we capture.
const AUTH_KEYS = [
  "AUTH0_MULESOFT_CLIENT_ID",
  "AUTH0_MULESOFT_CLIENT_SECRET",
  "AUTH0_MULESOFT_DOMAIN",
  "AUTH0_MULESOFT_AUDIENCE",
  "MULESOFT_CLIENT_ID",
  "MULESOFT_CLIENT_SECRET"
] as const;

const savedAuth: Record<string, string | undefined> = {};

beforeEach(() => {
  delete process.env[ENV_KEY];
  for (const k of AUTH_KEYS) {
    savedAuth[k] = process.env[k];
    delete process.env[k];
  }
  _resetProvidersWarnDedupForTests();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const k of AUTH_KEYS) {
    if (savedAuth[k] === undefined) delete process.env[k];
    else process.env[k] = savedAuth[k];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function req(qs: string) {
  return new Request(`https://pause-health.ai/api/mulesoft/providers${qs}`);
}

/** Capture outbound live-fetch URLs while returning a valid provider result. */
function stubLiveFetchCapturing(result: unknown) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    })
  );
  return calls;
}

const liveResultShape = {
  query: { insurance: "uhc" },
  matchType: "all",
  sort: "score",
  total: 1,
  returned: 1,
  providers: [{ npi: "1000000001", name: "Live Provider", insuranceAccepted: ["uhc"] }],
  provenance: {}
};

describe("GET /api/mulesoft/providers · mock mode (env unset)", () => {
  it("returns 200 with meta._source='mock' and a providers array", async () => {
    const res = await GET(req("?menopause=true&limit=3"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta._source).toBe("mock");
    expect(Array.isArray(json.providers)).toBe(true);
    expect(json.returned).toBeLessThanOrEqual(3);
  });

  it("does NOT make a network call when env var is unset", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await GET(req("?menopause=true"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits the documented Cache-Control header", async () => {
    const res = await GET(req(""));
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=300/);
  });

  it("narrows to telehealth in mock mode (?telehealth=true)", async () => {
    const res = await GET(req("?telehealth=true&limit=50"));
    const json = await res.json();
    expect(json.query.telehealth).toBe(true);
    for (const p of json.providers) {
      expect(p.telehealth).toBe(true);
    }
  });

  it("normalizes insurance synonyms in mock mode (United → uhc)", async () => {
    const res = await GET(req("?insurance=United&limit=50"));
    const json = await res.json();
    expect(json.query.insurance).toBe("uhc");
    for (const p of json.providers) {
      expect(p.insuranceAccepted).toContain("uhc");
    }
  });

  it("clamps an out-of-range limit into 1..50", async () => {
    const res = await GET(req("?menopause=true&limit=9999"));
    const json = await res.json();
    expect(json.returned).toBeLessThanOrEqual(50);
  });
});

describe("GET /api/mulesoft/providers · live mode", () => {
  it("forwards the CANONICAL insurance token to the live worker (United → uhc)", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const calls = stubLiveFetchCapturing(liveResultShape);

    const res = await GET(req("?insurance=United&menopause=true"));
    const json = await res.json();

    expect(json.meta._source).toBe("live-mulesoft");
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    // The regression guard: raw "United" must have been normalized to "uhc"
    // BEFORE the live call, not forwarded verbatim.
    expect(url.searchParams.get("insurance")).toBe("uhc");
    expect(url.searchParams.get("menopause")).toBe("true");
  });

  it("normalizes 'Blue Cross' → bcbs on the live path too", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const calls = stubLiveFetchCapturing(liveResultShape);

    await GET(req("?insurance=Blue%20Cross"));
    const url = new URL(calls[0]);
    expect(url.searchParams.get("insurance")).toBe("bcbs");
  });

  it("omits the insurance param entirely when none is supplied", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const calls = stubLiveFetchCapturing(liveResultShape);

    await GET(req("?menopause=true"));
    const url = new URL(calls[0]);
    expect(url.searchParams.has("insurance")).toBe(false);
  });

  it("forwards ?telehealth=true to the live worker", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const calls = stubLiveFetchCapturing(liveResultShape);

    await GET(req("?telehealth=true&menopause=true"));
    const url = new URL(calls[0]);
    expect(url.searchParams.get("telehealth")).toBe("true");
  });

  it("omits the telehealth param when not requested", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const calls = stubLiveFetchCapturing(liveResultShape);

    await GET(req("?menopause=true"));
    const url = new URL(calls[0]);
    expect(url.searchParams.has("telehealth")).toBe(false);
  });

  it("returns meta._source='live-mulesoft' and the live body on success", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    stubLiveFetchCapturing(liveResultShape);

    const res = await GET(req("?menopause=true"));
    const json = await res.json();
    expect(json.meta._source).toBe("live-mulesoft");
    expect(json.providers[0].npi).toBe("1000000001");
  });
});

describe("GET /api/mulesoft/providers · live mode, upstream failure", () => {
  it("degrades to mock-fallback when the worker returns 5xx", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream error", { status: 503 }))
    );

    const res = await GET(req("?menopause=true"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta._source).toBe("mock-fallback");
    expect(json.meta._liveAttempted).toBe(true);
    expect(Array.isArray(json.providers)).toBe(true);
  });

  it("degrades to mock-fallback on a network error and never throws", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed: ECONNREFUSED");
      })
    );

    const res = await GET(req("?menopause=true"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta._source).toBe("mock-fallback");
  });

  it("degrades to mock-fallback when the worker returns 200 with the wrong shape", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ nope: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
      )
    );

    const res = await GET(req("?menopause=true"));
    const json = await res.json();
    expect(json.meta._source).toBe("mock-fallback");
  });
});
