import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

import { GET } from "./route";
import {
  PENDING_COOKIE_NAME,
  generatePkceChallenge,
  getHeadless360Config,
  parsePending,
  verifyCookieValue
} from "../../../../../lib/salesforce-headless360";

/**
 * GET /api/salesforce/headless-360/authorize — initiates OAuth Auth-Code +
 * PKCE. Security-critical: the pending cookie it sets must be tamper-evident
 * and short-lived, the challenge in the redirect must match the verifier in
 * the cookie, and ?next must not become an open redirect.
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

beforeEach(() => clearEnv());
afterEach(() => {
  Object.keys(process.env).forEach((k) => {
    if (!(k in ORIGINAL)) delete process.env[k];
  });
  Object.assign(process.env, ORIGINAL);
});

function authReq(next?: string) {
  const u = new URL("https://pause-health.ai/api/salesforce/headless-360/authorize");
  if (next !== undefined) u.searchParams.set("next", next);
  return new Request(u.toString());
}

/** Parse a Set-Cookie header into {value, attrs}. */
function parseSetCookie(header: string, name: string) {
  const segments = header.split(/;\s*/);
  const first = segments[0];
  const eq = first.indexOf("=");
  const cookieName = first.slice(0, eq);
  const value = first.slice(eq + 1);
  expect(cookieName).toBe(name);
  return { value, attrs: segments.slice(1) };
}

describe("GET /authorize · unprovisioned", () => {
  it("returns 503 headless-360-not-configured", async () => {
    const res = await GET(authReq());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("headless-360-not-configured");
  });
});

describe("GET /authorize · provisioned", () => {
  it("302-redirects to the Salesforce authorize endpoint with the PKCE params", async () => {
    fullyProvisioned();
    const res = await GET(authReq());
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.origin + loc.pathname).toBe(
      "https://test.my.salesforce.com/services/oauth2/authorize"
    );
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("client_id")).toBe("3MVG9_test_client_id");
    expect(loc.searchParams.get("redirect_uri")).toBe(
      "https://pause-health.ai/api/salesforce/headless-360/callback"
    );
    expect(loc.searchParams.get("scope")).toBe("mcp_api refresh_token");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("state")).toBeTruthy();
    expect(loc.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("sets a tamper-evident pending cookie with the hardened flags", async () => {
    fullyProvisioned();
    const res = await GET(authReq());
    const setCookie = res.headers.get("Set-Cookie")!;
    const { attrs } = parseSetCookie(setCookie, PENDING_COOKIE_NAME);
    expect(attrs).toContain("HttpOnly");
    expect(attrs).toContain("Secure");
    expect(attrs).toContain("SameSite=Lax");
    expect(attrs).toContain("Path=/");
    // Short-lived: 90s is enough for consent + redirect, not for replay.
    expect(attrs).toContain("Max-Age=90");
  });

  it("binds the cookie to the redirect: state matches and challenge = S256(verifier)", async () => {
    fullyProvisioned();
    const res = await GET(authReq());
    const loc = new URL(res.headers.get("Location")!);
    const { value } = parseSetCookie(
      res.headers.get("Set-Cookie")!,
      PENDING_COOKIE_NAME
    );
    const cfg = getHeadless360Config()!;
    const pending = parsePending(verifyCookieValue(value, cfg.sessionSecret));
    expect(pending).not.toBeNull();
    // The state in the cookie is exactly the state sent to Salesforce.
    expect(pending!.state).toBe(loc.searchParams.get("state"));
    // The challenge sent to Salesforce is the S256 hash of the cookie's verifier.
    const expectedChallenge = await generatePkceChallenge(pending!.codeVerifier);
    expect(loc.searchParams.get("code_challenge")).toBe(expectedChallenge);
  });

  it("preserves a relative ?next as the post-login path", async () => {
    fullyProvisioned();
    const res = await GET(authReq("/proposal/headless-360"));
    const cfg = getHeadless360Config()!;
    const { value } = parseSetCookie(
      res.headers.get("Set-Cookie")!,
      PENDING_COOKIE_NAME
    );
    const pending = parsePending(verifyCookieValue(value, cfg.sessionSecret));
    expect(pending!.postLoginPath).toBe("/proposal/headless-360");
  });

  it.each([
    ["https://evil.example/steal", "absolute URL"],
    ["//evil.example/steal", "protocol-relative URL"]
  ])("rejects an open-redirect ?next (%s) and falls back to '/'", async (next) => {
    fullyProvisioned();
    const res = await GET(authReq(next));
    const cfg = getHeadless360Config()!;
    const { value } = parseSetCookie(
      res.headers.get("Set-Cookie")!,
      PENDING_COOKIE_NAME
    );
    const pending = parsePending(verifyCookieValue(value, cfg.sessionSecret));
    expect(pending!.postLoginPath).toBe("/");
  });
});
