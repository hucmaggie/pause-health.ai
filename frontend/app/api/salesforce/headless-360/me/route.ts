/**
 * GET /api/salesforce/headless-360/me
 *
 * Returns the signed-in Salesforce user's identity by calling
 * Salesforce's `/services/oauth2/userinfo` with the session's access
 * token. Useful for:
 *
 *   - The /proposal/headless-360 page to show "Signed in as ..."
 *     after activation.
 *   - Any future agent call that needs to know whose token it's
 *     carrying (Care Router under user identity, MCP tool calls
 *     attributed to a Salesforce user).
 *
 * Behavior:
 *   - 503 when the env vars are unset (status `designed`).
 *   - 401 with `{ error: "not-signed-in" }` when no valid session
 *     cookie is present.
 *   - 401 with `{ error: "session-expired" }` when the cookie is
 *     present but the access token is past `expiresAt`. Caller
 *     should redirect to /api/salesforce/headless-360/authorize to
 *     get a fresh session.
 *   - 200 with the userinfo payload otherwise. Includes a `meta`
 *     block that surfaces `expiresAt` so the client can refresh
 *     proactively.
 */
import { NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  getHeadless360Config,
  parseSession,
  verifyCookieValue
} from "../../../../../lib/salesforce-headless360";

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

export async function GET(req: Request) {
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
  if (session.expiresAt <= Date.now()) {
    return NextResponse.json(
      { error: "session-expired", expiresAt: session.expiresAt },
      { status: 401 }
    );
  }

  // Salesforce's /services/oauth2/userinfo accepts the access token
  // as a bearer credential and returns a small identity payload
  // (preferred_username, name, email, sub which is the identity URL,
  // organization_id, user_id, ...).
  let userinfo: Record<string, unknown> = {};
  try {
    const res = await fetch(
      `${session.instanceUrl}/services/oauth2/userinfo`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          Accept: "application/json"
        }
      }
    );
    if (res.ok) {
      userinfo = (await res.json()) as Record<string, unknown>;
    } else {
      // 401 here typically means the token was revoked in the org;
      // surface it but don't break the response shape — clients can
      // still see `meta.expiresAt` and choose to redirect to
      // /authorize themselves.
      userinfo = { _userinfo_error: `${res.status} ${res.statusText}` };
    }
  } catch (err) {
    userinfo = { _userinfo_error: (err as Error).message };
  }

  return NextResponse.json({
    meta: {
      expiresAt: session.expiresAt,
      instanceUrl: session.instanceUrl,
      identityUrl: session.identityUrl
    },
    user: userinfo
  });
}
