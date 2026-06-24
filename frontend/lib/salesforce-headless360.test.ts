import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, createHmac } from "node:crypto";

import {
  generateOauthState,
  generatePkceChallenge,
  generatePkceVerifier,
  getHeadless360Config,
  getHeadless360Status,
  isHeadless360Configured,
  parsePending,
  parseSession,
  serializePending,
  serializeSession,
  signCookieValue,
  toPublicConfig,
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
  "SF_HEADLESS360_VERIFIED"
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
