import { NextResponse } from "next/server";
import {
  DEMO_DATA360_PATIENT_ID,
  getFederatedRecord
} from "../../../../../../lib/data-360";

/**
 * Mocked Salesforce Data 360 federated patient record:
 *   GET /api/data-360/patient/{id}/record
 *
 * Returns the full unified record (profile + IR + calculated
 * insights + longitudinal observations + cohort + consents + active
 * segments). This is what a Patient 360 surface in Salesforce
 * Health Cloud would render.
 *
 * Linked from /demo/agent-fabric so an investor / reviewer can open
 * the federated record JSON for any traced task in one click.
 */
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const record = getFederatedRecord(id || DEMO_DATA360_PATIENT_ID);

  return NextResponse.json(
    {
      meta: {
        _note:
          "Mocked Salesforce Data 360 federated patient record. Production deployments serve this via the Data 360 Patient 360 view federated across JupyterHealth FHIR, DBDP features, Agentforce intake history, and the customer's EHR-of-record.",
        _generatedBy: `next.js mock @ /api/data-360/patient/${id}/record`,
        _requestedPatientId: id,
        _demoPatientId: DEMO_DATA360_PATIENT_ID
      },
      record
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
      }
    }
  );
}
