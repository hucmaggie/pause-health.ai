import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { DEMO_DATA360_PATIENT_ID } from "../../../../../../lib/data-360";
import { _resetSalesforceTokenCacheForTests } from "../../../../../../lib/salesforce/auth";
import { _resetSalesforceWarnDedupForTests } from "../../../../../../lib/salesforce/grounding";

/**
 * Tests for GET /api/data-360/patient/{id}/grounding — the dual-mode
 * federated grounding read the Care Router consumes before deciding.
 *
 * Two paths matter:
 *   - MOCK (default: SF_* unset). Reports _source:"mock",
 *     _salesforceConfigured:false, and a cacheable header.
 *   - REAL→MOCK FALLBACK (SF_* set but the org call fails). The route must
 *     NOT 500: getGroundingContextPreferReal catches and degrades to the
 *     mock, so we still get _source:"mock" — but _salesforceConfigured
 *     reports true (it reflects env, not the served source) and the cache
 *     header follows the SOURCE, not the config.
 */

const SF_KEYS = ["SF_INSTANCE_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET"] as const;
const originalEnv: Record<string, string | undefined> = {};

function call(id: string, query = "") {
  return GET(
    new Request(
      `https://pause-health.ai/api/data-360/patient/${id}/grounding${query}`
    ),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  for (const k of SF_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  _resetSalesforceTokenCacheForTests();
  _resetSalesforceWarnDedupForTests();
});

afterEach(() => {
  for (const k of SF_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  vi.unstubAllGlobals();
  _resetSalesforceTokenCacheForTests();
  _resetSalesforceWarnDedupForTests();
});

describe("GET /api/data-360/patient/[id]/grounding — mock path (SF unset)", () => {
  it("returns 200 with mock-sourced grounding", async () => {
    const res = await call(DEMO_DATA360_PATIENT_ID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta._source).toBe("mock");
    expect(json.meta._salesforceConfigured).toBe(false);
    expect(json.meta._note).toMatch(/mock/i);
    expect(json.grounding.unifiedPatientId).toBeTruthy();
    expect(Array.isArray(json.grounding.calculatedInsights)).toBe(true);
  });

  it("stamps the requested and demo patient ids in meta", async () => {
    const json = await (await call("patient-q")).json();
    expect(json.meta._requestedPatientId).toBe("patient-q");
    expect(json.meta._demoPatientId).toBe(DEMO_DATA360_PATIENT_ID);
  });

  it("emits a cacheable header for the deterministic mock", async () => {
    const res = await call(DEMO_DATA360_PATIENT_ID);
    expect(res.headers.get("cache-control")).toMatch(/public/);
    expect(res.headers.get("cache-control")).toMatch(/s-maxage=60/);
  });
});

describe("GET /api/data-360/patient/[id]/grounding — real→mock fallback", () => {
  beforeEach(() => {
    process.env.SF_INSTANCE_URL = "https://example.my.salesforce.com";
    process.env.SF_CLIENT_ID = "cid";
    process.env.SF_CLIENT_SECRET = "secret";
    // Simulate the org being reachable-in-config but the call failing
    // (token endpoint down / network error). preferReal must swallow this.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("simulated salesforce outage");
      })
    );
  });

  it("degrades to the mock instead of 500ing when the org call throws", async () => {
    const res = await call(DEMO_DATA360_PATIENT_ID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta._source).toBe("mock");
    // _salesforceConfigured reflects env (true), NOT the served source.
    expect(json.meta._salesforceConfigured).toBe(true);
  });

  it("keeps the cacheable header (it follows source=mock, not config)", async () => {
    const res = await call(DEMO_DATA360_PATIENT_ID);
    expect(res.headers.get("cache-control")).toMatch(/public/);
    expect(res.headers.get("cache-control")).not.toMatch(/no-store/);
  });
});
