import { NextResponse } from "next/server";
import {
  coverageSummary,
  hasEbvSource,
  verifyCoverage,
  type CoverageQuery
} from "../../../../lib/benefits";
import { evaluateGovernance } from "../../../../lib/agent-fabric";

/**
 * Agentforce-facing REST alias for the Benefits & Coverage Verification (EBV)
 * agent.
 *
 *   GET /api/agentforce/benefits-verification?payer=Aetna&zip=92614
 *
 * The fabric agent proper speaks Google A2A (`POST /api/agents/
 * benefits-verification/tasks`, a JSON-RPC `tasks/send` envelope with the
 * result nested in an A2A Task). Salesforce Agentforce External Services map a
 * flat REST request/response, not an A2A envelope — so this thin alias exposes
 * the SAME deterministic verification (`verifyCoverage`) and the SAME governance
 * gate as a plain GET that returns the flat CoverageBenefitResult summary.
 *
 * It is a pure re-use of lib/benefits.ts — no new business logic — so the
 * Agentforce action and the A2A agent can never diverge. Synthetic data only;
 * NOT a real 270/271 EDI transaction or FHIR CoverageEligibilityResponse.
 *
 * Registered in Salesforce as the External Service `PauseBenefitsVerification`
 * (see salesforce/external-services/pause-benefits-verification.oas.yaml).
 */

const FABRIC_AGENT_ID = "benefits-verification-agent";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const payer = searchParams.get("payer") ?? undefined;
  const memberId = searchParams.get("memberId") ?? undefined;
  const zipRaw = searchParams.get("zip") ?? undefined;
  const patientZip = zipRaw && /^\d{3,5}$/.test(zipRaw) ? zipRaw : undefined;
  const serviceType = searchParams.get("serviceType") ?? undefined;

  const query: CoverageQuery = { payer, memberId, patientZip, serviceType };
  const result = verifyCoverage(query);

  // Same honest signals + governance gate the A2A /tasks route enforces:
  // the result must trace to a (mock) EBV source, and coverage verification is
  // consent-gated like grounding. ?consent=false lets a caller exercise the
  // block path; consent is assumed present otherwise.
  const tracesToSource = hasEbvSource(result);
  const hasConsent = searchParams.get("consent") !== "false";

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      eligibilityTracesToSource: tracesToSource,
      hasAiDecisionSupportConsent: hasConsent
    }
  });

  if (governance.decision === "block") {
    return NextResponse.json(
      {
        blocked: true,
        decision: "block",
        violations: governance.blockingViolations.map((v) => ({
          policyId: v.policyId,
          reason: v.reason
        })),
        _note:
          "Pause Agent Fabric blocked this coverage verification. Synthetic EBV; see the A2A agent at /api/agents/benefits-verification."
      },
      {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }
    );
  }

  const summary = coverageSummary(result);

  return NextResponse.json(
    {
      ...summary,
      synthetic: true,
      _note:
        "Synthetic deterministic EBV — NOT a real 270/271 EDI transaction or FHIR CoverageEligibilityResponse. Agentforce alias for the A2A benefits-verification agent."
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
      }
    }
  );
}
