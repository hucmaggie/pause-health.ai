import { NextResponse } from "next/server";
import { DEMO_DATA360_PATIENT_ID } from "../../../../../../lib/data-360";
import { getGroundingContextPreferReal } from "../../../../../../lib/salesforce/grounding";
import { isSalesforceConfigured } from "../../../../../../lib/salesforce/auth";

/**
 * Salesforce Data 360 federated read:
 *   GET /api/data-360/patient/{id}/grounding
 *
 * Returns the longitudinal grounding bundle the Care Router fetches
 * before deciding.
 *
 * Dual-mode:
 *   - If SF_* env vars are set AND the requested patient id matches a
 *     seeded Pause Demo Contact in the org, returns REAL grounding built
 *     from Health Cloud objects (Contact + CareProgramEnrollee + CarePlan
 *     + Case). The response meta reports `_source: "real"`.
 *   - Otherwise returns the deterministic mock and reports
 *     `_source: "mock"`. Identical shape either way, so the Care Router
 *     and trace UI don't branch.
 */
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const { source, grounding } = await getGroundingContextPreferReal({
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
        _source: source,
        _salesforceConfigured: isSalesforceConfigured(),
        _note:
          source === "real"
            ? "Live grounding built from your Salesforce Health Cloud org (Phase 1: Contact + CareProgramEnrollee + CarePlan + Case). Federation of wearable/EHR signals lands in Phase 2 (Data Cloud)."
            : "Deterministic mock. Set SF_INSTANCE_URL / SF_CLIENT_ID / SF_CLIENT_SECRET to enable real-org grounding. Shape is identical to the live path.",
        _generatedBy: `next.js @ /api/data-360/patient/${id}/grounding`,
        _requestedPatientId: id,
        _demoPatientId: DEMO_DATA360_PATIENT_ID
      },
      grounding
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // Real-org responses are user-specific; don't allow shared edge caches
        // to serve one patient's grounding for another's request. Mock can
        // stay cacheable since it's deterministic per patientId+hint.
        "Cache-Control":
          source === "real"
            ? "private, no-store"
            : "public, s-maxage=60, stale-while-revalidate=300"
      }
    }
  );
}
