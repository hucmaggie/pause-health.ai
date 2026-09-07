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
  type AmendmentDetermination,
  type AmendmentRequest,
  DEMO_AMENDMENT_REQUEST,
  amendmentDeadlineComputed,
  amendmentGroundSourced,
  amendmentNoAutonomousWrite,
  amendmentSummary,
  evaluateAmendment
} from "../../../../../lib/amendment-request";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "amendment-request-agent";

/**
 * Google A2A `tasks/send` endpoint for the Amendment / Correction (HIPAA §164.526) agent — a
 * control-plane / data-substrate privacy service on the platform plane that adjudicates a patient's
 * right to request an amendment of their PHI.
 *
 *   POST /api/agents/amendment-request/tasks
 *
 * Loads an amendment request and DETERMINISTICALLY evaluates it via evaluateAmendment: it computes the
 * §164.526 response deadline (request date + 60 / 90 days), derives which denial ground (if any)
 * applies, and decides the disposition. The determination is a pure function of the request's own
 * fields (dates taken as data — no clock). Every denial cites a recorded ground, the deadline is
 * computed (not guessed), and the record is never autonomously amended or denied — a records / privacy
 * officer acts on or reviews every determination. This is a PHI-bearing agent (phiAccessed:true
 * throughout). The catalog + math are illustrative; real amendment is governed by HIPAA §164.526 and
 * the covered entity's Notice of Privacy Practices.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.amendment.ground-sourced (signal amendmentGroundSourced) — a denial cites a cataloged ground.
 *   - policy.amendment.deadline-computed (signal amendmentDeadlineComputed) — the deadline is request+60/90.
 *   - policy.amendment.no-autonomous-write-or-denial (signal amendmentNoAutonomousWrite) — no auto amend/deny.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: AmendmentRequest, determination?: object } — the request is evaluated; a caller-
 *   asserted `determination` (admissible only if the ground is cataloged, the deadline is computed,
 *   and no auto amend/deny) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("amendment-request");
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
      ? (data.request as AmendmentRequest)
      : DEMO_AMENDMENT_REQUEST;

  // Deterministic amendment adjudication.
  const determination = evaluateAmendment(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as AmendmentDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: ground-sourced denial + computed deadline + no autonomous amend/deny.
  const groundSourced = amendmentGroundSourced(determinationForCheck);
  const deadlineComputed = amendmentDeadlineComputed(determinationForCheck, {
    requestDate: request.requestDate,
    asOfDate: request.asOfDate
  });
  const noAutonomous = amendmentNoAutonomousWrite(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      amendmentGroundSourced: groundSourced,
      amendmentDeadlineComputed: deadlineComputed,
      amendmentNoAutonomousWrite: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "amendment.assess-grounds.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        amendmentGroundSourced: groundSourced,
        amendmentDeadlineComputed: deadlineComputed,
        amendmentNoAutonomousWrite: noAutonomous,
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
          `Pause Agent Fabric blocked this amendment run: ${governance.blockingViolations
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

  const summary = amendmentSummary(determination);

  // Receive-request span — the fabric records the request it received, parented under the caller's span.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "amendment.receive-request",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      patientRef: request.patientRef,
      recordRef: request.recordRef,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Assess-grounds span — the derived denial ground, parented to the received request.
  const groundsSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "amendment.assess-grounds",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      deniedOnGround: determination.deniedOnGround,
      amendmentGroundSourced: groundSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-deadline span — the §164.526 response deadline, parented to the grounds.
  const deadlineSpan = recordInstantSpan({
    taskId,
    parentSpanId: groundsSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "amendment.compute-deadline",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      responseDeadline: determination.responseDeadline,
      daysUntilDeadline: determination.daysUntilDeadline,
      amendmentDeadlineComputed: deadlineComputed,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the HIPAA audit trail, parented to the deadline.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: deadlineSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "amendment.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      amendmentNoAutonomousWrite: noAutonomous,
      requiresHumanReview: determination.requiresHumanReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage = `Amendment request ${request.requestRef} (${request.requestType}) for ${request.patientRef} on ${request.recordRef}: ${determination.disposition}${determination.deniedOnGroundLabel ? ` (${determination.deniedOnGroundLabel})` : ""}, response due ${determination.responseDeadline} (${determination.daysUntilDeadline} day(s) remaining) — recommendation for a records / privacy officer, no record amended or denied autonomously (synthetic — illustrative §164.526 catalog, NOT a certified HIM system).`;

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
        name: "AmendmentDetermination",
        description:
          "Deterministically-produced §164.526 amendment / correction determination. It computes the response deadline (request date + 60 days, or + 90 with the single extension), derives which statutory denial ground (if any) applies against the recorded catalog (not-originator / not-in-designated-record-set / not-available-for-access / accurate-and-complete), and decides the disposition (recommend-accept / recommend-deny, the latter carrying the patient's statement-of-disagreement rights). Every denial cites a recorded ground, the deadline is computed (not guessed), and the record is NEVER autonomously amended (a data write to the medical record) or denied (a legal act) — a records / privacy officer acts on or reviews every determination. The determination is a pure function of the request's own fields (dates taken as data — no clock). This is a PHI-bearing agent — the amendment decision references the patient's record. The catalog + 60/90-day math are illustrative, NOT a certified HIM system — real amendment is governed by HIPAA §164.526 (the full denial grounds, the written-denial + statement-of-disagreement + rebuttal process, and the duty to notify other holders of an accepted amendment) and the covered entity's Notice of Privacy Practices.",
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
        patientRef: determination.patientRef,
        disposition: determination.disposition,
        deniedOnGround: determination.deniedOnGround,
        responseDeadline: determination.responseDeadline,
        daysUntilDeadline: determination.daysUntilDeadline,
        patientMayStatementOfDisagreement: determination.patientMayStatementOfDisagreement,
        requiresHumanReview: determination.requiresHumanReview,
        amendmentGroundSourced: groundSourced,
        amendmentDeadlineComputed: deadlineComputed,
        amendmentNoAutonomousWrite: noAutonomous,
        summaryDisposition: summary.disposition
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
