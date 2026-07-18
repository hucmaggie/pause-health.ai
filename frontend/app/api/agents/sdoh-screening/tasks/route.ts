import { NextResponse } from "next/server";
import {
  type A2ATask,
  agentMessage,
  findDataPart,
  newTaskId,
  nowIso,
  parseTasksSendEnvelope
} from "../../../../../lib/a2a";
import {
  evaluateGovernance,
  recordInstantSpan
} from "../../../../../lib/agent-fabric";
import {
  draftCommunityReferralsForResult,
  isAllowlistedSdohScreener,
  screenSocialNeeds,
  sdohReferralHasConsent,
  sdohToIntakeSignal,
  usesValidatedSdohScreener,
  type SdohScreener,
  type SdohScreeningResponse
} from "../../../../../lib/sdoh";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "sdoh-screening-agent";

/**
 * Google A2A `tasks/send` endpoint for the Agentforce SDOH Screening Agent
 * (the Salesforce "Agentforce for Health" whole-person-care analog).
 *
 *   POST /api/agents/sdoh-screening/tasks
 *
 * Screens a patient for health-related social needs / social determinants of
 * health with a validated, public-domain instrument (the CMS Accountable Health
 * Communities HRSN core-domain tool), DETERMINISTICALLY flags the positive
 * social-need domains, escalates a positive interpersonal-safety screen to a
 * human social worker, and drafts CONSENT-GATED community-resource referrals —
 * never an autonomous enrollment. Screening is real rule-based logic — there is
 * no LLM in this path.
 *
 * Enforced-block policies checked before any screening/referral runs:
 *   - policy.sdoh.validated-screener-only (screener allow-list gate)
 *   - policy.sdoh.consent-before-referral (a referral requires patient consent)
 * A block returns HTTP 200 with an A2A task in state `failed`.
 *
 * Input (data part):
 *   { screener, responses, patientConsent? } — the screener + per-domain coded
 *   responses, plus whether the patient consented to a community referral. A
 *   bare data object is read as the screening response.
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  const parsed = parseTasksSendEnvelope(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: parsed.id, error: { code: parsed.code, message: parsed.message } },
      { status: 400 }
    );
  }

  const params = parsed.params;
  const taskId = params.id || newTaskId("sdoh");
  const sessionId = params.sessionId;
  const parentSpanId =
    typeof params.metadata?.parentSpanId === "string"
      ? (params.metadata.parentSpanId as string)
      : undefined;
  const personaId =
    typeof params.metadata?.personaId === "string"
      ? (params.metadata.personaId as string)
      : undefined;

  const data = findDataPart(params.message?.parts) ?? {};
  const screening =
    (data.screening as SdohScreeningResponse) ??
    (data as SdohScreeningResponse | undefined) ??
    ({} as SdohScreeningResponse);
  const screener = screening.screener as SdohScreener | undefined;
  // Whether the patient consented to a community-resource referral. Defaults to
  // false — a referral is never drafted for action unless consent is explicit.
  const patientConsent = data.patientConsent === true;

  // Governance pre-flight. The two honest facts: is the requested screener on
  // the validated allow-list, and does a community-resource referral carry the
  // patient's explicit consent? A screening with no positive domains drafts no
  // referral, so consent is only a blocker once there is something to refer.
  const willDraftReferral =
    isAllowlistedSdohScreener(screener) && willRefer(screening);
  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      usesValidatedSdohScreener: usesValidatedSdohScreener(screener),
      // Only assert the consent signal when a referral would actually be drafted;
      // an all-negative screen never trips the consent gate.
      sdohReferralHasConsent: willDraftReferral
        ? sdohReferralHasConsent({ patientConsent })
        : true,
      containsFreeTextPii: false
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "sdoh.screen.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestedScreener: String(screener),
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        phiAccessed: true,
        ...(personaId ? { personaId } : {})
      }
    });
    const failed: A2ATask = {
      id: taskId,
      sessionId,
      status: {
        state: "failed",
        timestamp: nowIso(),
        message: agentMessage(
          `Pause Agent Fabric blocked this SDOH screening: ${governance.blockingViolations
            .map((v) => `${v.policyId} (${v.reason})`)
            .join("; ")}`,
          { blockingViolations: governance.blockingViolations }
        )
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
          violations: governance.blockingViolations
        }
      }
    };
    return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: failed });
  }

  // Screen deterministically. A malformed response vector (wrong length /
  // out-of-range value) is a bad request, not a governance block, so it surfaces
  // as a failed task with the screener's own diagnostic.
  let result;
  try {
    result = screenSocialNeeds(screening);
  } catch (err) {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "sdoh.screen.invalid",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestedScreener: String(screener),
        error: (err as Error).message,
        phiAccessed: true,
        ...(personaId ? { personaId } : {})
      }
    });
    const failed: A2ATask = {
      id: taskId,
      sessionId,
      status: {
        state: "failed",
        timestamp: nowIso(),
        message: agentMessage(
          `SDOH screening could not be scored: ${(err as Error).message}`
        )
      },
      metadata: {
        agentFabric: {
          decision: "allow",
          policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
          error: (err as Error).message
        }
      }
    };
    return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: failed });
  }

  const careSignal = sdohToIntakeSignal(result);

  const screenSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "sdoh.screen",
    protocol: "rest",
    attributes: {
      screener: result.screener,
      screenerName: result.screenerName,
      positiveDomainCount: result.positiveDomainCount,
      positiveDomains: result.positiveDomains,
      safetyEscalation: careSignal.safetyEscalation,
      usesValidatedSdohScreener: true,
      scoringMethod: "deterministic",
      phiAccessed: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // A positive interpersonal-safety screen is a mandatory escalation to a human
  // social worker, recorded as its own span so the safety hand-off is visible in
  // the trace, not buried in an attribute — mirroring PHQ-9 item 9 handling.
  if (result.redFlags.length > 0) {
    recordInstantSpan({
      taskId,
      parentSpanId: screenSpan.id,
      agentId: FABRIC_AGENT_ID,
      operation: "sdoh.safety.escalate",
      protocol: "internal",
      status: "error",
      attributes: {
        screener: result.screener,
        redFlags: result.redFlags.map((f) => f.code),
        handoffTo: "social-worker",
        requiresHumanEscalation: true,
        phiAccessed: true,
        ...(personaId ? { personaId } : {})
      }
    });
  }

  // Draft consent-gated community-resource referrals — one per positive domain
  // plus the 211 general helpline. Every draft references a catalog resource by
  // construction, is human-approval-gated, and is never an autonomous enrollment.
  const referrals = draftCommunityReferralsForResult(result, { patientConsent });
  for (const referral of referrals) {
    recordInstantSpan({
      taskId,
      parentSpanId: screenSpan.id,
      agentId: FABRIC_AGENT_ID,
      operation: "sdoh.refer",
      protocol: "rest",
      attributes: {
        resourceId: referral.resourceId,
        domain: referral.domain,
        handoffTo: referral.handoffTo,
        requiresPatientConsent: referral.requiresPatientConsent,
        suppressedForNoConsent: referral.suppressedForNoConsent,
        requiresHumanApproval: referral.requiresHumanApproval,
        autonomousEnrollment: referral.autonomousEnrollment,
        sent: referral.sent,
        phiAccessed: true,
        ...(personaId ? { personaId } : {})
      }
    });
  }

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(result.interpretation, {
        result,
        referrals,
        careSignal
      })
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "SdohScreeningResult",
        description:
          "Deterministically screened validated HRSN/SDOH instrument (CMS AHC-HRSN core domains) with per-domain positive/negative determination, a count of positive social-need domains, and any interpersonal-safety red flag (a mandatory human-social-worker escalation) — plus consent-gated, catalog-sourced community-resource referral drafts (human-approval-gated, never an autonomous enrollment) and the care-coordination signal it produces. The community-resource catalog is illustrative/synthetic, NOT a live directory of real programs.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result, referrals, careSignal } as unknown as Record<
              string,
              unknown
            >
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: screenSpan.id,
        traceTaskId: taskId,
        // Whole-person care-coordination signal — SDOH never drives clinical
        // severity; a positive social need raises a care-coordination flag.
        socialNeedsIdentified: careSignal.socialNeedsIdentified,
        positiveDomainCount: careSignal.positiveDomainCount,
        safetyEscalation: careSignal.safetyEscalation,
        referralsDrafted: referrals.length,
        // A safety red flag hands off to a human social worker; otherwise the
        // consented referral drafts are handed to a community health worker.
        nextAgent: careSignal.safetyEscalation ? "human-social-worker" : "agentforce-intake"
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}

/**
 * Would this screening produce at least one community-resource referral? True
 * only when the screener is valid AND at least one domain would screen positive.
 * Used to decide whether the consent gate is even relevant — an all-negative
 * screen drafts no referral, so it never trips policy.sdoh.consent-before-referral.
 * Defensive: a malformed response set (which screenSocialNeeds would reject)
 * simply reports "no referral", so the consent gate never fires spuriously.
 */
function willRefer(screening: SdohScreeningResponse): boolean {
  try {
    return screenSocialNeeds(screening).positiveDomains.length > 0;
  } catch {
    return false;
  }
}
