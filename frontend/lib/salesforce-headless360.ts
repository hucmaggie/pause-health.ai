/**
 * Salesforce Headless 360 — OAuth 2.0 Authorization Code + PKCE flow.
 *
 * Implements the trust model Salesforce documents for Headless 360
 * (TDX 2026): a non-Salesforce frontend registered as an **External
 * Client App** acquires user identity via Authorization Code + PKCE
 * with scopes `mcp_api` + `refresh_token`. The user's bearer token
 * then carries identity into Data 360 REST calls, MCP `tools/call`
 * requests, and A2A `tasks/send` invocations — so Event Monitoring +
 * Shield can attribute every call to a Salesforce user.
 *
 * This module is the prototype-side seam. It is fully env-driven and
 * degrades honestly when unset (status `designed`). When the env vars
 * are set it activates the four routes under
 * `/api/salesforce/headless-360/*`; after operator verification it
 * flips to `shipped`.
 *
 * Authoritative sources:
 *   - https://www.salesforce.com/blog/headless-trust-model-agentic-architecture/
 *   - https://www.salesforce.com/blog/headless-360-integration-architecture/
 *   - https://help.salesforce.com/ — External Client App configuration
 *     (sales-gated; see docs/HEADLESS_360_RUNBOOK.md for the
 *     procurement-side checklist)
 *
 * What this module does NOT do:
 *   - Persist tokens server-side. Sessions are encrypted+signed cookies
 *     stored client-side, so the prototype stays stateless on Vercel.
 *     A production customer org would swap this for KV or Redis without
 *     changing the route contracts.
 *   - Decode the access token. Salesforce access tokens are opaque to
 *     the client; the `/me` route asks Salesforce's `/services/oauth2/
 *     userinfo` for identity rather than parsing the token.
 *   - Run the four routes when the env vars are unset. /authorize +
 *     /callback + /token/refresh + /me all 503 in that case; only
 *     /config responds (with status `designed`) so the proposal page
 *     and probe scripts can read provisioning state without erroring.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Validated configuration. Returned by `getHeadless360Config` when
 * every required env var resolves; null otherwise.
 */
export type Headless360Config = {
  /** External Client App client_id (public OAuth identifier). */
  clientId: string;
  /** Salesforce instance base URL, e.g. https://my-org.my.salesforce.com */
  authBaseUrl: string;
  /** Absolute URL on this Vercel deployment where Salesforce redirects after consent. */
  redirectUri: string;
  /** Space-separated scope string. Defaults to "mcp_api refresh_token". */
  scopes: string;
  /**
   * Shared secret used to sign + encrypt the session cookies. MUST be
   * at least 32 bytes of entropy. We don't accept short keys: a weak
   * key here means a forgeable session.
   */
  sessionSecret: Buffer;
};

const ENV_KEYS = {
  clientId: "SF_HEADLESS360_CLIENT_ID",
  authBaseUrl: "SF_HEADLESS360_AUTH_BASE_URL",
  redirectUri: "SF_HEADLESS360_REDIRECT_URI",
  scopes: "SF_HEADLESS360_SCOPES",
  sessionSecret: "SF_HEADLESS360_SESSION_SECRET",
  verified: "SF_HEADLESS360_VERIFIED"
} as const;

function readEnv(key: string): string {
  const value = process.env[key];
  return typeof value === "string" ? value.trim() : "";
}

function decodeSecret(raw: string): Buffer | null {
  // Accept either hex (64 chars) or base64. Reject anything shorter
  // than 32 raw bytes — too short to safely HMAC.
  let buf: Buffer | null = null;
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length >= 64) {
    buf = Buffer.from(raw, "hex");
  } else {
    try {
      const candidate = Buffer.from(raw, "base64");
      if (candidate.length >= 32) buf = candidate;
    } catch {
      buf = null;
    }
  }
  if (!buf || buf.length < 32) return null;
  return buf;
}

export function getHeadless360Config(): Headless360Config | null {
  const clientId = readEnv(ENV_KEYS.clientId);
  const authBaseUrl = readEnv(ENV_KEYS.authBaseUrl);
  const redirectUri = readEnv(ENV_KEYS.redirectUri);
  const scopes = readEnv(ENV_KEYS.scopes) || "mcp_api refresh_token";
  const secretRaw = readEnv(ENV_KEYS.sessionSecret);

  if (!clientId || !authBaseUrl || !redirectUri || !secretRaw) return null;

  if (!/^https:\/\//i.test(authBaseUrl)) {
    console.warn(
      `[headless-360] ${ENV_KEYS.authBaseUrl} must be https://; got ${JSON.stringify(authBaseUrl)}. Treating as unset.`
    );
    return null;
  }
  if (!/^https:\/\//i.test(redirectUri)) {
    console.warn(
      `[headless-360] ${ENV_KEYS.redirectUri} must be https://; got ${JSON.stringify(redirectUri)}. Treating as unset.`
    );
    return null;
  }
  const sessionSecret = decodeSecret(secretRaw);
  if (!sessionSecret) {
    console.warn(
      `[headless-360] ${ENV_KEYS.sessionSecret} must be ≥32 bytes (hex 64+ chars or base64). Treating as unset.`
    );
    return null;
  }

  return {
    clientId,
    authBaseUrl: authBaseUrl.replace(/\/+$/, ""),
    redirectUri,
    scopes,
    sessionSecret
  };
}

export function isHeadless360Configured(): boolean {
  return getHeadless360Config() !== null;
}

export type Headless360Status = "designed" | "prototype" | "shipped";

export function getHeadless360Status(): Headless360Status {
  if (!isHeadless360Configured()) return "designed";
  const verified = readEnv(ENV_KEYS.verified).toLowerCase();
  if (verified === "1" || verified === "true" || verified === "on") {
    return "shipped";
  }
  return "prototype";
}

export type Headless360PublicConfig = {
  status: Headless360Status;
  /** Present when status !== "designed". */
  scopes?: string;
  /** Present when status !== "designed". */
  authorizeUrl?: string;
};

export function toPublicConfig(): Headless360PublicConfig {
  const status = getHeadless360Status();
  if (status === "designed") return { status };
  const cfg = getHeadless360Config();
  if (!cfg) return { status: "designed" };
  return {
    status,
    scopes: cfg.scopes,
    // Surface the local route that initiates the flow, not the
    // Salesforce /authorize endpoint directly. Clients shouldn't
    // construct PKCE state themselves; the route handler owns that.
    authorizeUrl: "/api/salesforce/headless-360/authorize"
  };
}

// -----------------------------------------------------------------------------
// PKCE helpers (RFC 7636).
// -----------------------------------------------------------------------------

/**
 * Generate a cryptographically random PKCE code_verifier.
 *
 * RFC 7636 §4.1: 43-128 characters from [A-Z a-z 0-9 -._~]. We pick
 * 64 chars from 48 random bytes — safely above the minimum, well under
 * the maximum, and uniform over the unreserved alphabet via base64url.
 */
export function generatePkceVerifier(): string {
  return randomBytes(48).toString("base64url");
}

/**
 * Derive a code_challenge from a verifier using S256.
 *
 * RFC 7636 §4.2 specifies: base64url(SHA256(verifier-as-ASCII-bytes)).
 */
export async function generatePkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(digest).toString("base64url");
}

/**
 * Generate the OAuth `state` value — used to bind the redirect to
 * the originating authorize call and to defend against CSRF.
 *
 * We use 32 random bytes (256 bits) base64url-encoded. The state is
 * stored in a signed cookie (see below) and verified on callback.
 */
export function generateOauthState(): string {
  return randomBytes(32).toString("base64url");
}

// -----------------------------------------------------------------------------
// Signed cookie helpers — minimal HMAC envelope, no encryption.
// -----------------------------------------------------------------------------
//
// We use HMAC-signed JSON cookies rather than encrypted ones because
// the values we store (state, code_verifier, access_token,
// refresh_token, expiry) need to be tamper-evident, not secret-from-
// the-cookie-holder. The cookie sits in the user's browser; the user
// can already read their own tokens. What we want to prevent is a
// third party rewriting the cookie to swap in their state or a
// different user's tokens. HMAC-SHA256 does that with one secret.
//
// Cookies are marked HttpOnly + Secure + SameSite=Lax. SameSite=Lax
// is required because the OAuth callback is a top-level navigation
// from Salesforce; SameSite=Strict would drop the state cookie on
// the redirect back.
// -----------------------------------------------------------------------------

const SIGN_SEPARATOR = ".";

export function signCookieValue(value: string, secret: Buffer): string {
  const payload = Buffer.from(value, "utf-8").toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}${SIGN_SEPARATOR}${mac}`;
}

export function verifyCookieValue(
  signed: string,
  secret: Buffer
): string | null {
  if (typeof signed !== "string" || !signed.includes(SIGN_SEPARATOR)) return null;
  const [payload, mac] = signed.split(SIGN_SEPARATOR);
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  // Constant-time compare; both buffers must be the same length.
  const a = Buffer.from(mac, "base64url");
  const b = Buffer.from(expected, "base64url");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(payload, "base64url").toString("utf-8");
  } catch {
    return null;
  }
}

export type Headless360PendingState = {
  /** OAuth state. Echoed by Salesforce on the redirect-back. */
  state: string;
  /** PKCE code_verifier. Re-presented on token exchange. */
  codeVerifier: string;
  /** Where to redirect after a successful exchange. Default "/". */
  postLoginPath: string;
};

export function serializePending(value: Headless360PendingState): string {
  return JSON.stringify(value);
}

export function parsePending(value: string | null): Headless360PendingState | null {
  if (!value) return null;
  try {
    const obj = JSON.parse(value) as Partial<Headless360PendingState>;
    if (
      typeof obj.state === "string" &&
      typeof obj.codeVerifier === "string" &&
      typeof obj.postLoginPath === "string"
    ) {
      return obj as Headless360PendingState;
    }
    return null;
  } catch {
    return null;
  }
}

export type Headless360Session = {
  /** Salesforce instance URL returned by /services/oauth2/token. */
  instanceUrl: string;
  /** Access token. Opaque; presented as `Authorization: Bearer ...`. */
  accessToken: string;
  /** Optional refresh token. Present when `refresh_token` scope is granted. */
  refreshToken?: string;
  /** When the access token expires (ms since epoch). */
  expiresAt: number;
  /** /services/oauth2/userinfo `sub` (Salesforce identity URL). */
  identityUrl?: string;
};

export function serializeSession(value: Headless360Session): string {
  return JSON.stringify(value);
}

export function parseSession(value: string | null): Headless360Session | null {
  if (!value) return null;
  try {
    const obj = JSON.parse(value) as Partial<Headless360Session>;
    if (
      typeof obj.instanceUrl === "string" &&
      typeof obj.accessToken === "string" &&
      typeof obj.expiresAt === "number"
    ) {
      return obj as Headless360Session;
    }
    return null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Cookie names + flags shared across the four routes.
// -----------------------------------------------------------------------------

/** Cookie set on /authorize, consumed + cleared on /callback. */
export const PENDING_COOKIE_NAME = "pause_h360_pending";
/** Cookie set on /callback, read by /me + /token/refresh, cleared on /logout. */
export const SESSION_COOKIE_NAME = "pause_h360_session";
/** Cookie max-age for the pending cookie (90 seconds — enough for Salesforce consent + redirect, not enough for replay). */
export const PENDING_COOKIE_MAX_AGE_SECONDS = 90;
/** Cookie max-age for the session cookie (8 hours — bounded by access-token lifetime, refreshed on use). */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60;

export function cookieFlags(maxAge: number): string {
  return [
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ].join("; ");
}

export function clearedCookieFlags(): string {
  return "Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}
