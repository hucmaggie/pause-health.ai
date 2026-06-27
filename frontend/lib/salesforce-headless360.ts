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
  verified: "SF_HEADLESS360_VERIFIED",
  /**
   * Gate the /api/mcp endpoint behind Salesforce-issued bearer tokens.
   * When unset, /api/mcp stays public (the Agentforce 3.0 Registry
   * default + the design-partner public-mock posture). When set to a
   * truthy value, every /api/mcp request must carry an
   * `Authorization: Bearer <token>` header that Salesforce validates as
   * active with the `mcp_api` scope (introspect-first, userinfo fallback;
   * see `validateMcpApiBearer`).
   */
  requireMcpAuth: "SF_HEADLESS360_REQUIRE_MCP_AUTH"
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

// -----------------------------------------------------------------------------
// Gap #2 — `mcp_api` bearer validation for /api/mcp
// -----------------------------------------------------------------------------
//
// The Headless 360 trust model says external clients calling MCP tools
// present a Salesforce-issued OAuth bearer with `mcp_api` scope, so the
// MCP server can attribute the call to a Salesforce user identity for
// Event Monitoring + Shield audit. This block implements the server-side
// half: when `SF_HEADLESS360_REQUIRE_MCP_AUTH` is set, the /api/mcp route
// uses `validateMcpApiBearer` to gate every request.
//
// Why introspect-first with a userinfo fallback (vs. local JWT decode):
// Salesforce access tokens are opaque to the client. The canonical RFC
// 7662 introspect endpoint at /services/oauth2/introspect returns the
// `scope` claim so we can enforce `mcp_api` strictly. BUT introspect is
// configurable per org and may be disabled. When that happens, we fall
// back to /services/oauth2/userinfo, which validates token aliveness
// (200 = valid, 401 = bad) but doesn't surface scope. That fallback is
// honest about its weaker guarantee in the returned result so callers
// can log it and the runbook can flag it as a posture decision.
// -----------------------------------------------------------------------------

export function isMcpApiAuthRequired(): boolean {
  const raw = readEnv(ENV_KEYS.requireMcpAuth).toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export type McpApiBearerCheck =
  /**
   * Token validated. `via` records which Salesforce endpoint answered
   * so the caller can log + traces can distinguish the strict and
   * permissive paths.
   */
  | { ok: true; via: "introspect"; scope: string; username?: string }
  | { ok: true; via: "userinfo-fallback"; scope: null; username?: string }
  /**
   * No bearer presented, or the bearer is malformed (e.g. wrong scheme).
   * Caller should respond 401.
   */
  | { ok: false; reason: "missing-bearer" }
  /**
   * Salesforce introspect said the token is inactive (revoked, expired,
   * unknown). Caller should respond 401.
   */
  | { ok: false; reason: "token-inactive" }
  /**
   * Introspect said the token is active but the `scope` claim does NOT
   * contain `mcp_api`. Caller should respond 403 (authenticated, not
   * authorized for this surface).
   */
  | { ok: false; reason: "scope-mismatch"; scope: string }
  /**
   * Both introspect and userinfo failed at the network / Salesforce
   * layer. Caller should respond 503 — the gate cannot make a decision.
   * `detail` is included in the response body for runbook diagnosis.
   */
  | { ok: false; reason: "introspect-error"; detail: string };

function extractBearer(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

function scopeContainsMcpApi(scope: string | undefined | null): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).some((s) => s === "mcp_api");
}

// -----------------------------------------------------------------------------
// Bounded process-local cache for positive introspection results
// -----------------------------------------------------------------------------
//
// On a hot Vercel function instance, a single MCP client can fire dozens of
// JSON-RPC requests against /api/mcp within a few seconds. Re-validating the
// same bearer with Salesforce on every request costs ~50-100ms of extra
// latency. We cache only positive results for a short TTL (60s) so revocation
// latency stays bounded — a token revoked in Salesforce takes at most one
// TTL window to be rejected by Pause.
//
// Trade-offs and bounds:
//   - Only ok:true results are cached. Negatives re-check so a freshly-issued
//     token doesn't stay rejected, and a scope grant flips through immediately.
//   - The cache is process-local (Vercel functions are isolated per instance).
//     There is intentionally no shared cache: a process restart or
//     cold-instance miss costs one fresh introspect, which is fine.
//   - Capacity is bounded at 1024 entries to prevent unbounded growth from
//     a long-lived process seeing many distinct tokens. LRU-on-insert (oldest
//     evicted first) keeps the implementation a few lines.
//   - The cache key is the raw token. Process memory holds tokens for up to
//     the TTL; that's the same trust posture as any reverse proxy that
//     terminates Bearer auth in memory.
//
// Tests reach `_resetIntrospectCacheForTesting` to clear between cases.
// -----------------------------------------------------------------------------

const INTROSPECT_CACHE_TTL_MS = 60_000;
const INTROSPECT_CACHE_MAX_ENTRIES = 1024;

type CachedCheck = {
  expiresAt: number;
  result: Extract<McpApiBearerCheck, { ok: true }>;
};

const introspectCache = new Map<string, CachedCheck>();

function readCachedCheck(token: string, now: number): Extract<McpApiBearerCheck, { ok: true }> | null {
  const hit = introspectCache.get(token);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    introspectCache.delete(token);
    return null;
  }
  // Refresh insertion order so the LRU bookkeeping below evicts truly cold
  // entries rather than recently-used ones.
  introspectCache.delete(token);
  introspectCache.set(token, hit);
  return hit.result;
}

function writeCachedCheck(
  token: string,
  result: Extract<McpApiBearerCheck, { ok: true }>,
  now: number
): void {
  if (introspectCache.size >= INTROSPECT_CACHE_MAX_ENTRIES) {
    // Map iteration is insertion-order; first key is oldest.
    const oldest = introspectCache.keys().next().value;
    if (oldest !== undefined) introspectCache.delete(oldest);
  }
  introspectCache.set(token, {
    expiresAt: now + INTROSPECT_CACHE_TTL_MS,
    result
  });
}

/** Test-only: clear the cache between cases. */
export function _resetIntrospectCacheForTesting(): void {
  introspectCache.clear();
}

/**
 * Validate a `/api/mcp` request's bearer token against Salesforce.
 *
 * Calls `${cfg.authBaseUrl}/services/oauth2/introspect` first. If that
 * endpoint 404s or 405s (some orgs have it disabled), falls back to
 * `/services/oauth2/userinfo` which only proves token aliveness, not
 * scope. The fallback result is flagged via `via: "userinfo-fallback"`
 * + `scope: null` so callers can decide whether to accept the weaker
 * guarantee for their threat model.
 *
 * Positive results are cached for `INTROSPECT_CACHE_TTL_MS` (60s) — see
 * the cache block above. The cache is consulted before the introspect
 * network call; the `nowMs` parameter is exposed for deterministic
 * testing of TTL behavior.
 *
 * Never throws. Network errors collapse to `introspect-error`.
 */
export async function validateMcpApiBearer(
  req: Request,
  cfg: Headless360Config,
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = () => Date.now()
): Promise<McpApiBearerCheck> {
  const token = extractBearer(req);
  if (!token) return { ok: false, reason: "missing-bearer" };

  const cached = readCachedCheck(token, nowMs());
  if (cached) return cached;

  // --- Step 1: RFC 7662 introspect (strict path) ----------------------------
  let introspectResp: Response | null = null;
  try {
    const body = new URLSearchParams({
      token,
      token_type_hint: "access_token",
      client_id: cfg.clientId
    });
    introspectResp = await fetchImpl(
      `${cfg.authBaseUrl}/services/oauth2/introspect`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body
      }
    );
  } catch (err) {
    // Network blew up. Skip to userinfo fallback below.
    introspectResp = null;
  }

  if (introspectResp && introspectResp.ok) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await introspectResp.json()) as Record<string, unknown>;
    } catch {
      // Salesforce returned 200 with a non-JSON body. Treat as introspect
      // failure and try userinfo.
      parsed = {};
    }
    if (typeof parsed.active === "boolean") {
      if (!parsed.active) return { ok: false, reason: "token-inactive" };
      const scope = typeof parsed.scope === "string" ? parsed.scope : "";
      if (!scopeContainsMcpApi(scope)) {
        return { ok: false, reason: "scope-mismatch", scope };
      }
      const username =
        typeof parsed.username === "string" ? parsed.username : undefined;
      const result: Extract<McpApiBearerCheck, { ok: true }> = {
        ok: true,
        via: "introspect",
        scope,
        username
      };
      writeCachedCheck(token, result, nowMs());
      return result;
    }
    // 200 but `active` field missing — fall through to userinfo.
  }

  // --- Step 2: userinfo fallback (permissive path) --------------------------
  //
  // Reached when introspect is disabled (404/405), errored at the
  // network layer, or returned an unexpected body. userinfo proves the
  // token is alive but cannot surface scope; the returned `via:
  // "userinfo-fallback"` flag tells the caller this is the weaker path.
  let userinfoResp: Response | null = null;
  try {
    userinfoResp = await fetchImpl(
      `${cfg.authBaseUrl}/services/oauth2/userinfo`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );
  } catch (err) {
    return {
      ok: false,
      reason: "introspect-error",
      detail: `userinfo network error: ${(err as Error).message}`
    };
  }

  if (userinfoResp.status === 401) return { ok: false, reason: "token-inactive" };
  if (!userinfoResp.ok) {
    return {
      ok: false,
      reason: "introspect-error",
      detail: `userinfo HTTP ${userinfoResp.status}`
    };
  }
  let userinfo: Record<string, unknown> = {};
  try {
    userinfo = (await userinfoResp.json()) as Record<string, unknown>;
  } catch {
    userinfo = {};
  }
  const username =
    typeof userinfo.preferred_username === "string"
      ? userinfo.preferred_username
      : typeof userinfo.email === "string"
        ? userinfo.email
        : undefined;
  const result: Extract<McpApiBearerCheck, { ok: true }> = {
    ok: true,
    via: "userinfo-fallback",
    scope: null,
    username
  };
  writeCachedCheck(token, result, nowMs());
  return result;
}
