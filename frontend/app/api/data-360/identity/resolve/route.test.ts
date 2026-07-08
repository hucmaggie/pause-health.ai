import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { DEMO_DATA360_PATIENT_ID } from "../../../../../lib/data-360";
import { _resetSalesforceTokenCacheForTests } from "../../../../../lib/salesforce/auth";
import { _resetSalesforceWarnDedupForTests } from "../../../../../lib/salesforce/grounding";

/**
 * Tests for POST /api/data-360/identity/resolve — dual-mode identity
 * resolution. Covers the JSON guard, the default mock resolution, and the
 * real→mock fallback (SF_* set but the org call throws): the route must
 * degrade to the mock rather than 500, while still reporting
 * _salesforceConfigured:true.
 */

const SF_KEYS = ["SF_INSTANCE_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET"] as const;
const originalEnv: Record<string, string | undefined> = {};

function post(body: unknown | string) {
  const init: RequestInit = { method: "POST" };
  init.body = typeof body === "string" ? body : JSON.stringify(body);
  return POST(
    new Request("https://pause-health.ai/api/data-360/identity/resolve", init)
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

describe("POST /api/data-360/identity/resolve", () => {
  it("returns 400 on invalid JSON", async () => {
    const res = await post("{ not json");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid json/i);
  });

  it("resolves to the mock demo id when SF is unconfigured", async () => {
    const res = await post({ preferredName: "Jane", ageBand: "46-50" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta._source).toBe("mock");
    expect(json.meta._salesforceConfigured).toBe(false);
    expect(json.resolution.unifiedPatientId).toBe(DEMO_DATA360_PATIENT_ID);
    expect(json.resolution.confidence).toBe(0.97);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("degrades to the mock (not 500) when the org call throws", async () => {
    process.env.SF_INSTANCE_URL = "https://example.my.salesforce.com";
    process.env.SF_CLIENT_ID = "cid";
    process.env.SF_CLIENT_SECRET = "secret";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("simulated salesforce outage");
      })
    );

    const res = await post({ preferredName: "Jane" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta._source).toBe("mock");
    // Reflects env, not the served source.
    expect(json.meta._salesforceConfigured).toBe(true);
    expect(json.resolution.unifiedPatientId).toBe(DEMO_DATA360_PATIENT_ID);
  });
});
