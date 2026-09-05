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
  type AbnDetermination,
  type AbnServiceRequest,
  DEMO_ABN_REQUEST,
  abnCoverageRuleSourced,
  abnNoAutonomousBeneficiaryLiability,
  abnRequiredWhenNoncovered,
  abnSummary,
  evaluateAbn
} from "../../../../../lib/advance-beneficiary-notice";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "advance-beneficiary-notice-agent";

/**
 * Google A2A `tasks/send` endpoint for the Advance Beneficiary Notice (Medicare ABN) agent — the
 * patient-access service that decides whether a signed pre-service ABN is required before a
 * likely-denied Medicare service and whether the beneficiary may be billed.
 *
 *   POST /api/agents/advance-beneficiary-notice/tasks
 *
 * Loads a proposed service and DETERMINISTICALLY evaluates it via evaluateAbn: it assesses coverage
 * (likely-covered / likely-non-covered / statutorily-excluded) from the cited Medicare coverage
 * rule, decides whether a signed pre-service ABN (Form CMS-R-131) is required, computes whether a
 * valid pre-service ABN is on file, decides whether the beneficiary may be billed, assigns the CMS
 * liability modifier (GA / GZ / GY), and decides the disposition. The decision is a pure function
 * of the request's own fields + the cited rule (no randomness, no clock). Every non-coverage
 * decision cites a recorded coverage rule, a likely-non-covered service requires a pre-service
 * ABN, and patient financial liability is never assigned autonomously — it requires human review.
 * The coverage rules are illustrative; real ABN decisions are governed by the Medicare NCD/LCD,
 * the Social Security Act §1862(a), and the CMS Medicare Claims Processing Manual (Ch. 30).
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.abn.coverage-rule-sourced (signal abnCoverageRuleSourced) — the decision cites a
 *     recorded Medicare coverage rule.
 *   - policy.abn.abn-required-when-noncovered (signal abnRequiredWhenNoncovered) — a likely-non-
 *     covered service requires a signed pre-service ABN.
 *   - policy.abn.no-autonomous-beneficiary-liability (signal abnNoAutonomousBeneficiaryLiability)
 *     — the beneficiary is never billed without a valid ABN and liability is human-reviewed.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: AbnServiceRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if it cites a recorded rule, requires an ABN
 *   when non-covered, and does not autonomously assign beneficiary liability) demonstrates the
 *   three governance blocks.
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
  const taskId = params.id || newTaskId("advance-beneficiary-notice");
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
  const request =
    data.request && typeof data.request === "object"
      ? (data.request as AbnServiceRequest)
      : DEMO_ABN_REQUEST;

  // Deterministic ABN evaluation.
  const determination = evaluateAbn(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced determination.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as AbnDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: sourced coverage rule + ABN required when non-covered + no
  // autonomous beneficiary-liability assignment.
  const ruleSourced = abnCoverageRuleSourced(determinationForCheck);
  const abnRequiredOk = abnRequiredWhenNoncovered(determinationForCheck);
  const noAutonomousLiability = abnNoAutonomousBeneficiaryLiability(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      abnCoverageRuleSourced: ruleSourced,
      abnRequiredWhenNoncovered: abnRequiredOk,
      abnNoAutonomousBeneficiaryLiability: noAutonomousLiability
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "abn.decide-liability.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        abnCoverageRuleSourced: ruleSourced,
        abnRequiredWhenNoncovered: abnRequiredOk,
        abnNoAutonomousBeneficiaryLiability: noAutonomousLiability,
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
          `Pause Agent Fabric blocked this ABN run: ${governance.blockingViolations
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

  const summary = abnSummary(determination);

  // Receive-request span — the fabric records the proposed service it received, parented under the
  // caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "abn.receive-request",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      coverageRuleId: request.coverageRuleId,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Assess-coverage span — the deterministic coverage assessment + ABN-required decision, parented
  // to the received request.
  const assessSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "abn.assess-coverage",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      coverageAssessment: determination.coverageAssessment,
      abnRequired: determination.abnRequired,
      abnCoverageRuleSourced: ruleSourced,
      abnRequiredWhenNoncovered: abnRequiredOk,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Decide-liability span — the modifier + disposition (review-gated on a non-covered assessment),
  // parented to the coverage assessment.
  const decideSpan = recordInstantSpan({
    taskId,
    parentSpanId: assessSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "abn.decide-liability",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      modifier: determination.modifier,
      disposition: determination.disposition,
      requiresHumanReview: determination.requiresHumanReview,
      abnNoAutonomousBeneficiaryLiability: noAutonomousLiability,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the decision.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: decideSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "abn.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage =
    determination.coverageAssessment === "likely-covered"
      ? `Request ${request.requestRef}: LIKELY COVERED under ${determination.coverageRuleId} — no ABN required; proceed and bill Medicare (synthetic — illustrative coverage rules, NOT a certified engine).`
      : determination.coverageAssessment === "statutorily-excluded"
        ? `Request ${request.requestRef}: STATUTORILY EXCLUDED under ${determination.coverageRuleId} — beneficiary liable (modifier GY), voluntary ABN recommended; human review required (synthetic — illustrative coverage rules).`
        : determination.abnValid
          ? `Request ${request.requestRef}: LIKELY NON-COVERED with a valid pre-service ABN → beneficiary may be billed (modifier GA); human review required (synthetic — illustrative coverage rules).`
          : `Request ${request.requestRef}: LIKELY NON-COVERED with NO valid pre-service ABN → issue an ABN before the service; without one the PROVIDER is liable (modifier GZ), NOT the beneficiary; human review required (synthetic — illustrative coverage rules).`;

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(completedMessage, { result })
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "AbnDetermination",
        description:
          "Deterministically-produced Advance Beneficiary Notice (Medicare ABN) determination. It assesses coverage (likely-covered / likely-non-covered / statutorily-excluded) from the cited Medicare coverage rule, decides whether a signed pre-service ABN (Form CMS-R-131) is required, computes whether a valid pre-service ABN is on file, decides whether the beneficiary may be billed, assigns the CMS liability modifier (GA / GZ / GY), and decides the disposition (proceed-covered / issue-abn-before-service / bill-beneficiary-with-abn / notify-statutory-exclusion). Every non-coverage decision cites a recorded coverage rule, a likely-non-covered service requires a pre-service ABN, and patient financial liability is NEVER assigned autonomously — it is a recommendation requiring human review. The decision is a pure function of the request's own fields + the cited rule (no randomness, no clock). The coverage rules are illustrative, NOT a certified Medicare coverage engine — real ABN decisions are governed by the Medicare NCD/LCD, the Social Security Act §1862(a), the CMS Medicare Claims Processing Manual (Ch. 30), and Form CMS-R-131.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { result } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: auditSpan.id,
        traceTaskId: taskId,
        requestRef: request.requestRef,
        coverageRuleId: determination.coverageRuleId,
        coverageAssessment: determination.coverageAssessment,
        abnRequired: determination.abnRequired,
        abnValid: determination.abnValid,
        patientMayBeBilled: determination.patientMayBeBilled,
        modifier: determination.modifier,
        disposition: determination.disposition,
        requiresHumanReview: determination.requiresHumanReview,
        abnCoverageRuleSourced: ruleSourced,
        abnRequiredWhenNoncovered: abnRequiredOk,
        abnNoAutonomousBeneficiaryLiability: noAutonomousLiability,
        summaryModifier: summary.modifier
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
