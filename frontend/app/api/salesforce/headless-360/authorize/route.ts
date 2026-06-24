/**
 * GET /api/salesforce/headless-360/authorize
 *
 * Initiate the Headless 360 OAuth Authorization Code + PKCE flow.
 *
 * Flow:
 *   1. Generate PKCE code_verifier + code_challenge (S256).
 *   2. Generate cryptographically random `state` for CSRF binding.
 *   3. Store {state, codeVerifier, postLoginPath} in an HttpOnly,
 *      Secure, SameSite=Lax, 90-second-max-age signed cookie.
 *      SameSite=Lax (not Strict) because the redirect-back is a
 *      cross-site navigation initiated by Salesforce.
 *   4. 302 to Salesforce's /services/oauth2/authorize with the
 *      External Client App's client_id, requested scopes, the
 *      generated state, and the code_challenge.
 *
 * Status:
 *   - Returns 503 when the env vars are unset (status `designed`).
 *     This keeps the route consistent with /config: callers asking
 *     for the provisioning state should hit /config; clicking
 *     "Sign in" only makes sense once activation lands.
 *   - On success, returns a 302 redirect to Salesforce.
 *
 * Query params honored:
 *   - `next` — optional relative path to redirect to after a
 *     successful callback. Defaults to "/". Must be a relative path
 *     (no scheme, no leading "//") to defeat open-redirect attacks.
 */
import { NextResponse } from "next/server";

import {
  PENDING_COOKIE_MAX_AGE_SECONDS,
  PENDING_COOKIE_NAME,
  cookieFlags,
  generateOauthState,
  generatePkceChallenge,
  generatePkceVerifier,
  getHeadless360Config,
  serializePending,
  signCookieValue
} from "../../../../../lib/salesforce-headless360";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  // Must be a path, not a URL — defeats open-redirect attacks where a
  // caller passes ?next=https://evil.example/ and we obey on callback.
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(req: Request) {
  const cfg = getHeadless360Config();
  if (!cfg) {
    return NextResponse.json(
      {
        error: "headless-360-not-configured",
        message:
          "Set SF_HEADLESS360_CLIENT_ID + SF_HEADLESS360_AUTH_BASE_URL + " +
          "SF_HEADLESS360_REDIRECT_URI + SF_HEADLESS360_SESSION_SECRET on " +
          "the deployment, then redeploy. See docs/HEADLESS_360_RUNBOOK.md."
      },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const postLoginPath = safeNextPath(url.searchParams.get("next"));

  const codeVerifier = generatePkceVerifier();
  const codeChallenge = await generatePkceChallenge(codeVerifier);
  const state = generateOauthState();

  const pending = serializePending({ state, codeVerifier, postLoginPath });
  const cookie = `${PENDING_COOKIE_NAME}=${signCookieValue(pending, cfg.sessionSecret)}; ${cookieFlags(PENDING_COOKIE_MAX_AGE_SECONDS)}`;

  const authorizeUrl = new URL(`${cfg.authBaseUrl}/services/oauth2/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", cfg.clientId);
  authorizeUrl.searchParams.set("redirect_uri", cfg.redirectUri);
  authorizeUrl.searchParams.set("scope", cfg.scopes);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  // `prompt=login` is a Salesforce-specific hint that forces an
  // interactive consent dialog even if the user has an active session.
  // We omit it by default — most flows benefit from silent re-auth.
  // Callers that want forced re-prompt can append &prompt=login to
  // the local /authorize URL and we'll surface it through; that's a
  // future polish, not part of this commit.

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: authorizeUrl.toString(),
      "Set-Cookie": cookie
    }
  });
}
