import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

import { GET } from "./route";
import {
  SESSION_COOKIE_NAME,
  getHeadless360Config,
  serializeSession,
  signCookieValue,
  type Headless360Config,
  type Headless360Session
} from "../../../../../lib/salesforce-headless360";

/**
 * GET /api/salesforce/headless-360/me — resolves the signed-in identity.
 * Pins the session-state ladder (unconfigured → not-signed-in → expired →
 * live) and that a userinfo failure degrades into the payload rather than
 * breaking the response shape.
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

function sessionReq(session: Headless360Session) {
  const value = signCookieValue(serializeSession(session), cfg().sessionSecret);
  return new Request("https://pause-health.ai/api/salesforce/headless-360/me", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${value}` }
  });
}

function liveSession(): Headless360Session {
  return {
    instanceUrl: "https://test.my.salesforce.com",
    accessToken: "00Dxx!ATOKEN",
    refreshToken: "5Aep!REFRESH",
    expiresAt: Date.now() + 60_000,
    identityUrl: "https://login.salesforce.com/id/00D/005"
  };
}

describe("GET /me", () => {
  it("returns 503 when unprovisioned", async () => {
    const res = await GET(
      new Request("https://pause-health.ai/api/salesforce/headless-360/me")
    );
    expect(res.status).toBe(503);
  });

  it("returns 401 not-signed-in when there is no session cookie", async () => {
    fullyProvisioned();
    const res = await GET(
      new Request("https://pause-health.ai/api/salesforce/headless-360/me")
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not-signed-in");
  });

  it("returns 401 session-expired when the access token is past expiry", async () => {
    fullyProvisioned();
    const res = await GET(
      sessionReq({ ...liveSession(), expiresAt: Date.now() - 1000 })
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("session-expired");
  });

  it("returns 200 with identity when the session is live and userinfo succeeds", async () => {
    fullyProvisioned();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ preferred_username: "u@example.com", name: "U Example" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    const res = await GET(sessionReq(liveSession()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.meta.expiresAt).toBeGreaterThan(Date.now());
    expect(json.meta.instanceUrl).toBe("https://test.my.salesforce.com");
    expect(json.user.preferred_username).toBe("u@example.com");
  });

  it("keeps the response shape when userinfo fails (surfaces _userinfo_error)", async () => {
    fullyProvisioned();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401, statusText: "Unauthorized" }))
    );
    const res = await GET(sessionReq(liveSession()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user._userinfo_error).toContain("401");
    expect(json.meta.expiresAt).toBeGreaterThan(Date.now());
  });
});
