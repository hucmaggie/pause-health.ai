/**
 * GET /api/salesforce/headless-360/config
 *
 * Public-safe provisioning probe for the Salesforce Headless 360 PKCE
 * seam. Mirrors /api/agentforce/voice/config: surfaces `status` +
 * non-sensitive metadata; never leaks the External Client App id,
 * the session secret, or any tokens.
 *
 *   { "meta": { "_source": "designed"|"prototype"|"shipped" },
 *     "status": "designed"|"prototype"|"shipped",
 *     "scopes"?: "mcp_api refresh_token",
 *     "authorizeUrl"?: "/api/salesforce/headless-360/authorize" }
 *
 * The /authorize URL surfaced here is the LOCAL initiator route, not
 * the Salesforce /authorize endpoint. The client never builds PKCE
 * state itself — the route handler owns that.
 */
import { NextResponse } from "next/server";

import { toPublicConfig } from "../../../../../lib/salesforce-headless360";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const publicConfig = toPublicConfig();
  return NextResponse.json({
    meta: {
      _source: publicConfig.status,
      _doc:
        "https://github.com/hucmaggie/pause-health.ai/blob/main/docs/HEADLESS_360_RUNBOOK.md"
    },
    ...publicConfig
  });
}
