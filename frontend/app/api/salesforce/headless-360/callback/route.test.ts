import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

import { GET } from "./route";
import {
  PENDING_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  getHeadless360Config,
  parseSession,
  serializePending,
  signCookieValue,
  verifyCookieValue,
  type Headless360Config
} from "../../../../../lib/salesforce-headless360";

/**
 * GET /api/salesforce/headless-360/callback — the OAuth redirect handler.
 *
 * The security core: the returned `state` MUST match the state bound into
 * the signed pending cookie at /authorize (CSRF defense), the pending cookie
 * MUST verify (tamper defense), and a tampered post-login path MUST NOT open
 * a redirect. The token exchange itself hits global fetch, which we stub.
 */

const KEYS = [
  "SF_HEADLESS360_CLIENT_ID",
  "SF_HEADLESS360_AUTH_BASE_URL",
  "SF_HEADLESS360_REDIRECT_URI",
  "SF_HEADLESS360_SESSION_SECRET"
] as const;
const ORIGINAL = { ...process.env };

function clearEnv() {
  for (const k of KEYS) delete process.env[k];
}
function fullyProvisioned() {
  process.env.SF_HEADLESS360_CLIENT_ID = "3MVG9_test_client_id";
  process.env.SF_HEADLESS360_AUTH_BASE_URL = "https://test.my.salesforce.com";
  process.env.SF_HEADLESS360_REDIRECT_URI =
    "https://pause-health.ai/api/salesforce/headless-360/callback";
  process.env.SF_HEADLESS360_SESSION_SECRET = randomBytes(32).toString("hex");
}
function cfg(): Headless360Config {
  const c = getHeadless360Config();
  if (!c) throw new Error("test setup: expected provisioned config");
  return c;
}

beforeEach(() => clearEnv());
afterEach(() => {
  vi.unstubAllGlobals();
  Object.keys(process.env).forEach((k) => {
    if (!(k in ORIGINAL)) delete process.env[k];
  });
  Object.assign(process.env, ORIGINAL);
});

function signedPending(
  c: Headless360Config,
  pending: { state: string; codeVerifier: string; postLoginPath: string }
) {
  return signCookieValue(serializePending(pending), c.sessionSecret);
}

function callbackReq(opts: {
  code?: string;
  state?: string;
  error?: string;
  cookie?: string;
}) {
  const u = new URL("https://pause-health.ai/api/salesforce/headless-360/callback");
  if (opts.code) u.searchParams.set("code", opts.code);
  if (opts.state) u.searchParams.set("state", opts.state);
  if (opts.error) u.searchParams.set("error", opts.error);
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = `${PENDING_COOKIE_NAME}=${opts.cookie}`;
  return new Request(u.toString(), { headers });
}

function stubTokenResponse(body: unknown, status = 200, statusText = "OK") {
  const spy = vi.fn(
    async () => new Response(JSON.stringify(body), { status, statusText })
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("GET /callback · guards", () => {
  it("returns 503 when unprovisioned", async () => {
    const res = await GET(callbackReq({ code: "c", state: "s" }));
    expect(res.status).toBe(503);
  });

  it("propagates a Salesforce ?error and clears the pending cookie (400)", async () => {
    fullyProvisioned();
    const res = await GET(callbackReq({ error: "access_denied" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("authorization-failed");
    expect(json.upstream_error).toBe("access_denied");
    expect(res.headers.get("Set-Cookie")).toContain(`${PENDING_COOKIE_NAME}=;`);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("returns 400 when code or state is missing", async () => {
    fullyProvisioned();
    const res = await GET(callbackReq({ code: "c" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing-code-or-state");
  });

  it("returns 400 when the pending cookie is absent", async () => {
    fullyProvisioned();
    const res = await GET(callbackReq({ code: "c", state: "s" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing-pending-cookie");
  });

  it("returns 400 when the pending cookie is tampered", async () => {
    fullyProvisioned();
    const good = signedPending(cfg(), {
      state: "state-123",
      codeVerifier: "verifier",
      postLoginPath: "/"
    });
    // Flip a character in the payload so the HMAC no longer verifies.
    const tampered = good[0] === "A" ? `B${good.slice(1)}` : `A${good.slice(1)}`;
    const res = await GET(
      callbackReq({ code: "c", state: "state-123", cookie: tampered })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing-pending-cookie");
  });

  it("returns 400 state-mismatch when the returned state != the cookie state (CSRF)", async () => {
    fullyProvisioned();
    const spy = stubTokenResponse({ access_token: "x", instance_url: "y" });
    const cookie = signedPending(cfg(), {
      state: "cookie-state",
      codeVerifier: "verifier",
      postLoginPath: "/"
    });
    const res = await GET(
      callbackReq({ code: "c", state: "attacker-state", cookie })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("state-mismatch");
    // The token endpoint must NOT be contacted on a CSRF-failed callback.
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("GET /callback · token exchange", () => {
  it("exchanges the code, sets a session cookie, clears pending, and 302s to the post-login path", async () => {
    fullyProvisioned();
    const spy = stubTokenResponse({
      access_token: "00Dxx!ATOKEN",
      refresh_token: "5Aep!REFRESH",
      instance_url: "https://test.my.salesforce.com/",
      expires_in: "7200",
      id: "https://login.salesforce.com/id/00D/005"
    });
    const cookie = signedPending(cfg(), {
      state: "match",
      codeVerifier: "verifier-abc",
      postLoginPath: "/proposal/headless-360"
    });
    const res = await GET(
      callbackReq({ code: "auth-code", state: "match", cookie })
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/proposal/headless-360");

    // The code_verifier from the cookie is presented on exchange.
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("code=auth-code");
    expect(String(init.body)).toContain("code_verifier=verifier-abc");

    const cookies = res.headers.getSetCookie();
    const sessionCookie = cookies.find((c) => c.startsWith(SESSION_COOKIE_NAME));
    const clearPending = cookies.find((c) => c.startsWith(PENDING_COOKIE_NAME));
    expect(sessionCookie).toBeTruthy();
    expect(clearPending).toContain("Max-Age=0");

    // The session cookie decodes to the exchanged tokens.
    const rawVal = sessionCookie!.slice(SESSION_COOKIE_NAME.length + 1).split(";")[0];
    const session = parseSession(verifyCookieValue(rawVal, cfg().sessionSecret));
    expect(session!.accessToken).toBe("00Dxx!ATOKEN");
    expect(session!.refreshToken).toBe("5Aep!REFRESH");
    expect(session!.instanceUrl).toBe("https://test.my.salesforce.com");
  });

  it("does not honor a tampered absolute post-login path (defense in depth → '/')", async () => {
    fullyProvisioned();
    stubTokenResponse({ access_token: "t", instance_url: "https://x" });
    // A signed cookie whose postLoginPath is protocol-relative. It verifies
    // (we sign it), but the callback must still refuse to redirect off-site.
    const cookie = signedPending(cfg(), {
      state: "s",
      codeVerifier: "v",
      postLoginPath: "//evil.example/steal"
    });
    const res = await GET(callbackReq({ code: "c", state: "s", cookie }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("returns 502 when Salesforce rejects the token exchange", async () => {
    fullyProvisioned();
    stubTokenResponse({ error: "invalid_grant" }, 400, "Bad Request");
    const cookie = signedPending(cfg(), {
      state: "s",
      codeVerifier: "v",
      postLoginPath: "/"
    });
    const res = await GET(callbackReq({ code: "c", state: "s", cookie }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("token-exchange-failed");
  });

  it("returns 502 when the token response omits access_token", async () => {
    fullyProvisioned();
    stubTokenResponse({ instance_url: "https://x" });
    const cookie = signedPending(cfg(), {
      state: "s",
      codeVerifier: "v",
      postLoginPath: "/"
    });
    const res = await GET(callbackReq({ code: "c", state: "s", cookie }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("token-exchange-failed");
  });
});
