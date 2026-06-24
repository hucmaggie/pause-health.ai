/**
 * GET /api/agentforce/voice/config
 *
 * Returns the public-safe Agentforce Voice provisioning status for
 * the current Vercel deployment, so the client-side voice button
 * can decide whether to mount the CCaaS partner SDK or fall back to
 * the "designed" affordance.
 *
 *   {
 *     "meta": { "_source": "designed" | "prototype" | "shipped" },
 *     "status": "designed" | "prototype" | "shipped",
 *     "provider"?: "amazon-connect" | "five9" | "nice" | "vonage",
 *     "agentDeployment"?: string,
 *     "language"?: string
 *   }
 *
 * Intentionally omits `baseUrl` and `deploymentRef` — both are
 * partner-side opaque identifiers a third party could use to initiate
 * a session against the CCaaS instance. The client SDK handshake
 * derives the endpoint URL from short-lived cookies + STS tokens
 * minted by the CCaaS partner during signed-URL exchange (per Amazon
 * Connect Streams docs), so the raw values don't belong here.
 *
 * Pinned to runtime='nodejs' so process.env behaves as expected
 * across providers; pinned to dynamic='force-dynamic' so a deploy
 * that adds the env vars doesn't serve a stale `designed` response.
 */
import { NextResponse } from "next/server";

import { toPublicConfig } from "../../../../../lib/agentforce-voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const publicConfig = toPublicConfig();
  return NextResponse.json({
    meta: {
      _source: publicConfig.status,
      _doc: "https://github.com/hucmaggie/pause-health.ai/blob/main/docs/AGENTFORCE_VOICE_RUNBOOK.md"
    },
    ...publicConfig
  });
}
