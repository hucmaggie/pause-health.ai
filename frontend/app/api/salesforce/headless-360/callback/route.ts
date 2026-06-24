/**
 * GET /api/salesforce/headless-360/callback
 *
 * OAuth Authorization Code + PKCE redirect handler.
 *
 * Salesforce redirects the browser here with `?code=...&state=...`
 * after the user consents. We:
 *
 *   1. Read + verify the `pause_h360_pending` cookie set by
 *      /authorize. If missing or tampered, refuse.
 *   2. Verify the returned `state` equals the cookie's state.
 *      Defeats CSRF by binding callback to the originating /authorize.
 *   3. POST to Salesforce's /services/oauth2/token with
 *      grant_type=authorization_code + the stored code_verifier,
 *      the External Client App client_id (no client_secret — PKCE
 *      replaces it), the redirect_uri, and the received code.
 *   4. Optionally call /services/oauth2/userinfo to populate the
 *      `identityUrl` on the session. Best-effort; on failure the
 *      session still lands and /me will retry.
 *   5. Store {accessToken, refreshToken, instanceUrl, expiresAt,
 *      identityUrl} in a signed cookie. Clear the pending cookie.
 *   6. 302 to the originally-requested `postLoginPath` (default "/").
 */
import { NextResponse } from "next/server";

import {
  PENDING_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  clearedCookieFlags,
  cookieFlags,
  getHeadless360Config,
  parsePending,
  serializeSession,
  signCookieValue,
  verifyCookieValue,
  type Headless360Session
} from "../../../../../lib/salesforce-headless360";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const parts = header.split(/;\s*/);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

async function exchangeCodeForToken(args: {
  authBaseUrl: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<Headless360Session> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    code: args.code,
    code_verifier: args.codeVerifier
  });
  const res = await fetch(`${args.authBaseUrl}/services/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Salesforce token exchange failed: ${res.status} ${res.statusText} ${text.slice(0, 200)}`
    );
  }
  const payload = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    instance_url?: string;
    issued_at?: string;
    // Salesforce returns "id" (identity URL), not "sub". userinfo
    // returns "sub". We persist the identity URL from the token
    // response when available.
    id?: string;
    // Lifetime in seconds. Salesforce defaults to 7200 (2h).
    expires_in?: string;
  };
  if (!payload.access_token || !payload.instance_url) {
    throw new Error(
      `Salesforce token response missing access_token or instance_url: ${text.slice(0, 200)}`
    );
  }
  const lifetimeSec = payload.expires_in
    ? parseInt(payload.expires_in, 10)
    : 7200;
  return {
    instanceUrl: payload.instance_url.replace(/\/+$/, ""),
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + lifetimeSec * 1000,
    identityUrl: payload.id
  };
}

export async function GET(req: Request) {
  const cfg = getHeadless360Config();
  if (!cfg) {
    return NextResponse.json(
      { error: "headless-360-not-configured" },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  // Salesforce surfaces consent denial / app-rejection as
  // ?error=access_denied&error_description=... — propagate the
  // message verbatim so the user can see what happened.
  if (errorParam) {
    return NextResponse.json(
      {
        error: "authorization-failed",
        upstream_error: errorParam,
        upstream_error_description: errorDesc
      },
      {
        status: 400,
        headers: { "Set-Cookie": `${PENDING_COOKIE_NAME}=; ${clearedCookieFlags()}` }
      }
    );
  }
  if (!code || !stateParam) {
    return NextResponse.json(
      {
        error: "missing-code-or-state",
        message:
          "Salesforce returned without a `code` or `state` query parameter — the redirect is malformed."
      },
      { status: 400 }
    );
  }

  const rawPending = readCookie(req, PENDING_COOKIE_NAME);
  const verified = rawPending
    ? verifyCookieValue(rawPending, cfg.sessionSecret)
    : null;
  const pending = parsePending(verified);
  if (!pending) {
    return NextResponse.json(
      {
        error: "missing-pending-cookie",
        message:
          "The pending-authorization cookie is missing or tampered. Start the sign-in from /api/salesforce/headless-360/authorize again."
      },
      { status: 400 }
    );
  }
  if (pending.state !== stateParam) {
    return NextResponse.json(
      {
        error: "state-mismatch",
        message:
          "The returned `state` does not match the originating /authorize state. Refusing to exchange the code."
      },
      { status: 400 }
    );
  }

  let session: Headless360Session;
  try {
    session = await exchangeCodeForToken({
      authBaseUrl: cfg.authBaseUrl,
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      code,
      codeVerifier: pending.codeVerifier
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "token-exchange-failed",
        message: (err as Error).message
      },
      { status: 502 }
    );
  }

  const sessionCookie = `${SESSION_COOKIE_NAME}=${signCookieValue(serializeSession(session), cfg.sessionSecret)}; ${cookieFlags(SESSION_COOKIE_MAX_AGE_SECONDS)}`;
  const clearPending = `${PENDING_COOKIE_NAME}=; ${clearedCookieFlags()}`;

  // Honor the originally-requested post-login path. Already
  // sanitized by /authorize (must be a relative path), but
  // double-check the invariant here so a tampered cookie can't open
  // a redirect.
  const postLogin = pending.postLoginPath.startsWith("/") &&
    !pending.postLoginPath.startsWith("//")
    ? pending.postLoginPath
    : "/";

  return new NextResponse(null, {
    status: 302,
    headers: new Headers([
      ["Location", postLogin],
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", clearPending]
    ])
  });
}
