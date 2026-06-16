import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetMulesoftTokenCacheForTests,
  buildMulesoftAuthHeaders,
  getMulesoftBearerToken
} from "./auth";

/**
 * Auth0 M2M bearer-token client for the live MuleSoft Experience API.
 *
 * Bearer-JWT is the only live auth scheme (JWT Validation replaced Client ID
 * Enforcement on 2026-06-09). These tests pin the token mint/cache/failure
 * behavior and the header shape both Experience-API clients now share via
 * buildMulesoftAuthHeaders().
 */

const KEYS = [
  "AUTH0_MULESOFT_CLIENT_ID",
  "AUTH0_MULESOFT_CLIENT_SECRET",
  "AUTH0_MULESOFT_DOMAIN",
  "AUTH0_MULESOFT_AUDIENCE"
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  _resetMulesoftTokenCacheForTests();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setAuth0() {
  process.env.AUTH0_MULESOFT_CLIENT_ID = "cid";
  process.env.AUTH0_MULESOFT_CLIENT_SECRET = "secret";
  process.env.AUTH0_MULESOFT_DOMAIN = "pause.us.auth0.com";
  process.env.AUTH0_MULESOFT_AUDIENCE = "https://pause-mulesoft/api";
}

function stubTokenFetch(body: unknown, status = 200) {
  const spy = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" }
      })
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("getMulesoftBearerToken", () => {
  it("returns null and makes NO network call when Auth0 is not configured", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await getMulesoftBearerToken()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null if only some Auth0 vars are set", async () => {
    process.env.AUTH0_MULESOFT_CLIENT_ID = "cid";
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await getMulesoftBearerToken()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("mints a token via the Auth0 client-credentials grant", async () => {
    setAuth0();
    const spy = stubTokenFetch({ access_token: "tok-123", expires_in: 3600 });

    const token = await getMulesoftBearerToken();
    expect(token).toBe("tok-123");
    expect(spy).toHaveBeenCalledTimes(1);

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://pause.us.auth0.com/oauth/token");
    const sentBody = JSON.parse(init!.body as string);
    expect(sentBody).toMatchObject({
      client_id: "cid",
      client_secret: "secret",
      audience: "https://pause-mulesoft/api",
      grant_type: "client_credentials"
    });
  });

  it("caches the token so a second call does not re-hit Auth0", async () => {
    setAuth0();
    const spy = stubTokenFetch({ access_token: "tok-cached", expires_in: 3600 });

    expect(await getMulesoftBearerToken()).toBe("tok-cached");
    expect(await getMulesoftBearerToken()).toBe("tok-cached");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns null when Auth0 responds non-2xx", async () => {
    setAuth0();
    stubTokenFetch({ error: "access_denied" }, 401);
    expect(await getMulesoftBearerToken()).toBeNull();
  });

  it("returns null when the Auth0 response has no access_token", async () => {
    setAuth0();
    stubTokenFetch({ token_type: "Bearer" });
    expect(await getMulesoftBearerToken()).toBeNull();
  });
});

describe("buildMulesoftAuthHeaders", () => {
  it("returns an empty object when Auth0 is not configured (no auth header)", async () => {
    expect(await buildMulesoftAuthHeaders()).toEqual({});
  });

  it("returns a Bearer Authorization header when a token is available", async () => {
    setAuth0();
    stubTokenFetch({ access_token: "tok-xyz", expires_in: 3600 });
    expect(await buildMulesoftAuthHeaders()).toEqual({
      Authorization: "Bearer tok-xyz"
    });
  });

  it("never produces a Basic / client_id header (retired Client ID Enforcement)", async () => {
    // Even with the legacy MULESOFT_CLIENT_ID present, the live clients must
    // only ever speak Bearer-JWT now.
    process.env.MULESOFT_CLIENT_ID = "legacy";
    process.env.MULESOFT_CLIENT_SECRET = "legacy-secret";
    const headers = await buildMulesoftAuthHeaders();
    expect(headers.Authorization).toBeUndefined();
    expect(headers).not.toHaveProperty("client_id");
    delete process.env.MULESOFT_CLIENT_ID;
    delete process.env.MULESOFT_CLIENT_SECRET;
  });
});
