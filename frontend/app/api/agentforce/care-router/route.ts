import { NextResponse } from "next/server";
import { scriptedRoute, type IntakeRecord } from "../../../../lib/care-router";
import { evaluateGovernance } from "../../../../lib/agent-fabric";

/**
 * Agentforce-facing REST alias for the Care Router agent.
 *
 *   GET /api/agentforce/care-router?primarySymptom=vasomotor&severity=moderate&redFlagsAcknowledged=no&cycleStatus=perimenopause
 *
 * The fabric Care Router proper speaks Google A2A (`POST /api/agents/
 * care-router/tasks`) and is Claude-backed with a deterministic scripted
 * fallback. Salesforce Agentforce External Services map a flat REST
 * request/response, so this alias uses the DETERMINISTIC `scriptedRoute`
 * engine (no Claude/MCP dependency — pure, reproducible) and the SAME Agent
 * Fabric governance gate (mandatory red-flag screen, allow-listed model,
 * rationale required). It returns the flat routing decision.
 *
 * It is a pure re-use of lib/care-router.ts — no new business logic — so the
 * Agentforce action and the A2A agent share the same scripted routing rules.
 * Synthetic/advisory: this recommends a care pathway with rationale; it does
 * NOT prescribe or commit any clinical action (enforced by the fabric). Provider
 * recommendations (which need the async MCP provider lookup) are out of scope
 * for this flat alias — pair with the Appointment Scheduling agent to book.
 *
 * Registered in Salesforce as the External Service `PauseCareRouter`
 * (see salesforce/external-services/pause-care-router.oas.yaml).
 */

const FABRIC_AGENT_ID = "care-router-claude";
// The scripted engine's provenance model — the allow-listed clinical model the
// fabric's model-allow-list policy accepts (same value the A2A route sends).
const ROUTER_MODEL =
  process.env.PAUSE_CARE_ROUTER_MODEL ?? "claude-sonnet-4-5-20250929";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const g = (k: string) => {
    const v = searchParams.get(k);
    return v && v.trim().length > 0 ? v.trim() : undefined;
  };

  const intake: IntakeRecord = {
    preferredName: g("preferredName"),
    ageBand: g("ageBand"),
    cycleStatus: g("cycleStatus"),
    primarySymptom: g("primarySymptom"),
    severity: g("severity"),
    // The red-flag screen is mandatory — the agent must ask it before routing.
    redFlagsAcknowledged: g("redFlagsAcknowledged"),
    patientZip: g("patientZip"),
    patientInsurance: g("patientInsurance")
  };

  // Same governance signals the A2A route enforces: the intake MUST carry a
  // red-flag screen, the model must be allow-listed, and every decision carries
  // a rationale. A missing red-flag screen is blocked (the agent has to ask).
  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      hasRedFlagScreen: intake.redFlagsAcknowledged !== undefined,
      requestedModel: ROUTER_MODEL,
      hasRationaleField: true
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
          "Pause Agent Fabric blocked this routing (e.g. no red-flag screen was completed). The agent must ask the mandatory red-flag question before routing. See the A2A agent at /api/agents/care-router."
      },
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  const decision = scriptedRoute(intake);

  return NextResponse.json(
    {
      pathway: decision.pathway,
      pathwayLabel: decision.pathwayLabel,
      acuity: decision.acuity,
      rationale: decision.rationale,
      redFlagsTriggered: decision.redFlagsTriggered,
      recommendedTargetResponse: decision.recommendedTargetResponse,
      modelProvider: decision.modelProvenance.provider,
      synthetic: true,
      _note:
        "Deterministic scripted care-pathway recommendation with rationale — advisory only, NOT a diagnosis or prescription; a clinician decides. Agentforce alias for the A2A care-router agent (uses the scripted engine, not live Claude)."
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
      }
    }
  );
}
