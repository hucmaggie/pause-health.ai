import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

import { POST } from "./route";
import {
  SESSION_COOKIE_NAME,
  getHeadless360Config,
  parseSession,
  serializeSession,
  signCookieValue,
  verifyCookieValue,
  type Headless360Config,
  type Headless360Session
} from "../../../../../../lib/salesforce-headless360";

/**
 * POST /api/salesforce/headless-360/token/refresh — refresh-token grant.
 * Pins that the new access token is written to the cookie (never the body),
 * a failed refresh clears the session so the client can re-auth cleanly, and
 * a non-rotated refresh token is preserved.
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

function refreshReq(session?: Headless360Session) {
  const headers: Record<string, string> = {};
  if (session) {
    const value = signCookieValue(serializeSession(session), cfg().sessionSecret);
    headers.cookie = `${SESSION_COOKIE_NAME}=${value}`;
  }
  return new Request(
    "https://pause-health.ai/api/salesforce/headless-360/token/refresh",
    { method: "POST", headers }
  );
}

function baseSession(over: Partial<Headless360Session> = {}): Headless360Session {
  return {
    instanceUrl: "https://test.my.salesforce.com",
    accessToken: "OLD-ACCESS",
    refreshToken: "REFRESH-1",
    expiresAt: Date.now() + 60_000,
    ...over
  };
}

function stubToken(body: unknown, status = 200, statusText = "OK") {
  const spy = vi.fn(
    async () => new Response(JSON.stringify(body), { status, statusText })
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function sessionFromSetCookie(res: Response) {
  const cookie = res.headers
    .getSetCookie()
    .find((c) => c.startsWith(SESSION_COOKIE_NAME))!;
  const raw = cookie.slice(SESSION_COOKIE_NAME.length + 1).split(";")[0];
  return parseSession(verifyCookieValue(raw, cfg().sessionSecret));
}

describe("POST /token/refresh · guards", () => {
  it("returns 503 when unprovisioned", async () => {
    const res = await POST(refreshReq());
    expect(res.status).toBe(503);
  });

  it("returns 401 not-signed-in with no session cookie", async () => {
    fullyProvisioned();
    const res = await POST(refreshReq());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not-signed-in");
  });

  it("returns 401 when the session has no refresh token", async () => {
    fullyProvisioned();
    const res = await POST(refreshReq(baseSession({ refreshToken: undefined })));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("no-refresh-token-on-session");
  });
});

describe("POST /token/refresh · exchange", () => {
  it("mints a new access token into the cookie and never returns it in the body", async () => {
    fullyProvisioned();
    const spy = stubToken({
      access_token: "NEW-ACCESS",
      refresh_token: "REFRESH-2",
      instance_url: "https://test.my.salesforce.com",
      expires_in: "7200"
    });
    const res = await POST(refreshReq(baseSession()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.expiresAt).toBeGreaterThan(Date.now());
    // The response body must not carry the token — the cookie is the carrier.
    expect(JSON.stringify(body)).not.toContain("NEW-ACCESS");

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=REFRESH-1");

    const session = sessionFromSetCookie(res);
    expect(session!.accessToken).toBe("NEW-ACCESS");
    expect(session!.refreshToken).toBe("REFRESH-2");
  });

  it("preserves the existing refresh token when Salesforce does not rotate one", async () => {
    fullyProvisioned();
    stubToken({ access_token: "NEW-ACCESS", expires_in: "7200" });
    const res = await POST(refreshReq(baseSession({ refreshToken: "KEEP-ME" })));
    const session = sessionFromSetCookie(res);
    expect(session!.refreshToken).toBe("KEEP-ME");
    expect(session!.accessToken).toBe("NEW-ACCESS");
  });

  it("clears the session cookie and returns 502 when the refresh is rejected", async () => {
    fullyProvisioned();
    stubToken({ error: "invalid_grant" }, 400, "Bad Request");
    const res = await POST(refreshReq(baseSession()));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("refresh-failed");
    expect(res.headers.get("Set-Cookie")).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("returns 502 when the refresh response lacks an access token", async () => {
    fullyProvisioned();
    stubToken({ instance_url: "https://x" });
    const res = await POST(refreshReq(baseSession()));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("refresh-response-missing-access-token");
  });
});
