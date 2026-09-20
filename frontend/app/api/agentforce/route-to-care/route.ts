import { NextResponse } from "next/server";
import { scriptedRoute, type IntakeRecord } from "../../../../lib/care-router";
import {
  coverageQueryFromIntake,
  coverageSummary,
  verifyCoverage
} from "../../../../lib/benefits";
import {
  bookAppointment,
  bookingSummary,
  modalityForPathway,
  type Modality
} from "../../../../lib/scheduling";
import {
  draftCommunityReferralsForResult,
  isAllowlistedSdohScreener,
  screenSocialNeeds,
  type SdohScreener,
  type SdohScreeningResponse
} from "../../../../lib/sdoh";
import { evaluateGovernance, recordInstantSpan } from "../../../../lib/agent-fabric";
import { newTaskId } from "../../../../lib/a2a";

/**
 * Agentforce-facing REST alias that CHAINS the Pause Health Intake Agent into
 * the specialist agents in one call — the single handoff action the Intake
 * Agent invokes once it has captured the mandatory red-flag screen and the
 * patient's top symptom.
 *
 *   GET /api/agentforce/route-to-care?primarySymptom=vasomotor&severity=moderate
 *       &cycleStatus=perimenopause&redFlagsAcknowledged=no
 *       &patientInsurance=Aetna&patientZip=92614
 *       &book=true&verifyCoverage=true&screenSdoh=housing:1,1;food:0,0&sdohConsent=true
 *
 * WHY THIS EXISTS (the chaining problem):
 *   The Intake Agent lives in Salesforce Agentforce. Its subagents can only
 *   reach the Pause fabric through flat External Service actions (it already
 *   has one: PauseProviderDirectory.findMenopauseProviders). A single unified
 *   "concierge" that puts all 5 specialists under one Agent Router was tried
 *   and abandoned — the Service Agent template's platform Inappropriate-Content
 *   classifier mis-fires on benign coverage/billing questions once many
 *   subagents share one router (see AGENTFORCE_CONCIERGE_BUILD_SHEET.md). So we
 *   chain DETERMINISTICALLY instead: the Intake Agent captures intake, then
 *   calls THIS one action, which fans out to the specialists in a fixed,
 *   auditable order. Each specialist stays narrow-scoped (guardrail-safe); the
 *   orchestration lives in the fabric, not in an overloaded LLM router.
 *
 * WHAT IT CHAINS (deterministic, same libs as the standalone aliases):
 *   1. Care Router      — scriptedRoute() gives the pathway + acuity (always).
 *   2. Benefits (EBV)   — verifyCoverage() when verifyCoverage=true OR the
 *                         intake carries patientInsurance.
 *   3. Appointment      — bookAppointment() when book=true AND the pathway is
 *                         an MSCP visit (books against the synthetic calendar).
 *   4. SDOH Screening   — screenSocialNeeds() when a screener vector is given;
 *                         a positive interpersonal-safety screen is a mandatory
 *                         human-social-worker escalation, referrals consent-gated.
 *
 * Every step is a child span under one shared taskId, so /demo/agent-fabric?
 * taskId=<id> renders the whole intake→specialist chain as one correlated
 * trace — the same Fabric-trace story as the server-side POST orchestrator at
 * /api/intake/route-to-care-router, exposed as the flat GET an Agentforce
 * External Service can map.
 *
 * Pure re-use of the deterministic domain libs — no new business logic, no
 * Claude/MCP dependency. Synthetic/advisory: recommends a pathway, a synthetic
 * cost estimate, and a synthetic booking; it does NOT prescribe or commit any
 * real clinical/financial action (enforced by the fabric governance gate).
 *
 * Registered in Salesforce as the External Service `PauseRouteToCare`
 * (see salesforce/external-services/pause-route-to-care.oas.yaml), added to the
 * Intake Agent's "Menopause Symptom Intake" subagent as `handoffToCareRouter`.
 */

const CARE_ROUTER_AGENT_ID = "care-router-claude";
const ROUTER_MODEL =
  process.env.PAUSE_CARE_ROUTER_MODEL ?? "claude-sonnet-4-5-20250929";

/** Parse a comma-separated integer vector, or undefined if absent/malformed. */
function parseVec(v: string | undefined): number[] | undefined {
  if (v === undefined || v.trim().length === 0) return undefined;
  const parts = v.split(",").map((s) => Number(s.trim()));
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  return parts.map((n) => Math.trunc(n));
}

/**
 * Parse the flat `screenSdoh` param into coded domain vectors. Shape:
 *   "housing:1,1;food:0,0;safety:1,1,1,1"
 * so the Agentforce action can pass a whole AHC-HRSN screen as one string.
 */
function parseSdohResponses(v: string | undefined): SdohScreeningResponse["responses"] | undefined {
  if (v === undefined || v.trim().length === 0) return undefined;
  const responses: SdohScreeningResponse["responses"] = {};
  for (const domain of v.split(";")) {
    const [id, vec] = domain.split(":");
    if (!id || !vec) continue;
    const parsed = parseVec(vec);
    if (parsed) {
      (responses as Record<string, number[]>)[id.trim()] = parsed;
    }
  }
  return Object.keys(responses).length > 0 ? responses : undefined;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const g = (k: string) => {
    const v = searchParams.get(k);
    return v && v.trim().length > 0 ? v.trim() : undefined;
  };
  const flag = (k: string) => searchParams.get(k) === "true";

  const intake: IntakeRecord = {
    preferredName: g("preferredName"),
    ageBand: g("ageBand"),
    cycleStatus: g("cycleStatus"),
    primarySymptom: g("primarySymptom"),
    severity: g("severity"),
    // The red-flag screen is mandatory — the Intake Agent must ask it before
    // it calls this handoff (single yes/no, per the clinical-guardrail pattern).
    redFlagsAcknowledged: g("redFlagsAcknowledged"),
    patientZip: g("patientZip"),
    patientInsurance: g("patientInsurance")
  };

  // One trace correlation key for the whole chain — every downstream specialist
  // span hangs off the intake span so the fabric renders a single tree.
  const taskId = newTaskId("intake-to-care");

  // ── Governance gate (same signals the Care Router A2A route + flat alias
  //    enforce): a routing decision requires a completed red-flag screen, an
  //    allow-listed model, and a rationale field. A missing screen is blocked —
  //    the agent has to ask the yes/no safety question before handing off.
  const governance = evaluateGovernance({
    agentId: CARE_ROUTER_AGENT_ID,
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
        taskId,
        violations: governance.blockingViolations.map((v) => ({
          policyId: v.policyId,
          reason: v.reason
        })),
        _note:
          "Pause Agent Fabric blocked the handoff (no red-flag screen was completed). The Intake Agent must ask the mandatory yes/no safety question before routing to care. See AGENTFORCE_INTAKE_CHAINING_RUNBOOK.md."
      },
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  const intakeSpan = recordInstantSpan({
    taskId,
    agentId: "agentforce-intake",
    operation: "intake.complete",
    protocol: "rest",
    attributes: {
      capturedFields: Object.values(intake).filter((v) => v !== undefined).length,
      redFlag: intake.redFlagsAcknowledged === "yes",
      primarySymptom: intake.primarySymptom,
      severity: intake.severity,
      origin: "agentforce-chat"
    }
  });

  // ── 1. Care Router (always) — the deterministic pathway decision.
  const decision = scriptedRoute(intake);
  const routerSpan = recordInstantSpan({
    taskId,
    parentSpanId: intakeSpan.id,
    agentId: CARE_ROUTER_AGENT_ID,
    operation: "care-router.route",
    protocol: "rest",
    attributes: {
      pathway: decision.pathway,
      acuity: decision.acuity,
      redFlagsTriggered: decision.redFlagsTriggered,
      synthetic: true
    }
  });

  const chained: string[] = ["care-router"];

  // ── 2. Benefits / EBV — when explicitly requested or the intake carries a payer.
  let coverage: Record<string, unknown> | undefined;
  if (flag("verifyCoverage") || intake.patientInsurance) {
    try {
      const summary = coverageSummary(verifyCoverage(coverageQueryFromIntake(intake)));
      recordInstantSpan({
        taskId,
        parentSpanId: routerSpan.id,
        agentId: "benefits-verification-agent",
        operation: "benefits.verify",
        protocol: "rest",
        attributes: {
          payer: summary.payerName,
          eligibilityStatus: summary.eligibilityStatus,
          network: summary.network,
          estimatedPatientResponsibility: summary.estimatedPatientResponsibility,
          sourced: summary.sourced,
          synthetic: true
        }
      });
      coverage = {
        payer: summary.payerName,
        planName: summary.planName,
        eligibilityStatus: summary.eligibilityStatus,
        network: summary.network,
        estimatedPatientResponsibility: summary.estimatedPatientResponsibility,
        deductibleRemaining: summary.deductibleRemaining,
        sourced: summary.sourced
      };
      chained.push("benefits-verification");
    } catch {
      // Best-effort: a malformed coverage query must never break the chain.
    }
  }

  // ── 3. Appointment Scheduling — book when requested AND the pathway is an
  //    MSCP visit (only MSCP pathways are bookable; self-care / urgent-referral
  //    pathways are not). A providerId is preferred, but the Agentforce agent
  //    often only has a provider NAME from the conversation (not an NPI) — so
  //    when book=true on an MSCP pathway without an explicit providerId, fall
  //    back to a synthetic default id derived from the provider name (or a
  //    generic MSCP slot) so a name-only "book with Dr. Okafor" still yields a
  //    deterministic synthetic confirmation rather than silently no-op'ing.
  let scheduling: Record<string, unknown> | undefined;
  const explicitProviderId = g("providerId");
  const providerName = g("providerName");
  const isMscpVisit = decision.pathway.startsWith("mscp-");
  // Synthesize a stable provider id from the name when none was supplied.
  const providerId =
    explicitProviderId ??
    (providerName
      ? "npi-" + providerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      : "npi-mscp-default");
  if (flag("book") && isMscpVisit) {
    try {
      const modality: Modality = (g("modality") as Modality) ?? modalityForPathway(decision.pathway);
      const summary = bookingSummary(
        bookAppointment({
          providerId,
          providerName,
          modality,
          ...(g("requestedDate") ? { requestedDate: g("requestedDate") } : {})
        })
      );
      recordInstantSpan({
        taskId,
        parentSpanId: routerSpan.id,
        agentId: "appointment-scheduling-agent",
        operation: "scheduling.book",
        protocol: "rest",
        attributes: {
          providerId: summary.providerId,
          modality: summary.modality,
          serviceAppointmentId: summary.serviceAppointmentId,
          slotStart: summary.slotStart,
          status: summary.status,
          synthetic: true
        }
      });
      scheduling = {
        providerId: summary.providerId,
        providerName: summary.providerName,
        modality: summary.modality,
        serviceAppointmentId: summary.serviceAppointmentId,
        slotStart: summary.slotStart,
        slotEnd: summary.slotEnd,
        status: summary.status
      };
      chained.push("appointment-scheduling");
    } catch {
      // Best-effort: a scheduling failure must never break the chain.
    }
  }

  // ── 4. SDOH Screening — when a coded screen vector is supplied. A positive
  //    interpersonal-safety screen is a MANDATORY human-social-worker escalation;
  //    community-resource referrals are consent-gated (never autonomous).
  let sdoh: Record<string, unknown> | undefined;
  const screenerRaw = (g("sdohScreener") ?? "ahc-hrsn") as SdohScreener;
  const sdohResponses = parseSdohResponses(g("screenSdoh"));
  if (sdohResponses && isAllowlistedSdohScreener(screenerRaw)) {
    try {
      const result = screenSocialNeeds({ screener: screenerRaw, responses: sdohResponses });
      const referrals = draftCommunityReferralsForResult(result, {
        patientConsent: flag("sdohConsent")
      });
      recordInstantSpan({
        taskId,
        parentSpanId: routerSpan.id,
        agentId: "sdoh-screening-agent",
        operation: "sdoh.screen",
        protocol: "rest",
        attributes: {
          screener: result.screener,
          positiveDomainCount: result.positiveDomainCount,
          positiveDomains: result.positiveDomains,
          safetyEscalation: result.redFlags.length > 0,
          referralsDrafted: referrals.length,
          phiAccessed: true,
          synthetic: true
        }
      });
      sdoh = {
        screener: result.screener,
        positiveDomains: result.positiveDomains,
        positiveDomainCount: result.positiveDomainCount,
        safetyEscalation: result.redFlags.length > 0,
        referralsDrafted: referrals.length
      };
      chained.push("sdoh-screening");
    } catch {
      // Best-effort: a malformed screen must never break the chain.
    }
  }

  return NextResponse.json(
    {
      taskId,
      chained,
      pathway: decision.pathway,
      pathwayLabel: decision.pathwayLabel,
      acuity: decision.acuity,
      rationale: decision.rationale,
      redFlagsTriggered: decision.redFlagsTriggered,
      recommendedTargetResponse: decision.recommendedTargetResponse,
      ...(coverage ? { coverage } : {}),
      ...(scheduling ? { scheduling } : {}),
      ...(sdoh ? { sdoh } : {}),
      synthetic: true,
      _note:
        "Deterministic intake→specialist chain: Care Router (always) + Benefits/Appointment/SDOH when requested, all under one Agent Fabric trace (open /demo/agent-fabric?taskId=" +
        taskId +
        "). Advisory/synthetic — not a diagnosis, guaranteed cost, or real booking. The single handoff action the Agentforce Intake Agent calls; each specialist stays narrow-scoped to sidestep the Service Agent guardrail."
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
      }
    }
  );
}
