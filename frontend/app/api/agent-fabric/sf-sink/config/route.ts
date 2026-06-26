/**
 * GET /api/agent-fabric/sf-sink/config
 *
 * Public-safe provisioning probe for the Salesforce Platform Event
 * sink (audit gap #3). Mirrors the other Headless-360-family config
 * routes: surfaces `status` + non-sensitive metadata + the per-
 * process emit counters; never leaks clientId, clientSecret, or
 * baseUrl.
 *
 *   {
 *     "meta": { "_source": "designed"|"prototype"|"shipped" },
 *     "status": "designed"|"prototype"|"shipped",
 *     "eventApiName"?: "Pause_Agent_Trace__e",
 *     "apiVersion"?: "v60.0",
 *     "counters": { attempted, succeeded, failed, lastError }
 *   }
 *
 * counters is always present so an operator can curl this endpoint
 * after wiring the env vars to confirm spans are flowing (attempted
 * climbs every time recordSpan runs; succeeded climbs on a clean
 * 201 from Salesforce; failed climbs + lastError populates when
 * Salesforce rejects).
 */
import { NextResponse } from "next/server";

import { toPublicConfig } from "../../../../../lib/salesforce-platform-event-sink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const publicConfig = toPublicConfig();
  return NextResponse.json({
    meta: {
      _source: publicConfig.status,
      _doc:
        "https://github.com/hucmaggie/pause-health.ai/blob/main/docs/SF_PLATFORM_EVENT_SINK_RUNBOOK.md"
    },
    ...publicConfig
  });
}
