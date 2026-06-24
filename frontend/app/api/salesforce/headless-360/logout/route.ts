/**
 * POST /api/salesforce/headless-360/logout
 *
 * Clears the Pause-side session cookies. Does NOT call Salesforce's
 * /services/oauth2/revoke — revoking the refresh token globally is
 * a bigger action (kills the user's session across every Pause
 * deployment they have a cookie for) and we prefer to keep it
 * scoped to the cookie in this browser. A future polish can add
 * `?revoke=1` for callers that want the harder logout.
 *
 * Returns 200 with `{ ok: true }` always — clearing a cookie that
 * doesn't exist is a no-op, not an error.
 */
import { NextResponse } from "next/server";

import {
  PENDING_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearedCookieFlags
} from "../../../../../lib/salesforce-headless360";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; ${clearedCookieFlags()}`
  );
  headers.append(
    "Set-Cookie",
    `${PENDING_COOKIE_NAME}=; ${clearedCookieFlags()}`
  );
  return NextResponse.json({ ok: true }, { headers });
}
