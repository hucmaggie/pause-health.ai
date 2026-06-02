/**
 * Salesforce OAuth 2.0 Client Credentials Flow — server-to-server auth.
 *
 * This module is the single chokepoint for obtaining a Salesforce access
 * token from anywhere in the Next.js server runtime (API routes, server
 * components, route handlers). All real-org Salesforce REST calls in this
 * codebase MUST go through `getAccessToken()` rather than reading env vars
 * or calling /services/oauth2/token directly.
 *
 * Why a single chokepoint:
 *   - Token caching. Salesforce access tokens are short-lived (default
 *     ~2 hours / configurable per-policy). Caching avoids one network
 *     round-trip per request.
 *   - Predictable fallback semantics. `isSalesforceConfigured()` returns a
 *     single source of truth that the grounding / identity layers branch on.
 *   - Easier to swap auth flow later (e.g. JWT Bearer) without changing
 *     every call site.
 *
 * The fallback rule (matches the rest of the codebase — Agentforce,
 * Care Router, Anthropic, etc.):
 *
 *   If SF_INSTANCE_URL + SF_CLIENT_ID + SF_CLIENT_SECRET are all set,
 *   `isSalesforceConfigured()` returns true and `getAccessToken()` returns
 *   a real token. Otherwise `isSalesforceConfigured()` returns false and
 *   `getAccessToken()` throws a typed error — callers are expected to
 *   short-circuit to the mocked path BEFORE calling.
 *
 * What this module deliberately does NOT do:
 *   - Cache tokens across server-process restarts. The in-memory cache is
 *     scoped to a single Node.js process. On Vercel that means each
 *     serverless function instance gets its own cache, which is fine —
 *     Salesforce tolerates concurrent token issuance from the same client.
 *   - Encrypt secrets at rest. SF_CLIENT_SECRET lives in env vars only.
 *     If we later need encrypted-at-rest behavior, that belongs upstream
 *     (Vercel encrypted env vars, Doppler, etc.), not in this module.
 *   - Refresh tokens. Client Credentials Flow does not issue refresh
 *     tokens; we just request a new access token when the cached one
 *     expires.
 */

const ENV_KEYS = {
  instanceUrl: "SF_INSTANCE_URL",
  clientId: "SF_CLIENT_ID",
  clientSecret: "SF_CLIENT_SECRET",
  apiVersion: "SF_API_VERSION"
} as const;

const DEFAULT_API_VERSION = "60.0";

/**
 * 60-second safety buffer subtracted from the reported token lifetime so
 * we refresh proactively rather than racing the expiry. Salesforce tokens
 * are typically issued with 7,200s lifetime; a 60s buffer is conservative.
 */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

/**
 * Default lifetime to assume when Salesforce does not return an
 * `expires_in` field. Client Credentials Flow normally does — but we
 * defensively default to a short value to force a fresh request on the
 * next call, rather than cache indefinitely.
 */
const FALLBACK_LIFETIME_MS = 5 * 60_000;

export type SalesforceConfig = {
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
  apiVersion: string;
};

type CachedToken = {
  accessToken: string;
  instanceUrlFromTokenResponse: string;
  expiresAtMs: number;
};

let cachedToken: CachedToken | null = null;
let inflight: Promise<CachedToken> | null = null;

function readEnv(key: string): string {
  const value = process.env[key];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInstanceUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

/**
 * Return the Salesforce config if all three required env vars are set,
 * otherwise null. Callers that need a typed config should use this; callers
 * that only need a boolean should prefer `isSalesforceConfigured()` for
 * readability.
 */
export function getSalesforceConfig(): SalesforceConfig | null {
  const instanceUrl = readEnv(ENV_KEYS.instanceUrl);
  const clientId = readEnv(ENV_KEYS.clientId);
  const clientSecret = readEnv(ENV_KEYS.clientSecret);
  if (!instanceUrl || !clientId || !clientSecret) {
    return null;
  }
  return {
    instanceUrl: normalizeInstanceUrl(instanceUrl),
    clientId,
    clientSecret,
    apiVersion: readEnv(ENV_KEYS.apiVersion) || DEFAULT_API_VERSION
  };
}

export function isSalesforceConfigured(): boolean {
  return getSalesforceConfig() !== null;
}

/**
 * Typed error thrown when token acquisition fails. Distinguishes between
 * "config missing" (caller should fall back to mock) and "config present
 * but Salesforce rejected us" (caller should surface as a real error in
 * traces / logs but still degrade gracefully to the mocked path).
 */
export class SalesforceAuthError extends Error {
  readonly kind: "not-configured" | "token-request-failed" | "invalid-response";
  readonly status?: number;
  readonly bodyExcerpt?: string;

  constructor(args: {
    kind: SalesforceAuthError["kind"];
    message: string;
    status?: number;
    bodyExcerpt?: string;
  }) {
    super(args.message);
    this.name = "SalesforceAuthError";
    this.kind = args.kind;
    this.status = args.status;
    this.bodyExcerpt = args.bodyExcerpt;
  }
}

type TokenResponse = {
  access_token?: unknown;
  instance_url?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  issued_at?: unknown;
  signature?: unknown;
};

async function requestNewToken(config: SalesforceConfig): Promise<CachedToken> {
  const tokenUrl = `${config.instanceUrl}/services/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret
  });

  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: body.toString(),
      cache: "no-store"
    });
  } catch (err) {
    throw new SalesforceAuthError({
      kind: "token-request-failed",
      message: `Network error reaching Salesforce token endpoint: ${
        err instanceof Error ? err.message : String(err)
      }`
    });
  }

  const rawText = await res.text();
  if (!res.ok) {
    throw new SalesforceAuthError({
      kind: "token-request-failed",
      message: `Salesforce rejected token request (HTTP ${res.status}). See bodyExcerpt for details.`,
      status: res.status,
      bodyExcerpt: rawText.slice(0, 500)
    });
  }

  let parsed: TokenResponse;
  try {
    parsed = JSON.parse(rawText) as TokenResponse;
  } catch {
    throw new SalesforceAuthError({
      kind: "invalid-response",
      message: "Salesforce token endpoint returned non-JSON.",
      bodyExcerpt: rawText.slice(0, 500)
    });
  }

  const accessToken =
    typeof parsed.access_token === "string" ? parsed.access_token : "";
  const instanceUrlFromToken =
    typeof parsed.instance_url === "string"
      ? normalizeInstanceUrl(parsed.instance_url)
      : config.instanceUrl;
  const expiresInSeconds =
    typeof parsed.expires_in === "number" ? parsed.expires_in : 0;

  if (!accessToken) {
    throw new SalesforceAuthError({
      kind: "invalid-response",
      message: "Salesforce token response missing access_token.",
      bodyExcerpt: rawText.slice(0, 500)
    });
  }

  const lifetimeMs =
    expiresInSeconds > 0 ? expiresInSeconds * 1000 : FALLBACK_LIFETIME_MS;
  const expiresAtMs = Date.now() + lifetimeMs - EXPIRY_SAFETY_MARGIN_MS;

  return { accessToken, instanceUrlFromTokenResponse: instanceUrlFromToken, expiresAtMs };
}

/**
 * Return a valid Salesforce access token. Uses the in-memory cache if a
 * non-expired token is available; otherwise requests a fresh one. Multiple
 * concurrent callers during a cache miss share the same in-flight request
 * (deduplication via the `inflight` promise) to avoid stampeding the
 * Salesforce token endpoint.
 *
 * @throws SalesforceAuthError with `kind: "not-configured"` if env vars
 * are missing — callers should branch on `isSalesforceConfigured()` first
 * to fall back to the mocked path silently.
 */
export async function getAccessToken(): Promise<{
  accessToken: string;
  instanceUrl: string;
  apiVersion: string;
}> {
  const config = getSalesforceConfig();
  if (!config) {
    throw new SalesforceAuthError({
      kind: "not-configured",
      message:
        "Salesforce is not configured. Set SF_INSTANCE_URL, SF_CLIENT_ID, and SF_CLIENT_SECRET to enable real-org grounding."
    });
  }

  if (cachedToken && cachedToken.expiresAtMs > Date.now()) {
    return {
      accessToken: cachedToken.accessToken,
      instanceUrl: cachedToken.instanceUrlFromTokenResponse,
      apiVersion: config.apiVersion
    };
  }

  if (!inflight) {
    inflight = requestNewToken(config).finally(() => {
      inflight = null;
    });
  }

  const fresh = await inflight;
  cachedToken = fresh;
  return {
    accessToken: fresh.accessToken,
    instanceUrl: fresh.instanceUrlFromTokenResponse,
    apiVersion: config.apiVersion
  };
}

/**
 * Clear the in-memory token cache. Intended for tests and for the
 * /api/diagnostics endpoints that may want to force-refresh.
 */
export function _resetSalesforceTokenCacheForTests(): void {
  cachedToken = null;
  inflight = null;
}
