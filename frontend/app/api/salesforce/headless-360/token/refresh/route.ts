/**
 * POST /api/salesforce/headless-360/token/refresh
 *
 * Exchanges the current session's refresh_token for a fresh
 * access_token. Updates the session cookie in place.
 *
 * Behavior:
 *   - 503 when env vars unset.
 *   - 401 when no session cookie / no refresh_token on the session.
 *   - 502 when Salesforce refuses the refresh (token revoked, scope
 *     no longer granted, etc.). The session cookie is CLEARED on
 *     this path so the client can cleanly re-authenticate.
 *   - 200 with `{ meta: { expiresAt } }` when the refresh succeeds.
 *     The new access token is written to the cookie; the response
 *     body never contains the token (cookies are the carrier).
 *
 * POST (not GET) because this mutates server-side state (cookie)
 * and we don't want it to be a casual link-prefetch target.
 */
import { NextResponse } from "next/server";

import {
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  clearedCookieFlags,
  cookieFlags,
  getHeadless360Config,
  parseSession,
  serializeSession,
  signCookieValue,
  verifyCookieValue,
  type Headless360Session
} from "../../../../../../lib/salesforce-headless360";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

export async function POST(req: Request) {
  const cfg = getHeadless360Config();
  if (!cfg) {
    return NextResponse.json(
      { error: "headless-360-not-configured" },
      { status: 503 }
    );
  }

  const raw = readCookie(req, SESSION_COOKIE_NAME);
  const verified = raw ? verifyCookieValue(raw, cfg.sessionSecret) : null;
  const session = parseSession(verified);
  if (!session) {
    return NextResponse.json(
      { error: "not-signed-in" },
      { status: 401 }
    );
  }
  if (!session.refreshToken) {
    // Most likely cause: the External Client App wasn't granted the
    // `refresh_token` scope. Caller should redirect to /authorize.
    return NextResponse.json(
      { error: "no-refresh-token-on-session" },
      { status: 401 }
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: cfg.clientId,
    refresh_token: session.refreshToken
  });
  const res = await fetch(`${cfg.authBaseUrl}/services/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    // Salesforce surfaces revoked/expired refresh tokens with 4xx.
    // Clear the session cookie so the client doesn't keep retrying
    // a dead refresh.
    return NextResponse.json(
      {
        error: "refresh-failed",
        upstream_status: res.status,
        upstream_body: text.slice(0, 200)
      },
      {
        status: 502,
        headers: { "Set-Cookie": `${SESSION_COOKIE_NAME}=; ${clearedCookieFlags()}` }
      }
    );
  }
  const payload = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    instance_url?: string;
    expires_in?: string;
    id?: string;
  };
  if (!payload.access_token) {
    return NextResponse.json(
      { error: "refresh-response-missing-access-token" },
      { status: 502 }
    );
  }
  const lifetimeSec = payload.expires_in
    ? parseInt(payload.expires_in, 10)
    : 7200;
  const newSession: Headless360Session = {
    instanceUrl: (payload.instance_url ?? session.instanceUrl).replace(
      /\/+$/,
      ""
    ),
    accessToken: payload.access_token,
    // Salesforce may or may not return a rotated refresh_token on
    // refresh. Prefer the new one when present, otherwise keep the
    // existing one.
    refreshToken: payload.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + lifetimeSec * 1000,
    identityUrl: payload.id ?? session.identityUrl
  };
  const cookie = `${SESSION_COOKIE_NAME}=${signCookieValue(serializeSession(newSession), cfg.sessionSecret)}; ${cookieFlags(SESSION_COOKIE_MAX_AGE_SECONDS)}`;
  return NextResponse.json(
    { meta: { expiresAt: newSession.expiresAt, instanceUrl: newSession.instanceUrl } },
    { status: 200, headers: { "Set-Cookie": cookie } }
  );
}
