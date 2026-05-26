import { NextResponse } from "next/server";
import {
  DEMO_DATA360_PATIENT_ID,
  getGroundingContext
} from "../../../../../../lib/data-360";

/**
 * Mocked Salesforce Data 360 federated read:
 *   GET /api/data-360/patient/{id}/grounding
 *
 * Returns the longitudinal grounding bundle the Care Router fetches
 * before deciding. In production this is a Federated Query API call
 * against the Data 360 unified patient view, joining JupyterHealth
 * FHIR observations, DBDP-derived calculated insights, prior
 * Agentforce intake history, and the customer's EHR-of-record.
 *
 * The shape returned here matches the production schema so the Care
 * Router code path can swap base URLs without changes.
 */
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const grounding = getGroundingContext({
    patientId: id || DEMO_DATA360_PATIENT_ID,
    hint: {
      ageBand: searchParams.get("ageBand") ?? undefined,
      primarySymptom: searchParams.get("primarySymptom") ?? undefined,
      cycleStatus: searchParams.get("cycleStatus") ?? undefined
    }
  });

  return NextResponse.json(
    {
      meta: {
        _note:
          "Mocked Salesforce Data 360 federated read. In production this URL is replaced by a Data 360 Federated Query API call against the unified patient view; the shape stays identical.",
        _generatedBy: `next.js mock @ /api/data-360/patient/${id}/grounding`,
        _requestedPatientId: id,
        _demoPatientId: DEMO_DATA360_PATIENT_ID
      },
      grounding
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
      }
    }
  );
}
