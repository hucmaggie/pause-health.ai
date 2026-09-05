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
  type SubrogationDetermination,
  type SubrogationRequest,
  DEMO_SUBROGATION_REQUEST,
  evaluateSubrogation,
  subrogationBasisSourced,
  subrogationNoAutonomousLien,
  subrogationRecoverableWithinPaid,
  subrogationSummary
} from "../../../../../lib/subrogation";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "subrogation-agent";

/**
 * Google A2A `tasks/send` endpoint for the Subrogation / Third-Party Liability (TPL) agent — the
 * claims / payer-operations service that decides whether a plan has a subrogation interest in a
 * liable third party's settlement for injury claims it paid, computes a bounded recoverable amount,
 * and routes for specialist / counsel review.
 *
 *   POST /api/agents/subrogation/tasks
 *
 * Loads a subrogation case and DETERMINISTICALLY evaluates it via evaluateSubrogation: it decides
 * eligibility (injury-related AND a liable third party AND a real accident AND a recovery-allowing
 * basis), computes the bounded recoverable (capped at the plan's paid amount, capped again at the
 * settlement, barred by the made-whole doctrine, reduced by the common-fund attorney-fee share), and
 * decides the disposition. The determination is a pure function of the case's own fields (no
 * randomness, no clock). Every recovery decision cites a recorded basis, the recoverable never
 * exceeds what the plan paid or the settlement, and no lien is autonomously asserted — an eligible
 * case requires human review. The basis catalog + reductions are illustrative; real subrogation is
 * governed by the plan document, state subrogation / made-whole / common-fund law, and workers-comp
 * statutes.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.subrogation.basis-sourced (signal subrogationBasisSourced) — the recovery cites a
 *     recorded legal basis.
 *   - policy.subrogation.recoverable-within-paid (signal subrogationRecoverableWithinPaid) — the
 *     recoverable never exceeds the plan's paid amount or the settlement.
 *   - policy.subrogation.no-autonomous-lien (signal subrogationNoAutonomousLien) — no lien is
 *     autonomously asserted and an eligible case is review-gated.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: SubrogationRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if the basis is cataloged, the recoverable is
 *   within the plan's paid amount / settlement, and no lien is auto-asserted) demonstrates the three
 *   governance blocks.
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
  const taskId = params.id || newTaskId("subrogation");
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
      ? (data.request as SubrogationRequest)
      : DEMO_SUBROGATION_REQUEST;

  // Deterministic subrogation evaluation.
  const determination = evaluateSubrogation(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced determination.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as SubrogationDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: sourced basis + bounded recoverable + never an autonomous lien.
  const basisSourced = subrogationBasisSourced(determinationForCheck);
  const recoverableWithinPaid = subrogationRecoverableWithinPaid(determinationForCheck);
  const noAutonomousLien = subrogationNoAutonomousLien(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      subrogationBasisSourced: basisSourced,
      subrogationRecoverableWithinPaid: recoverableWithinPaid,
      subrogationNoAutonomousLien: noAutonomousLien
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "subrogation.compute-recoverable.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        caseRef: request.caseRef,
        subrogationBasisSourced: basisSourced,
        subrogationRecoverableWithinPaid: recoverableWithinPaid,
        subrogationNoAutonomousLien: noAutonomousLien,
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
          `Pause Agent Fabric blocked this subrogation run: ${governance.blockingViolations
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

  const summary = subrogationSummary(determination);

  // Receive-case span — the fabric records the case it received, parented under the caller's span.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "subrogation.receive-case",
    protocol: "a2a",
    attributes: {
      caseRef: request.caseRef,
      patientRef: request.patientRef,
      accidentType: request.accidentType,
      planPaidAmount: determination.planPaidAmount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Assess-eligibility span — the deterministic eligibility decision, parented to the received case.
  const assessSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "subrogation.assess-eligibility",
    protocol: "a2a",
    attributes: {
      caseRef: request.caseRef,
      eligible: determination.eligible,
      basisId: determination.basisId,
      subrogationBasisSourced: basisSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-recoverable span — the bounded recoverable + disposition, parented to the eligibility.
  const computeSpan = recordInstantSpan({
    taskId,
    parentSpanId: assessSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "subrogation.compute-recoverable",
    protocol: "a2a",
    attributes: {
      caseRef: request.caseRef,
      planPaidAmount: determination.planPaidAmount,
      recoverableAmount: determination.recoverableAmount,
      disposition: determination.disposition,
      requiresHumanReview: determination.requiresHumanReview,
      subrogationRecoverableWithinPaid: recoverableWithinPaid,
      subrogationNoAutonomousLien: noAutonomousLien,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the computation.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: computeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "subrogation.log-audit",
    protocol: "a2a",
    attributes: {
      caseRef: request.caseRef,
      recoverableAmount: determination.recoverableAmount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, caseRef: request.caseRef };

  const completedMessage = determination.eligible
    ? `Subrogation interest for ${request.caseRef} under ${determination.basisId}: recoverable $${determination.recoverableAmount.toFixed(2)} of $${determination.planPaidAmount.toFixed(2)} paid — ${determination.disposition}; specialist / counsel review required before any lien is asserted (synthetic — illustrative basis catalog, NOT a certified subrogation engine).`
    : `No subrogation interest for ${request.caseRef} — ${determination.disposition} (synthetic — illustrative basis catalog, NOT a certified subrogation engine).`;

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
        name: "SubrogationDetermination",
        description:
          "Deterministically-produced subrogation / third-party-liability determination. It decides eligibility (injury-related AND a liable third party AND a real accident AND a recovery-allowing basis), computes a BOUNDED recoverable amount (capped at the plan's paid amount, capped again at the settlement, barred by the made-whole doctrine, reduced by the common-fund attorney-fee share), and decides the disposition (no-subrogation-interest / notify-made-whole-bar / assert-lien-with-review). Every recovery decision cites a recorded legal basis, the recoverable never exceeds what the plan paid or the settlement (a lien is reimbursement, not profit), and NO lien is autonomously asserted — an eligible case is a recommendation requiring subrogation-specialist / plan-counsel review. The determination is a pure function of the case's own fields (no randomness, no clock). The basis catalog + reductions are illustrative, NOT a certified subrogation engine — real subrogation is governed by the plan document (for a self-funded ERISA plan, 29 U.S.C. §1132(a)(3) and cases such as US Airways v. McCutchen and Montanile), state subrogation / made-whole / common-fund law, and state workers-compensation statutes.",
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
        caseRef: request.caseRef,
        patientRef: determination.patientRef,
        eligible: determination.eligible,
        basisId: determination.basisId,
        planPaidAmount: determination.planPaidAmount,
        settlementAmount: determination.settlementAmount,
        recoverableAmount: determination.recoverableAmount,
        disposition: determination.disposition,
        requiresHumanReview: determination.requiresHumanReview,
        subrogationBasisSourced: basisSourced,
        subrogationRecoverableWithinPaid: recoverableWithinPaid,
        subrogationNoAutonomousLien: noAutonomousLien,
        summaryRecoverable: summary.recoverableAmount
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
