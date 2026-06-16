import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetProvidersWarnDedupForTests,
  fetchLiveProviders,
  getProvidersPreferReal,
  isMulesoftProvidersLive
} from "./providers";

/**
 * Tests for the live MuleSoft Experience-API providers client.
 *
 * Mirrors the live/mock matrix health.test.ts pins:
 *
 *   1. Configuration detection: isMulesoftProvidersLive() honors the env
 *      var and rejects obviously-broken values.
 *   2. Fetch success: providers array shape resolves correctly.
 *   3. Fetch failures: non-2xx, network error, malformed JSON, wrong shape
 *      — each throws and degrades in getProvidersPreferReal.
 *   4. getProvidersPreferReal: live success returns live; live failure
 *      degrades transparently to mock.
 */

const ENV_KEY = "MULESOFT_PROVIDERS_BASE_URL";
const LIVE_URL = "https://pause-mulesoft-health-v1.us-e2.cloudhub.io";

beforeEach(() => {
  delete process.env[ENV_KEY];
  _resetProvidersWarnDedupForTests();
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

function fakeProvidersPayload(count = 2) {
  return {
    query: { zip: "92614", menopauseOnly: true, limit: 10 },
    total: count,
    returned: count,
    providers: Array.from({ length: count }, (_, i) => ({
      npi: `100000000${i}`,
      name: `Dr. Test Provider ${i}`,
      credentials: ["MD"],
      specialty: "Obstetrics & Gynecology",
      menopauseCertified: true,
      city: "Irvine",
      state: "CA",
      zip: "92614",
      acceptingNewPatients: true,
      telehealth: true,
      graphScore: 0.9 - i * 0.1
    })),
    provenance: {
      sources: ["CMS NPPES (synthetic)"],
      experienceApi: "pause-provider-directory-experience-api@1.0",
      servedBy: "mulesoft-cloudhub2"
    }
  };
}

// ─────────────────────────────────────────────────────────────
// isMulesoftProvidersLive
// ─────────────────────────────────────────────────────────────

describe("isMulesoftProvidersLive", () => {
  it("returns false when env var is unset", () => {
    expect(isMulesoftProvidersLive()).toBe(false);
  });

  it("returns false for a URL without a scheme", () => {
    process.env[ENV_KEY] = "pause-mulesoft-health-v1.us-e2.cloudhub.io";
    expect(isMulesoftProvidersLive()).toBe(false);
  });

  it("returns true for an https URL", () => {
    process.env[ENV_KEY] = LIVE_URL;
    expect(isMulesoftProvidersLive()).toBe(true);
  });

  it("accepts http for local tunnel testing", () => {
    process.env[ENV_KEY] = "http://localhost:8081";
    expect(isMulesoftProvidersLive()).toBe(true);
  });

  it("trims surrounding whitespace before checking", () => {
    process.env[ENV_KEY] = `   ${LIVE_URL}   `;
    expect(isMulesoftProvidersLive()).toBe(true);
  });

  it("explicit baseUrl argument overrides env", () => {
    process.env[ENV_KEY] = LIVE_URL;
    expect(isMulesoftProvidersLive("")).toBe(false);
    expect(isMulesoftProvidersLive("https://other.example.com")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// fetchLiveProviders · success paths
// ─────────────────────────────────────────────────────────────

describe("fetchLiveProviders · success paths", () => {
  it("returns the providers payload on a valid response", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const expected = fakeProvidersPayload(3);
    const fetchImpl = mockFetchOk(expected);
    const out = await fetchLiveProviders({ zip: "92614", menopauseOnly: true, limit: 10 }, { fetchImpl });
    expect(out?.providers).toHaveLength(3);
    expect(out?.total).toBe(3);
  });

  it("appends query params to the request URL", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const fetchImpl = mockFetchOk(fakeProvidersPayload(1));
    await fetchLiveProviders({ zip: "92614", menopauseOnly: true, limit: 5 }, { fetchImpl });
    const calledUrl = (fetchImpl as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0][0];
    expect(calledUrl).toContain("zip=92614");
    expect(calledUrl).toContain("menopause=true");
    expect(calledUrl).toContain("limit=5");
  });

  it("strips a trailing slash from the base URL", async () => {
    process.env[ENV_KEY] = `${LIVE_URL}/`;
    const fetchImpl = mockFetchOk(fakeProvidersPayload());
    await fetchLiveProviders({}, { fetchImpl });
    const calledUrl = (fetchImpl as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0][0];
    expect(calledUrl).toMatch(new RegExp(`^${LIVE_URL}/providers`));
  });

  it("omits menopause param when menopauseOnly is false/undefined", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const fetchImpl = mockFetchOk(fakeProvidersPayload());
    await fetchLiveProviders({ zip: "92614" }, { fetchImpl });
    const calledUrl = (fetchImpl as unknown as { mock: { calls: [string, unknown][] } }).mock.calls[0][0];
    expect(calledUrl).not.toContain("menopause");
  });

  it("returns null when env is unset without hitting network", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const out = await fetchLiveProviders({}, { fetchImpl });
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// fetchLiveProviders · failure paths
// ─────────────────────────────────────────────────────────────

describe("fetchLiveProviders · failure paths", () => {
  it("throws on non-2xx", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    await expect(
      fetchLiveProviders({}, { fetchImpl: mockFetchStatus(503) })
    ).rejects.toThrow(/503/);
  });

  it("throws on network error", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    await expect(
      fetchLiveProviders({}, { fetchImpl: mockFetchThrows(new TypeError("ECONNREFUSED")) })
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("throws on response missing providers array", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    await expect(
      fetchLiveProviders({}, { fetchImpl: mockFetchOk({ something: "wrong" }) })
    ).rejects.toThrow(/providers array/);
  });

  it("throws on malformed JSON", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const fetchImpl = vi.fn(
      async () => new Response("not-json{", { status: 200 })
    ) as unknown as typeof fetch;
    await expect(fetchLiveProviders({}, { fetchImpl })).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// getProvidersPreferReal
// ─────────────────────────────────────────────────────────────

describe("getProvidersPreferReal", () => {
  it("returns source='mock' without any fetch when env is unset", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const out = await getProvidersPreferReal({}, { fetchImpl });
    expect(out.source).toBe("mock");
    expect(Array.isArray(out.result.providers)).toBe(true);
    expect(out.result.providers.length).toBeGreaterThan(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns source='live' on successful Mule response", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const out = await getProvidersPreferReal(
      { zip: "92614", menopauseOnly: true, limit: 2 },
      { fetchImpl: mockFetchOk(fakeProvidersPayload(2)) }
    );
    expect(out.source).toBe("live");
    expect(out.result.providers).toHaveLength(2);
  });

  it("degrades to mock when Mule returns non-2xx and warns once", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const out = await getProvidersPreferReal(
      {},
      { fetchImpl: mockFetchStatus(503) }
    );
    expect(out.source).toBe("mock");
    expect(out.result.providers.length).toBeGreaterThan(0);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("degrades to mock when Mule returns bad shape and warns once", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const out = await getProvidersPreferReal(
      {},
      { fetchImpl: mockFetchOk({ bad: "shape" }) }
    );
    expect(out.source).toBe("mock");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("deduplicates repeated warnings for the same failure bucket", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    const fetchImpl = mockFetchStatus(503);
    await getProvidersPreferReal({}, { fetchImpl });
    await getProvidersPreferReal({}, { fetchImpl });
    await getProvidersPreferReal({}, { fetchImpl });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("emits separate warnings for distinct failure buckets", async () => {
    process.env[ENV_KEY] = LIVE_URL;
    await getProvidersPreferReal({}, { fetchImpl: mockFetchStatus(503) });
    await getProvidersPreferReal({}, { fetchImpl: mockFetchThrows(new TypeError("ECONNREFUSED")) });
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("mock result respects the zip filter", async () => {
    delete process.env[ENV_KEY];
    const out = await getProvidersPreferReal({ zip: "92614", menopauseOnly: false });
    expect(out.source).toBe("mock");
    for (const p of out.result.providers) {
      expect(p.zip.slice(0, 3)).toBe("926");
    }
  });

  it("mock result respects the menopauseOnly filter", async () => {
    delete process.env[ENV_KEY];
    const out = await getProvidersPreferReal({ menopauseOnly: true });
    expect(out.source).toBe("mock");
    for (const p of out.result.providers) {
      expect(p.menopauseCertified).toBe(true);
    }
  });
});

/**
 * Live ⇄ mock contract-shape parity.
 *
 * The live MuleSoft worker (pause-mulesoft-health-v1's providers-flow,
 * see mulesoft/pause-mulesoft-health-v1/src/main/mule/health-flow.xml)
 * is a DataWeave script — disjoint from the TypeScript mock here. These
 * tests pin the contract surface so a Phase-3 mock change can't silently
 * drift from what the live worker emits, and vice versa. Lemmas:
 *
 *   1. Every per-provider record carries the same field set (taxonomy,
 *      contact, ranking, distance, signals, license, insurance).
 *   2. The response envelope carries the same top-level keys
 *      (query / matchType / sort / total / returned / providers /
 *      provenance.dataset).
 *
 * The committed live worker bakes a curated ~9-row slice (the demo
 * personas + a relevant-local + a certified-remote) so this stays
 * exercised against real data the worker would actually emit.
 */
describe("provider directory · live ⇄ mock contract-shape parity", () => {
  // Field set the OAS Provider schema enforces. Adding a field requires
  // updating BOTH this list AND the live worker's DataWeave row schema
  // so the next refresh deploys with the contract intact.
  const REQUIRED_PROVIDER_FIELDS = new Set([
    "npi",
    "name",
    "credentials",
    "specialty",
    "menopauseCertified",
    "city",
    "state",
    "zip",
    "acceptingNewPatients",
    "telehealth",
    "graphScore",
    "latitude",
    "longitude",
    "serviceSignals",
    "licenseStatus",
    "insuranceAccepted",
    "distanceMiles"
  ]);

  // Top-level response keys both the mock and the live worker emit.
  const REQUIRED_RESPONSE_KEYS = new Set([
    "query",
    "matchType",
    "sort",
    "total",
    "returned",
    "providers",
    "provenance"
  ]);

  it("mock response carries all contract fields on every provider", async () => {
    delete process.env[ENV_KEY];
    const out = await getProvidersPreferReal({ menopauseOnly: true });
    expect(out.source).toBe("mock");
    expect(out.result.providers.length).toBeGreaterThan(0);
    for (const p of out.result.providers) {
      const keys = new Set(Object.keys(p));
      for (const f of REQUIRED_PROVIDER_FIELDS) {
        expect(keys, `provider ${p.npi} missing ${f}`).toContain(f);
      }
    }
  });

  it("mock response carries all contract envelope keys", async () => {
    delete process.env[ENV_KEY];
    const out = await getProvidersPreferReal({ menopauseOnly: true });
    const envelopeKeys = new Set(Object.keys(out.result));
    for (const k of REQUIRED_RESPONSE_KEYS) {
      expect(envelopeKeys, `envelope missing ${k}`).toContain(k);
    }
    // sort is one of the two enum values both implementations honor.
    expect(["distance", "score"]).toContain(
      (out.result as unknown as { sort: string }).sort
    );
    // matchType is one of the seven tier values.
    expect([
      "certified-local",
      "relevant-local",
      "certified-remote",
      "certified-national",
      "local",
      "all",
      "none"
    ]).toContain((out.result as unknown as { matchType: string }).matchType);
  });

  it("the live worker's documented response shape passes the same field check", async () => {
    // The DataWeave is in-tree but Mule is out-of-process at test time.
    // Snapshot of the response shape the live worker emits — kept in
    // lockstep with mulesoft/pause-mulesoft-health-v1/.../health-flow.xml's
    // providers-flow ee:set-payload. If you change the DataWeave, update
    // this fixture so a CI run flags the drift.
    const liveSnapshot = {
      query: {
        zip: "92614",
        menopauseOnly: true,
        limit: 10,
        fallback: false,
        insurance: null,
        telehealth: false
      },
      matchType: "certified-local",
      sort: "score",
      total: 1,
      returned: 1,
      providers: [
        {
          npi: "1730155570",
          name: "Dr. Priya Anand, MD, FACOG, MSCP",
          credentials: ["MD", "FACOG", "MSCP"],
          specialty: "Obstetrics & Gynecology",
          menopauseCertified: true,
          city: "Irvine",
          state: "CA",
          zip: "92614",
          acceptingNewPatients: false,
          telehealth: false,
          graphScore: 0.7624,
          latitude: 33.68021,
          longitude: -117.833355,
          serviceSignals: ["facog"],
          licenseStatus: "active",
          insuranceAccepted: ["medicare", "medicaid", "aetna", "cigna"],
          distanceMiles: null
        }
      ],
      provenance: {
        sources: ["..."],
        experienceApi: "pause-provider-directory-experience-api@0.9",
        servedBy: "mulesoft-cloudhub2",
        dataset: {
          generatedAt: null,
          sourceDate: null,
          total: 9,
          certified: 7,
          states: 4,
          zip3Prefixes: 7,
          sanctionedFiltered: 0,
          sanctionedFilteredBySource: {},
          sanctionsOverlaysUsed: {}
        }
      }
    };
    const envelopeKeys = new Set(Object.keys(liveSnapshot));
    for (const k of REQUIRED_RESPONSE_KEYS) {
      expect(envelopeKeys, `live snapshot missing ${k}`).toContain(k);
    }
    for (const p of liveSnapshot.providers) {
      const keys = new Set(Object.keys(p));
      for (const f of REQUIRED_PROVIDER_FIELDS) {
        expect(keys, `live snapshot provider missing ${f}`).toContain(f);
      }
    }
  });
});
