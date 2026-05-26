import { NextResponse } from "next/server";
import {
  DEMO_PATIENT_ID,
  buildPatientTimelineBundle
} from "../../../../../../lib/mulesoft-mocks";

/**
 * Mocked Pause-Health.ai Experience API:
 *   GET /api/mulesoft/patient/{id}/timeline
 *
 * Production equivalent: MuleSoft Experience API
 *   `pause-patient-bundle-process-api`
 * on Anypoint Runtime Fabric / CloudHub 2.0.
 *
 * The MCP server (mcp/) exposes this as the `get_patient_timeline`
 * tool. Today the demo cohort only contains a single synthetic
 * patient -- requests for any other id transparently return the
 * demo bundle so MCP clients always get a usable response.
 */
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const requestedId = id || DEMO_PATIENT_ID;
  const bundle = buildPatientTimelineBundle(requestedId);

  const meta = {
    _note:
      "Mocked Pause-Health.ai Experience API. Production equivalent is the MuleSoft pause-patient-bundle-process-api. The demo cohort only contains one synthetic patient; all ids resolve to the same shape.",
    _generatedBy: `next.js mock @ /api/mulesoft/patient/${requestedId}/timeline`,
    _requestedPatientId: requestedId,
    _demoPatientId: DEMO_PATIENT_ID,
    _idAliased: requestedId !== DEMO_PATIENT_ID,
    _bundleEntries: bundle.entry.length,
    _mcpToolEquivalent: "get_patient_timeline"
  };

  return NextResponse.json(
    { meta, bundle },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
      }
    }
  );
}
