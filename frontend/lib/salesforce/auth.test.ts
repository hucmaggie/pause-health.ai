import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SalesforceAuthError,
  _resetSalesforceTokenCacheForTests,
  getAccessToken,
  getSalesforceConfig,
  isSalesforceConfigured
} from "./auth";

// Tracked env vars. We snapshot at file load and restore after each test
// so a test that pokes process.env can't pollute siblings.
const ENV_KEYS = [
  "SF_INSTANCE_URL",
  "SF_CLIENT_ID",
  "SF_CLIENT_SECRET",
  "SF_API_VERSION"
] as const;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) {
    const next = values[key];
    if (next === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }
}

function realConfigEnv() {
  return {
    SF_INSTANCE_URL: "https://orgname.my.salesforce.com",
    SF_CLIENT_ID: "3MVG_fake_client_id",
    SF_CLIENT_SECRET: "fake_client_secret"
  } as const;
}

function tokenJson(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "00DHp0000fake-access-token",
    instance_url: "https://orgname.my.salesforce.com",
    token_type: "Bearer",
    expires_in: 7200,
    ...overrides
  };
}

function mockFetchOnce(responseInit: Partial<Response> & { jsonBody?: unknown; textBody?: string; ok?: boolean; status?: number }) {
  const body =
    "jsonBody" in responseInit
      ? JSON.stringify(responseInit.jsonBody)
      : (responseInit.textBody ?? "");
  const status = responseInit.status ?? 200;
  const ok = responseInit.ok ?? (status >= 200 && status < 300);
  const response = {
    ok,
    status,
    text: async () => body
  } as unknown as Response;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response));
}

beforeEach(() => {
  _resetSalesforceTokenCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Restore env to "not configured" so the next test starts clean.
  setEnv({ SF_INSTANCE_URL: undefined, SF_CLIENT_ID: undefined, SF_CLIENT_SECRET: undefined, SF_API_VERSION: undefined });
});

describe("getSalesforceConfig", () => {
  it("returns null when no SF env vars are set", () => {
    setEnv({ SF_INSTANCE_URL: undefined, SF_CLIENT_ID: undefined, SF_CLIENT_SECRET: undefined });
    expect(getSalesforceConfig()).toBeNull();
  });

  it("returns null when only some SF env vars are set", () => {
    setEnv({ SF_INSTANCE_URL: "https://x.my.salesforce.com", SF_CLIENT_ID: undefined, SF_CLIENT_SECRET: undefined });
    expect(getSalesforceConfig()).toBeNull();

    setEnv({ SF_INSTANCE_URL: "https://x.my.salesforce.com", SF_CLIENT_ID: "id", SF_CLIENT_SECRET: undefined });
    expect(getSalesforceConfig()).toBeNull();
  });

  it("treats whitespace-only env vars as unset (trimmed-empty)", () => {
    setEnv({ SF_INSTANCE_URL: "  ", SF_CLIENT_ID: "  ", SF_CLIENT_SECRET: "  " });
    expect(getSalesforceConfig()).toBeNull();
  });

  it("returns a full config when all three required vars are set", () => {
    setEnv(realConfigEnv());
    const config = getSalesforceConfig();
    expect(config).not.toBeNull();
    expect(config?.instanceUrl).toBe("https://orgname.my.salesforce.com");
    expect(config?.clientId).toBe("3MVG_fake_client_id");
    expect(config?.clientSecret).toBe("fake_client_secret");
    expect(config?.apiVersion).toBe("60.0"); // default
  });

  it("strips trailing slashes from instanceUrl", () => {
    setEnv({ ...realConfigEnv(), SF_INSTANCE_URL: "https://orgname.my.salesforce.com///" });
    expect(getSalesforceConfig()?.instanceUrl).toBe("https://orgname.my.salesforce.com");
  });

  it("honors SF_API_VERSION override", () => {
    setEnv({ ...realConfigEnv(), SF_API_VERSION: "62.0" });
    expect(getSalesforceConfig()?.apiVersion).toBe("62.0");
  });
});

describe("isSalesforceConfigured", () => {
  it("matches getSalesforceConfig() != null", () => {
    setEnv({ SF_INSTANCE_URL: undefined, SF_CLIENT_ID: undefined, SF_CLIENT_SECRET: undefined });
    expect(isSalesforceConfigured()).toBe(false);

    setEnv(realConfigEnv());
    expect(isSalesforceConfigured()).toBe(true);
  });
});

describe("getAccessToken", () => {
  it("throws SalesforceAuthError(kind=not-configured) when env vars missing", async () => {
    setEnv({ SF_INSTANCE_URL: undefined, SF_CLIENT_ID: undefined, SF_CLIENT_SECRET: undefined });
    await expect(getAccessToken()).rejects.toBeInstanceOf(SalesforceAuthError);
    try {
      await getAccessToken();
    } catch (err) {
      expect(err).toBeInstanceOf(SalesforceAuthError);
      expect((err as SalesforceAuthError).kind).toBe("not-configured");
    }
  });

  it("requests a token and returns the parsed access_token + instanceUrl on success", async () => {
    setEnv(realConfigEnv());
    mockFetchOnce({ status: 200, jsonBody: tokenJson() });

    const result = await getAccessToken();
    expect(result.accessToken).toBe("00DHp0000fake-access-token");
    expect(result.instanceUrl).toBe("https://orgname.my.salesforce.com");
    expect(result.apiVersion).toBe("60.0");
  });

  it("uses the cached token on a second call (no second fetch)", async () => {
    setEnv(realConfigEnv());
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(tokenJson())
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const a = await getAccessToken();
    const b = await getAccessToken();
    expect(a.accessToken).toBe(b.accessToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent in-flight token requests (single fetch for parallel callers)", async () => {
    setEnv(realConfigEnv());
    // Slow-resolve fetch so both callers are in flight at the same time.
    let resolveFetch: (r: Response) => void = () => undefined;
    const slowResponse = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(slowResponse);
    vi.stubGlobal("fetch", fetchMock);

    const p1 = getAccessToken();
    const p2 = getAccessToken();
    // Give both calls a chance to register their .then handlers.
    await Promise.resolve();

    resolveFetch({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(tokenJson())
    } as unknown as Response);

    const [a, b] = await Promise.all([p1, p2]);
    expect(a.accessToken).toBe(b.accessToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-requests when the cached token has expired", async () => {
    setEnv(realConfigEnv());
    // Issue a token with a very short lifetime (1 second). The auth
    // helper applies a 60s safety margin, so any expires_in < 60s will
    // immediately appear expired on the next call.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(tokenJson({ access_token: "token-A", expires_in: 1 }))
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(tokenJson({ access_token: "token-B", expires_in: 7200 }))
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const a = await getAccessToken();
    const b = await getAccessToken();
    expect(a.accessToken).toBe("token-A");
    expect(b.accessToken).toBe("token-B");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws SalesforceAuthError(kind=token-request-failed) on HTTP error from Salesforce", async () => {
    setEnv(realConfigEnv());
    mockFetchOnce({
      status: 400,
      textBody: JSON.stringify({ error: "invalid_client_id", error_description: "client identifier invalid" })
    });

    try {
      await getAccessToken();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SalesforceAuthError);
      const e = err as SalesforceAuthError;
      expect(e.kind).toBe("token-request-failed");
      expect(e.status).toBe(400);
      expect(e.bodyExcerpt).toContain("invalid_client_id");
    }
  });

  it("throws SalesforceAuthError(kind=token-request-failed) on network/fetch failure", async () => {
    setEnv(realConfigEnv());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new TypeError("fetch failed: connect ECONNREFUSED"))
    );

    try {
      await getAccessToken();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SalesforceAuthError);
      const e = err as SalesforceAuthError;
      expect(e.kind).toBe("token-request-failed");
      expect(e.message).toContain("Network error");
    }
  });

  it("throws SalesforceAuthError(kind=invalid-response) when token endpoint returns non-JSON", async () => {
    setEnv(realConfigEnv());
    mockFetchOnce({ status: 200, textBody: "<html>not json</html>" });

    try {
      await getAccessToken();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SalesforceAuthError);
      const e = err as SalesforceAuthError;
      expect(e.kind).toBe("invalid-response");
      expect(e.bodyExcerpt).toContain("not json");
    }
  });

  it("throws SalesforceAuthError(kind=invalid-response) when access_token field is missing", async () => {
    setEnv(realConfigEnv());
    mockFetchOnce({
      status: 200,
      jsonBody: { instance_url: "https://x.my.salesforce.com", token_type: "Bearer", expires_in: 7200 }
    });

    try {
      await getAccessToken();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SalesforceAuthError);
      const e = err as SalesforceAuthError;
      expect(e.kind).toBe("invalid-response");
      expect(e.message).toContain("access_token");
    }
  });

  it("prefers instance_url from the token response over the env var", async () => {
    setEnv({ ...realConfigEnv(), SF_INSTANCE_URL: "https://login-portal.my.salesforce.com" });
    mockFetchOnce({
      status: 200,
      jsonBody: tokenJson({ instance_url: "https://orgname-prod.my.salesforce.com" })
    });

    const result = await getAccessToken();
    expect(result.instanceUrl).toBe("https://orgname-prod.my.salesforce.com");
  });
});
