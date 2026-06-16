import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetSalesforceTokenCacheForTests } from "./auth";
import {
  _resetDataCloudTokenCacheForTests,
  dcInsightQuery,
  dcQuery,
  getWearableInsights,
  isDataCloudConfigured
} from "./data-cloud";

/**
 * Tests for the Phase-2 Data Cloud client.
 *
 * This is the live grounding path that production trailsignup actually runs,
 * and until now it had zero TS coverage — the module even ships a
 * `_resetDataCloudTokenCacheForTests` hook that nothing used. The load-bearing,
 * easy-to-break behaviors pinned here:
 *
 *   - The a360 two-legged token exchange. A core Salesforce token is NOT valid
 *     against the c360a tenant; it must be swapped at /services/a360/token for
 *     a Data-Cloud-scoped token (the single thing the original runbook got
 *     wrong, per PHASE_2_ACTIVATION_CHECKLIST.md). We pin the grant type, that
 *     the exchange's instance_url wins as the tenant host, caching, expiry, and
 *     graceful degradation when the exchange fails.
 *   - The CI request shape: GET /insight/calculated-insights/{name}?filters=[…].
 *   - The row → CalculatedInsight mapping, including the source-independent
 *     `kind` the Care Router now branches on — so the live path can't silently
 *     stop emitting a kind the router needs.
 *
 * The fetch mock routes by URL (core token / a360 exchange / CI / query) so
 * request ordering and Promise.all fan-out don't matter.
 */

const ENV_KEYS = [
  "SF_INSTANCE_URL",
  "SF_CLIENT_ID",
  "SF_CLIENT_SECRET",
  "SF_DC_TENANT_URL",
  "SF_API_VERSION"
] as const;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) {
    const next = values[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
}

/** The tenant host returned by the a360 exchange (authoritative). */
const EXCHANGE_TENANT = "https://dc-tenant.c360a.salesforce.com";
/** A different, explicitly-configured tenant — the exchange should win over it. */
const CONFIGURED_TENANT = "https://configured-tenant.c360a.salesforce.com";

function dcConfigEnv() {
  return {
    SF_INSTANCE_URL: "https://orgname.my.salesforce.com",
    SF_CLIENT_ID: "3MVG_fake_client_id",
    SF_CLIENT_SECRET: "fake_client_secret",
    SF_DC_TENANT_URL: CONFIGURED_TENANT
  } as const;
}

type FetchResponse = Pick<Response, "ok" | "status" | "text" | "json">;

function res(body: unknown, opts: { ok?: boolean; status?: number } = {}): FetchResponse {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    text: async () => text,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body)
  } as unknown as FetchResponse;
}

function coreTokenJson() {
  return {
    access_token: "core-token",
    instance_url: "https://orgname.my.salesforce.com",
    token_type: "Bearer",
    expires_in: 7200
  };
}

function a360TokenJson(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "dc-token",
    instance_url: EXCHANGE_TENANT,
    token_type: "Bearer",
    expires_in: 7200,
    ...overrides
  };
}

function defaultCiRows(name: string): FetchResponse {
  if (name === "Pause_HRV_RMSSD_30d__cio") {
    return res({
      data: [{ unified_id__c: "003X", hrv_rmssd_ms__c: 42, z_score__c: 1.6, window_days__c: 30 }]
    });
  }
  if (name === "Pause_Vasomotor_Burden_30d__cio") {
    return res({ data: [{ unified_id__c: "003X", burden_score_0_100__c: 71, flash_count_30d__c: 88 }] });
  }
  if (name === "Pause_Sleep_Disruption_7d__cio") {
    return res({ data: [{ unified_id__c: "003X", disruption_index_0_1__c: 0.4, disrupted_nights__c: 3 }] });
  }
  return res({ data: [] });
}

type RouteVal = FetchResponse | (() => FetchResponse);
type Routes = {
  core?: RouteVal;
  a360?: RouteVal;
  ci?: (name: string) => FetchResponse;
  query?: RouteVal;
};

function resolve(route: RouteVal | undefined, fallback: FetchResponse): FetchResponse {
  if (route === undefined) return fallback;
  return typeof route === "function" ? route() : route;
}

function installFetch(routes: Routes = {}) {
  const fetchMock = vi.fn(async (input: unknown, _init?: unknown) => {
    const url = String(input);
    if (url.endsWith("/services/oauth2/token")) return resolve(routes.core, res(coreTokenJson()));
    if (url.endsWith("/services/a360/token")) return resolve(routes.a360, res(a360TokenJson()));
    if (url.includes("/insight/calculated-insights/")) {
      const name = decodeURIComponent(url.split("/insight/calculated-insights/")[1].split("?")[0]);
      return routes.ci ? routes.ci(name) : defaultCiRows(name);
    }
    if (url.includes("/api/v1/query")) return resolve(routes.query, res({ data: [] }));
    throw new Error(`unexpected fetch to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}

function callsTo(fetchMock: ReturnType<typeof installFetch>, predicate: (url: string) => boolean) {
  return fetchMock.mock.calls.filter((c) => predicate(String(c[0])));
}

beforeEach(() => {
  _resetSalesforceTokenCacheForTests();
  _resetDataCloudTokenCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setEnv({
    SF_INSTANCE_URL: undefined,
    SF_CLIENT_ID: undefined,
    SF_CLIENT_SECRET: undefined,
    SF_DC_TENANT_URL: undefined,
    SF_API_VERSION: undefined
  });
});

describe("isDataCloudConfigured", () => {
  it("is false when Salesforce itself is not configured", () => {
    setEnv({ SF_INSTANCE_URL: undefined, SF_CLIENT_ID: undefined, SF_CLIENT_SECRET: undefined });
    expect(isDataCloudConfigured()).toBe(false);
  });

  it("is false when SF is configured but SF_DC_TENANT_URL is absent (no auto-derivation)", () => {
    setEnv({
      SF_INSTANCE_URL: "https://orgname.my.salesforce.com",
      SF_CLIENT_ID: "id",
      SF_CLIENT_SECRET: "secret",
      SF_DC_TENANT_URL: undefined
    });
    expect(isDataCloudConfigured()).toBe(false);
  });

  it("is true when SF is configured and SF_DC_TENANT_URL is set", () => {
    setEnv(dcConfigEnv());
    expect(isDataCloudConfigured()).toBe(true);
  });
});

describe("a360 token exchange", () => {
  it("swaps the core token at /services/a360/token with the CDP grant", async () => {
    setEnv(dcConfigEnv());
    const fetchMock = installFetch();

    await getWearableInsights("003X");

    const [exchange] = callsTo(fetchMock, (u) => u.endsWith("/services/a360/token"));
    expect(exchange).toBeDefined();
    expect(String(exchange[0])).toBe("https://orgname.my.salesforce.com/services/a360/token");
    const body = new URLSearchParams(String((exchange[1] as RequestInit).body));
    expect(body.get("grant_type")).toBe("urn:salesforce:grant-type:external:cdp");
    expect(body.get("subject_token")).toBe("core-token");
    expect(body.get("subject_token_type")).toBe(
      "urn:ietf:params:oauth:token-type:access_token"
    );
  });

  it("uses the exchange's instance_url as the tenant host (over SF_DC_TENANT_URL)", async () => {
    setEnv(dcConfigEnv()); // SF_DC_TENANT_URL = CONFIGURED_TENANT
    const fetchMock = installFetch(); // exchange returns EXCHANGE_TENANT

    await getWearableInsights("003X");

    const ciCalls = callsTo(fetchMock, (u) => u.includes("/insight/calculated-insights/"));
    expect(ciCalls.length).toBe(3);
    for (const c of ciCalls) {
      expect(String(c[0]).startsWith(EXCHANGE_TENANT)).toBe(true);
      expect(String(c[0]).startsWith(CONFIGURED_TENANT)).toBe(false);
    }
    // And the bearer token on the CI call is the exchanged DC token, not core.
    const headers = (ciCalls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer dc-token");
  });

  it("caches the DC token across calls (single exchange for two queries)", async () => {
    setEnv(dcConfigEnv());
    const fetchMock = installFetch();

    await getWearableInsights("003X");
    await getWearableInsights("003X");

    expect(callsTo(fetchMock, (u) => u.endsWith("/services/a360/token")).length).toBe(1);
  });

  it("re-exchanges once the DC token has expired", async () => {
    setEnv(dcConfigEnv());
    let n = 0;
    const fetchMock = installFetch({
      // First exchange: 1s lifetime → instantly expired under the 60s margin.
      a360: () => res(a360TokenJson({ expires_in: n++ === 0 ? 1 : 7200 }))
    });

    await getWearableInsights("003X");
    await getWearableInsights("003X");

    expect(callsTo(fetchMock, (u) => u.endsWith("/services/a360/token")).length).toBe(2);
  });

  it("_resetDataCloudTokenCacheForTests forces a fresh exchange", async () => {
    setEnv(dcConfigEnv());
    const fetchMock = installFetch();

    await getWearableInsights("003X");
    _resetDataCloudTokenCacheForTests();
    await getWearableInsights("003X");

    expect(callsTo(fetchMock, (u) => u.endsWith("/services/a360/token")).length).toBe(2);
  });

  it("degrades to null when the exchange fails (non-ok)", async () => {
    setEnv(dcConfigEnv());
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFetch({ a360: res("", { status: 400 }) });

    expect(await getWearableInsights("003X")).toBeNull();
  });

  it("degrades to null when the exchange omits access_token / instance_url", async () => {
    setEnv(dcConfigEnv());
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFetch({ a360: res({ instance_url: EXCHANGE_TENANT }) }); // no access_token

    expect(await getWearableInsights("003X")).toBeNull();
  });
});

describe("dcInsightQuery / dcQuery request shapes", () => {
  it("builds the CI path with a literal [field=value] filter expression", async () => {
    setEnv(dcConfigEnv());
    const fetchMock = installFetch();

    await dcInsightQuery("Pause_HRV_RMSSD_30d__cio", "[unified_id__c=003X]");

    const [ci] = callsTo(fetchMock, (u) => u.includes("/insight/calculated-insights/"));
    const url = String(ci[0]);
    expect(url.startsWith(
      `${EXCHANGE_TENANT}/api/v1/insight/calculated-insights/Pause_HRV_RMSSD_30d__cio?`
    )).toBe(true);
    expect(decodeURIComponent(url)).toContain("filters=[unified_id__c=003X]");
  });

  it("omits the filters param when no filter is given", async () => {
    setEnv(dcConfigEnv());
    const fetchMock = installFetch();

    await dcInsightQuery("Pause_HRV_RMSSD_30d__cio");

    const [ci] = callsTo(fetchMock, (u) => u.includes("/insight/calculated-insights/"));
    expect(String(ci[0])).not.toContain("filters=");
  });

  it("dcQuery POSTs the SQL to /api/v1/query", async () => {
    setEnv(dcConfigEnv());
    const fetchMock = installFetch({ query: res({ data: [{ a: 1 }] }) });

    const rows = await dcQuery("SELECT a FROM ssot__Individual__dlm LIMIT 1");

    const [q] = callsTo(fetchMock, (u) => u.includes("/api/v1/query"));
    expect((q[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((q[1] as RequestInit).body))).toEqual({
      sql: "SELECT a FROM ssot__Individual__dlm LIMIT 1"
    });
    expect(rows).toEqual([{ a: 1 }]);
  });

  it("throws (surfacing the status) when a Data Cloud call returns non-ok", async () => {
    setEnv(dcConfigEnv());
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFetch({ query: res("boom", { status: 500 }) });

    await expect(dcQuery("SELECT 1")).rejects.toThrow(/\(500\)/);
  });
});

describe("getWearableInsights", () => {
  it("returns null (and makes no network calls) when Data Cloud is unconfigured", async () => {
    setEnv({
      SF_INSTANCE_URL: "https://orgname.my.salesforce.com",
      SF_CLIENT_ID: "id",
      SF_CLIENT_SECRET: "secret",
      SF_DC_TENANT_URL: undefined
    });
    const fetchMock = installFetch();

    expect(await getWearableInsights("003X")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps CI rows to CalculatedInsights with the stable kind, id, and value", async () => {
    setEnv(dcConfigEnv());
    installFetch();

    const out = await getWearableInsights("003X");
    expect(out).not.toBeNull();

    expect(out!.hrv).toMatchObject({
      id: "insight.hrv-rmssd-30d",
      kind: "hrv-variability",
      value: 1.6
    });
    expect(out!.vasomotor).toMatchObject({
      id: "insight.vasomotor-burden-30d",
      kind: "vasomotor-burden",
      value: 71
    });
    expect(out!.sleep).toMatchObject({
      id: "insight.sleep-disruption-7d",
      kind: "sleep-disruption",
      value: 0.4
    });
  });

  it("strips brackets/commas/equals from the unified id before filtering", async () => {
    setEnv(dcConfigEnv());
    const fetchMock = installFetch();

    await getWearableInsights("00[3]X,=Y");

    const [ci] = callsTo(fetchMock, (u) => u.includes("/insight/calculated-insights/"));
    expect(decodeURIComponent(String(ci[0]))).toContain("filters=[unified_id__c=003XY]");
  });

  it("returns a per-insight null when that CI has no rows", async () => {
    setEnv(dcConfigEnv());
    installFetch({
      ci: (name) =>
        name === "Pause_Vasomotor_Burden_30d__cio" ? res({ data: [] }) : defaultCiRows(name)
    });

    const out = await getWearableInsights("003X");
    expect(out!.vasomotor).toBeNull();
    expect(out!.hrv).not.toBeNull();
    expect(out!.sleep).not.toBeNull();
  });

  it("degrades the whole call to null when any CI query errors", async () => {
    setEnv(dcConfigEnv());
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installFetch({
      ci: (name) =>
        name === "Pause_HRV_RMSSD_30d__cio" ? res("err", { status: 500 }) : defaultCiRows(name)
    });

    expect(await getWearableInsights("003X")).toBeNull();
  });
});
