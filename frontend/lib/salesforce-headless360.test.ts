import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, createHmac } from "node:crypto";

import {
  generateOauthState,
  generatePkceChallenge,
  generatePkceVerifier,
  getHeadless360Config,
  getHeadless360Status,
  isHeadless360Configured,
  isMcpApiAuthRequired,
  parsePending,
  parseSession,
  serializePending,
  serializeSession,
  signCookieValue,
  toPublicConfig,
  validateMcpApiBearer,
  verifyCookieValue
} from "./salesforce-headless360";

/**
 * Tests for the Salesforce Headless 360 PKCE seam.
 *
 * Invariants pinned here:
 *   1. Unset env → status "designed", null config.
 *   2. All required env set + well-formed → status "prototype", typed
 *      config, public payload omits clientId + redirectUri + secret.
 *   3. SF_HEADLESS360_VERIFIED=true → status "shipped" (only when
 *      provisioned).
 *   4. Malformed env (http:// URL, short secret) degrades to null
 *      with console.warn, never throws.
 *   5. PKCE verifier is in the [A-Z a-z 0-9 -._~] alphabet, ≥43
 *      chars; challenge is base64url(SHA256(verifier)).
 *   6. Signed cookie round-trips intact; any tamper (flipped byte,
 *      truncation, missing separator) fails verification.
 *   7. State CSRF binding works: cookie state matches => accept,
 *      mismatch => reject.
 */

const KEYS = [
  "SF_HEADLESS360_CLIENT_ID",
  "SF_HEADLESS360_AUTH_BASE_URL",
  "SF_HEADLESS360_REDIRECT_URI",
  "SF_HEADLESS360_SCOPES",
  "SF_HEADLESS360_SESSION_SECRET",
  "SF_HEADLESS360_VERIFIED",
  "SF_HEADLESS360_REQUIRE_MCP_AUTH"
] as const;

function clearEnv() {
  for (const k of KEYS) delete process.env[k];
}

const TEST_SECRET_HEX = randomBytes(32).toString("hex");

function fullyProvisioned() {
  process.env.SF_HEADLESS360_CLIENT_ID = "3MVG9_test_client_id";
  process.env.SF_HEADLESS360_AUTH_BASE_URL = "https://test.my.salesforce.com";
  process.env.SF_HEADLESS360_REDIRECT_URI =
    "https://pause-health.ai/api/salesforce/headless-360/callback";
  process.env.SF_HEADLESS360_SESSION_SECRET = TEST_SECRET_HEX;
}

describe("getHeadless360Config", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => clearEnv());
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL);
  });

  it("returns null when unset", () => {
    expect(getHeadless360Config()).toBeNull();
    expect(isHeadless360Configured()).toBe(false);
  });

  it("returns null when any required var is missing", () => {
    fullyProvisioned();
    delete process.env.SF_HEADLESS360_REDIRECT_URI;
    expect(getHeadless360Config()).toBeNull();
  });

  it("returns a typed config when all required vars are set", () => {
    fullyProvisioned();
    const cfg = getHeadless360Config();
    expect(cfg).not.toBeNull();
    expect(cfg?.clientId).toBe("3MVG9_test_client_id");
    expect(cfg?.authBaseUrl).toBe("https://test.my.salesforce.com");
    expect(cfg?.scopes).toBe("mcp_api refresh_token");
    expect(cfg?.sessionSecret.length).toBe(32);
  });

  it("respects an explicit scopes override", () => {
    fullyProvisioned();
    process.env.SF_HEADLESS360_SCOPES = "mcp_api refresh_token api";
    expect(getHeadless360Config()?.scopes).toBe("mcp_api refresh_token api");
  });

  it("rejects http:// authBaseUrl and degrades to null", () => {
    fullyProvisioned();
    process.env.SF_HEADLESS360_AUTH_BASE_URL = "http://insecure.example/";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getHeadless360Config()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("rejects http:// redirectUri and degrades to null", () => {
    fullyProvisioned();
    process.env.SF_HEADLESS360_REDIRECT_URI =
      "http://pause-health.ai/api/salesforce/headless-360/callback";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getHeadless360Config()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("rejects a short session secret", () => {
    fullyProvisioned();
    process.env.SF_HEADLESS360_SESSION_SECRET = "abcd1234";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getHeadless360Config()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("strips trailing slashes from authBaseUrl", () => {
    fullyProvisioned();
    process.env.SF_HEADLESS360_AUTH_BASE_URL = "https://test.my.salesforce.com///";
    expect(getHeadless360Config()?.authBaseUrl).toBe(
      "https://test.my.salesforce.com"
    );
  });
});

describe("getHeadless360Status + toPublicConfig", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => clearEnv());
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL);
  });

  it("returns designed when unprovisioned", () => {
    expect(getHeadless360Status()).toBe("designed");
    expect(toPublicConfig()).toEqual({ status: "designed" });
  });

  it("returns prototype when provisioned but not verified", () => {
    fullyProvisioned();
    expect(getHeadless360Status()).toBe("prototype");
    const pub = toPublicConfig();
    expect(pub.status).toBe("prototype");
    expect(pub.scopes).toBe("mcp_api refresh_token");
    expect(pub.authorizeUrl).toBe("/api/salesforce/headless-360/authorize");
  });

  it("returns shipped only when VERIFIED is truthy AND provisioned", () => {
    fullyProvisioned();
    for (const truthy of ["true", "1", "on", "TRUE"]) {
      process.env.SF_HEADLESS360_VERIFIED = truthy;
      expect(getHeadless360Status()).toBe("shipped");
    }
  });

  it("never returns shipped without the underlying config", () => {
    process.env.SF_HEADLESS360_VERIFIED = "true";
    expect(getHeadless360Status()).toBe("designed");
  });

  it("public payload omits clientId, redirectUri, and the secret", () => {
    fullyProvisioned();
    const pub = toPublicConfig();
    expect(pub).not.toHaveProperty("clientId");
    expect(pub).not.toHaveProperty("redirectUri");
    expect(pub).not.toHaveProperty("sessionSecret");
    // Also: never surface authBaseUrl. Clients shouldn't construct
    // Salesforce URLs themselves — they hit the local /authorize.
    expect(pub).not.toHaveProperty("authBaseUrl");
  });
});

describe("PKCE helpers", () => {
  it("verifier matches RFC 7636 alphabet + length", () => {
    for (let i = 0; i < 8; i += 1) {
      const v = generatePkceVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      // base64url alphabet is a subset of the RFC 7636 unreserved set.
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("challenge equals base64url(SHA256(verifier))", async () => {
    const verifier = "test-verifier-for-known-vector";
    // Hand-compute the expected SHA-256 digest, base64url-encoded.
    const expected = (
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier)
      )
    );
    const expectedB64 = Buffer.from(expected).toString("base64url");
    const got = await generatePkceChallenge(verifier);
    expect(got).toBe(expectedB64);
  });

  it("oauth state is high-entropy", () => {
    const a = generateOauthState();
    const b = generateOauthState();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).not.toBe(b);
  });
});

describe("signed cookie envelope", () => {
  const secret = randomBytes(32);

  it("round-trips a value intact", () => {
    const signed = signCookieValue("hello world", secret);
    expect(signed.includes(".")).toBe(true);
    expect(verifyCookieValue(signed, secret)).toBe("hello world");
  });

  it("round-trips JSON via serializePending", () => {
    const pending = { state: "abc", codeVerifier: "xyz", postLoginPath: "/" };
    const signed = signCookieValue(serializePending(pending), secret);
    const out = parsePending(verifyCookieValue(signed, secret));
    expect(out).toEqual(pending);
  });

  it("rejects a tampered payload", () => {
    const signed = signCookieValue("hello", secret);
    const [payload, mac] = signed.split(".");
    // Flip one byte of the payload — keep the (now wrong) mac.
    const tamperedPayload = Buffer.from(payload, "base64url");
    tamperedPayload[0] ^= 0x01;
    const tampered = `${tamperedPayload.toString("base64url")}.${mac}`;
    expect(verifyCookieValue(tampered, secret)).toBeNull();
  });

  it("rejects a forged signature", () => {
    const signed = signCookieValue("hello", secret);
    const [payload] = signed.split(".");
    const forged = `${payload}.${createHmac("sha256", "wrong").update(payload).digest("base64url")}`;
    expect(verifyCookieValue(forged, secret)).toBeNull();
  });

  it("rejects missing-separator strings", () => {
    expect(verifyCookieValue("no-separator-here", secret)).toBeNull();
  });

  it("rejects truncated cookies", () => {
    const signed = signCookieValue("hello", secret);
    expect(verifyCookieValue(signed.slice(0, signed.length - 5), secret)).toBeNull();
  });
});

describe("session cookie shape", () => {
  it("round-trips a session through (serialize → sign → verify → parse)", () => {
    const secret = randomBytes(32);
    const session = {
      instanceUrl: "https://test.my.salesforce.com",
      accessToken: "00D...",
      refreshToken: "5Aep...",
      expiresAt: Date.now() + 60_000,
      identityUrl: "https://login.salesforce.com/id/00D/.../005..."
    };
    const signed = signCookieValue(serializeSession(session), secret);
    const out = parseSession(verifyCookieValue(signed, secret));
    expect(out).toEqual(session);
  });

  it("rejects malformed JSON", () => {
    expect(parseSession("not-json")).toBeNull();
  });

  it("rejects session objects missing required fields", () => {
    expect(parseSession(JSON.stringify({ instanceUrl: "x" }))).toBeNull();
  });
});

// =============================================================================
// Headless 360 audit gap #2 — `mcp_api` bearer validation for /api/mcp
// =============================================================================

describe("isMcpApiAuthRequired", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => clearEnv());
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL);
  });

  it("returns false when unset", () => {
    expect(isMcpApiAuthRequired()).toBe(false);
  });

  it.each(["1", "true", "on", "True", "ON", " on "])(
    "returns true for truthy %p",
    (val) => {
      process.env.SF_HEADLESS360_REQUIRE_MCP_AUTH = val;
      expect(isMcpApiAuthRequired()).toBe(true);
    }
  );

  it.each(["0", "false", "off", "no", ""])(
    "returns false for %p",
    (val) => {
      process.env.SF_HEADLESS360_REQUIRE_MCP_AUTH = val;
      expect(isMcpApiAuthRequired()).toBe(false);
    }
  );
});

describe("validateMcpApiBearer", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => clearEnv());
  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in ORIGINAL)) delete process.env[k];
    });
    Object.assign(process.env, ORIGINAL);
  });

  // Build a config the same way runtime code does (env → getHeadless360Config).
  function cfg() {
    fullyProvisioned();
    const c = getHeadless360Config();
    if (!c) throw new Error("test setup: config should be provisioned");
    return c;
  }

  function reqWith(headers: Record<string, string>): Request {
    return new Request("https://pause-health.ai/api/mcp", { headers });
  }

  function jsonResp(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  }

  it("returns missing-bearer when no Authorization header is present", async () => {
    const out = await validateMcpApiBearer(new Request("https://x/y"), cfg());
    expect(out).toEqual({ ok: false, reason: "missing-bearer" });
  });

  it("returns missing-bearer for non-Bearer schemes", async () => {
    const out = await validateMcpApiBearer(
      reqWith({ authorization: "Basic dXNlcjpwYXNz" }),
      cfg()
    );
    expect(out).toEqual({ ok: false, reason: "missing-bearer" });
  });

  it("introspect-active + mcp_api scope → ok via introspect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResp({ active: true, scope: "mcp_api refresh_token api", username: "u@example.com" })
    );
    const out = await validateMcpApiBearer(
      reqWith({ authorization: "Bearer real-token" }),
      cfg(),
      fetchMock as unknown as typeof fetch
    );
    expect(out).toEqual({
      ok: true,
      via: "introspect",
      scope: "mcp_api refresh_token api",
      username: "u@example.com"
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test.my.salesforce.com/services/oauth2/introspect");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("token=real-token");
    expect(String(init.body)).toContain("token_type_hint=access_token");
    expect(String(init.body)).toContain("client_id=3MVG9_test_client_id");
  });

  it("introspect-active without mcp_api scope → scope-mismatch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResp({ active: true, scope: "api refresh_token" })
    );
    const out = await validateMcpApiBearer(
      reqWith({ authorization: "Bearer real-token" }),
      cfg(),
      fetchMock as unknown as typeof fetch
    );
    expect(out).toEqual({
      ok: false,
      reason: "scope-mismatch",
      scope: "api refresh_token"
    });
  });

  it("introspect-inactive → token-inactive (no userinfo fallback)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResp({ active: false }));
    const out = await validateMcpApiBearer(
      reqWith({ authorization: "Bearer revoked" }),
      cfg(),
      fetchMock as unknown as typeof fetch
    );
    expect(out).toEqual({ ok: false, reason: "token-inactive" });
    // userinfo should NOT be called when introspect gave a definitive answer
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("introspect 404 → userinfo fallback succeeds → ok via userinfo-fallback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        jsonResp({ preferred_username: "u@example.com", email: "u@example.com" })
      );
    const out = await validateMcpApiBearer(
      reqWith({ authorization: "Bearer t" }),
      cfg(),
      fetchMock as unknown as typeof fetch
    );
    expect(out).toEqual({
      ok: true,
      via: "userinfo-fallback",
      scope: null,
      username: "u@example.com"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [introspectCall, userinfoCall] = fetchMock.mock.calls as [
      [string, RequestInit],
      [string, RequestInit]
    ];
    expect(introspectCall[0]).toContain("/services/oauth2/introspect");
    expect(userinfoCall[0]).toBe(
      "https://test.my.salesforce.com/services/oauth2/userinfo"
    );
    expect((userinfoCall[1].headers as Record<string, string>).Authorization).toBe(
      "Bearer t"
    );
  });

  it("introspect 404 + userinfo 401 → token-inactive", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("disabled", { status: 404 }))
      .mockResolvedValueOnce(new Response("unauth", { status: 401 }));
    const out = await validateMcpApiBearer(
      reqWith({ authorization: "Bearer bad" }),
      cfg(),
      fetchMock as unknown as typeof fetch
    );
    expect(out).toEqual({ ok: false, reason: "token-inactive" });
  });

  it("introspect network error + userinfo network error → introspect-error", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED introspect"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED userinfo"));
    const out = await validateMcpApiBearer(
      reqWith({ authorization: "Bearer t" }),
      cfg(),
      fetchMock as unknown as typeof fetch
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("introspect-error");
      expect("detail" in out && out.detail).toContain("ECONNREFUSED userinfo");
    }
  });

  it("introspect 200 with bogus body → falls back to userinfo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>maintenance</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" }
        })
      )
      .mockResolvedValueOnce(jsonResp({ preferred_username: "u@example.com" }));
    const out = await validateMcpApiBearer(
      reqWith({ authorization: "Bearer t" }),
      cfg(),
      fetchMock as unknown as typeof fetch
    );
    expect(out).toEqual({
      ok: true,
      via: "userinfo-fallback",
      scope: null,
      username: "u@example.com"
    });
  });

  it("trims whitespace in the Authorization header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResp({ active: true, scope: "mcp_api" }));
    const out = await validateMcpApiBearer(
      reqWith({ authorization: "Bearer    real-token   " }),
      cfg(),
      fetchMock as unknown as typeof fetch
    );
    expect(out.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("token=real-token");
  });
});
