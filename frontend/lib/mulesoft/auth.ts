/**
 * Auth0 M2M (client-credentials) bearer-token client for the live MuleSoft
 * Experience API.
 *
 * The live gateway enforces a JWT Validation policy (Auth0 RS256 / JWKS,
 * audience-validated) as of 2026-06-09 — see docs/MULESOFT_API_MANAGER_RUNBOOK.md,
 * which records that JWT Validation REPLACED the earlier Client ID Enforcement
 * policy. So Bearer-JWT is the one and only live auth scheme; the previous
 * client_id/client_secret (Basic) header fallback was removed from the live
 * clients because the JWT policy ignores it.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getMulesoftBearerToken(): Promise<string | null> {
  const clientId = process.env.AUTH0_MULESOFT_CLIENT_ID;
  const clientSecret = process.env.AUTH0_MULESOFT_CLIENT_SECRET;
  const domain = process.env.AUTH0_MULESOFT_DOMAIN;
  const audience = process.env.AUTH0_MULESOFT_AUDIENCE;

  if (!clientId || !clientSecret || !domain || !audience) return null;

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }

  const res = await fetch(`https://${domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      audience,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });

  if (!res.ok) return null;
  const json = await res.json();
  if (!json.access_token) return null;

  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ?? 86400) * 1000,
  };
  return cachedToken.value;
}

/**
 * Build the auth headers for a live MuleSoft request. Returns the Bearer-JWT
 * header when an Auth0 M2M token is available, or an empty object when Auth0
 * is not configured (the call then goes out unauthenticated and the gateway
 * answers 401, which the clients surface as graceful degradation to the mock).
 * Single-sourced here so the /health and /providers clients stay identical.
 */
export async function buildMulesoftAuthHeaders(): Promise<Record<string, string>> {
  const token = await getMulesoftBearerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Test-only: drop the cached token so a test can re-exercise the token fetch. */
export function _resetMulesoftTokenCacheForTests(): void {
  cachedToken = null;
}
