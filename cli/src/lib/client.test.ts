import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callExperienceApi } from "./client";

const FAKE_OK = {
  ok: true,
  status: 200,
  statusText: "OK",
  json: async () => ({ meta: { _source: "live-mulesoft" } }),
  text: async () => ""
} as unknown as Response;

describe("callExperienceApi", () => {
  const ORIGINAL = process.env.PAUSE_API_KEY;
  beforeEach(() => delete process.env.PAUSE_API_KEY);
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PAUSE_API_KEY;
    else process.env.PAUSE_API_KEY = ORIGINAL;
  });

  it("issues a GET with Accept + User-Agent and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(FAKE_OK);
    const out = await callExperienceApi({
      baseUrl: "https://pause-health.ai",
      path: "/api/mulesoft/health",
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    expect(out).toEqual({ meta: { _source: "live-mulesoft" } });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pause-health.ai/api/mulesoft/health");
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/json");
    expect(headers["User-Agent"]).toBe("@pause-health/cli");
    expect(headers.Authorization).toBeUndefined();
  });

  it("attaches Authorization when PAUSE_API_KEY is set", async () => {
    process.env.PAUSE_API_KEY = "sf-token-123";
    const fetchMock = vi.fn().mockResolvedValue(FAKE_OK);
    await callExperienceApi({
      baseUrl: "https://pause-health.ai",
      path: "/api/mulesoft/health",
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sf-token-123"
    );
  });

  it("apiKey option overrides the env var", async () => {
    process.env.PAUSE_API_KEY = "from-env";
    const fetchMock = vi.fn().mockResolvedValue(FAKE_OK);
    await callExperienceApi({
      baseUrl: "https://pause-health.ai",
      path: "/api/mulesoft/health",
      apiKey: "from-opt",
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer from-opt"
    );
  });

  it("strips trailing slashes from baseUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue(FAKE_OK);
    await callExperienceApi({
      baseUrl: "https://pause-health.ai///",
      path: "/api/mulesoft/health",
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pause-health.ai/api/mulesoft/health");
  });

  it("throws on non-2xx with status + body hint", async () => {
    const badResp = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
      text: async () => "upstream timeout"
    } as unknown as Response;
    const fetchMock = vi.fn().mockResolvedValue(badResp);
    await expect(
      callExperienceApi({
        baseUrl: "https://pause-health.ai",
        path: "/api/mulesoft/health",
        fetchImpl: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow(
      /GET \/api\/mulesoft\/health → HTTP 500 Internal Server Error — upstream timeout/
    );
  });
});
