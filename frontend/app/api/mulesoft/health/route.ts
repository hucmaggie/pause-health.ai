import { NextResponse } from "next/server";
import { buildPatientTimelineBundle } from "../../../../lib/mulesoft-mocks";

/**
 * Mocked Pause-Health.ai Experience-tier endpoint.
 *
 * In production, this URL is served by the MuleSoft Experience API
 * `pause-patient-bundle-process-api` running on the customer's
 * Anypoint Runtime Fabric or CloudHub 2.0. The Pause clinician web
 * app and the Pause backend both call it instead of talking to
 * JupyterHealth Exchange or the DBDP feature worker directly.
 *
 * The response is a FHIR R5 Bundle. The bundle generator is shared
 * with `/api/mulesoft/patient/[id]/timeline` and with the Pause MCP
 * server under `mcp/` -- see frontend/lib/mulesoft-mocks.ts.
 *
 * This route stays at `/api/mulesoft/health` for backwards compatibility
 * (the demo URL is linked from /proposal/mulesoft, README, and docs) and
 * also doubles as a liveness check for the mocked Experience API.
 *
 * Cache for 5 minutes -- the payload is deterministic, no need to
 * recompute on every request.
 */

const FHIR_BUNDLE = buildPatientTimelineBundle();

const META = {
  _note:
    "Mocked Pause-Health.ai Experience API. In production this URL is served by the MuleSoft pause-patient-bundle-process-api on Anypoint Runtime Fabric / CloudHub 2.0. See docs/mulesoft-integration.md.",
  _generatedBy: "next.js mock @ /api/mulesoft/health",
  _bundleEntries: FHIR_BUNDLE.entry.length,
  _mcpToolEquivalent: "get_patient_timeline"
};

export async function GET() {
  return NextResponse.json(
    { meta: META, bundle: FHIR_BUNDLE },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
      }
    }
  );
}
