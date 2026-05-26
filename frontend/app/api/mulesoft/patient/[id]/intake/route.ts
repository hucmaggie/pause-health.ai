import { NextResponse } from "next/server";
import {
  DEMO_PATIENT_ID,
  buildPatientIntakeRecord
} from "../../../../../../lib/mulesoft-mocks";

/**
 * Mocked Pause-Health.ai Experience API:
 *   GET /api/mulesoft/patient/{id}/intake
 *
 * Production equivalent: MuleSoft Process API
 *   `pause-intake-process-api`
 * which persists the structured record produced by the Salesforce
 * Agentforce Service Agent (or the local Agentforce-style fallback)
 * into the customer's clinical system of record.
 *
 * The MCP server (mcp/) exposes this as the `get_patient_intake` tool.
 */
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const requestedId = id || DEMO_PATIENT_ID;
  const record = buildPatientIntakeRecord(requestedId);

  const meta = {
    _note:
      "Mocked Pause-Health.ai Experience API for structured intake records produced by Agentforce. The demo cohort only contains one synthetic patient; all ids resolve to the same shape.",
    _generatedBy: `next.js mock @ /api/mulesoft/patient/${requestedId}/intake`,
    _requestedPatientId: requestedId,
    _demoPatientId: DEMO_PATIENT_ID,
    _idAliased: requestedId !== DEMO_PATIENT_ID,
    _mcpToolEquivalent: "get_patient_intake"
  };

  return NextResponse.json(
    { meta, intake: record },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
      }
    }
  );
}
