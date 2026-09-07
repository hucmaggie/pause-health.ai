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
  type AccessDetermination,
  type AccessRequest,
  DEMO_ACCESS_REQUEST,
  accessDeadlineComputed,
  accessGroundSourced,
  accessNoAutonomousDenialOrRelease,
  accessSummary,
  evaluateAccess
} from "../../../../../lib/right-of-access";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "right-of-access-agent";

/**
 * Google A2A `tasks/send` endpoint for the Right of Access (HIPAA §164.524) agent — a control-plane /
 * data-substrate privacy service on the platform plane that adjudicates a patient's right to GET a
 * copy of their own PHI, and by when.
 *
 *   POST /api/agents/right-of-access/tasks
 *
 * Loads an access request and DETERMINISTICALLY evaluates it via evaluateAccess: it computes the
 * §164.524 response deadline (request date + 30, or + 60 with the extension), classifies any cited
 * denial ground against the recorded exception catalog, and decides the disposition. The
 * determination is a pure function of the request's own fields (dates as data, no clock). Every cited
 * denial ground traces to the catalog, the deadline is computed, and the record is never
 * autonomously released or denied — a records / privacy officer fulfills or reviews every
 * determination. This is a PHI-bearing agent (phiAccessed:true throughout). The exception catalog +
 * 30/60-day math are illustrative; real access is governed by §164.524, the HITECH electronic-copy
 * rules, and the covered entity's Notice of Privacy Practices.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.access.ground-sourced (signal accessGroundSourced) — a cited denial ground is cataloged.
 *   - policy.access.deadline-computed (signal accessDeadlineComputed) — the deadline is request-date
 *     + 30/60 days.
 *   - policy.access.no-autonomous-denial-or-release (signal accessNoAutonomousDenialOrRelease) — the
 *     record is never autonomously released, and every determination is review-gated.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: AccessRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if any cited ground is cataloged, the deadline is computed, and
 *   the record is not auto-released / is review-gated) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("right-of-access");
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
      ? (data.request as AccessRequest)
      : DEMO_ACCESS_REQUEST;

  // Deterministic access adjudication.
  const determination = evaluateAccess(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as AccessDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: ground-sourced denial + computed deadline + no autonomous release/denial.
  const groundSourced = accessGroundSourced(determinationForCheck);
  const deadlineComputed = accessDeadlineComputed(determinationForCheck, {
    requestDate: request.requestDate,
    asOfDate: request.asOfDate
  });
  const noAutonomous = accessNoAutonomousDenialOrRelease(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      accessGroundSourced: groundSourced,
      accessDeadlineComputed: deadlineComputed,
      accessNoAutonomousDenialOrRelease: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "access.compute-deadline.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        accessGroundSourced: groundSourced,
        accessDeadlineComputed: deadlineComputed,
        accessNoAutonomousDenialOrRelease: noAutonomous,
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
          `Pause Agent Fabric blocked this right-of-access run: ${governance.blockingViolations
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

  const summary = accessSummary(determination);

  // Receive-request span — the fabric records the request it received, parented under the caller's span.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "access.receive-request",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      patientRef: request.patientRef,
      requestType: request.requestType,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Assess-grounds span — the exception classification, parented to the received request.
  const assessSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "access.assess-grounds",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      exceptionId: determination.exceptionId,
      exceptionType: determination.exceptionType,
      accessGroundSourced: groundSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-deadline span — the deterministic deadline + disposition, parented to the assessment.
  const deadlineSpan = recordInstantSpan({
    taskId,
    parentSpanId: assessSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "access.compute-deadline",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      responseDeadline: determination.responseDeadline,
      daysUntilDeadline: determination.daysUntilDeadline,
      disposition: determination.disposition,
      accessDeadlineComputed: deadlineComputed,
      accessNoAutonomousDenialOrRelease: noAutonomous,
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
    operation: "access.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      requiresHumanReview: determination.requiresHumanReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage =
    determination.disposition === "grant-in-full"
      ? `Access request ${request.requestRef} (${request.requestType}) for ${request.patientRef}: grant in full, response due ${determination.responseDeadline} (${determination.daysUntilDeadline} day(s) remaining) — records / privacy officer to fulfill (synthetic — illustrative catalog, NOT a certified release-of-information system).`
      : `Access request ${request.requestRef} (${request.requestType}) for ${request.patientRef}: ${determination.disposition}, response due ${determination.responseDeadline} (${determination.daysUntilDeadline} day(s) remaining) — records / privacy officer to review (synthetic — illustrative catalog, NOT a certified release-of-information system).`;

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
        name: "AccessDetermination",
        description:
          "Deterministically-produced right-of-access determination. It computes the §164.524 response deadline (request date + 30, or + 60 with the single extension), classifies any cited denial ground against the recorded exception catalog, and decides the disposition (grant-in-full / deny-unreviewable / deny-reviewable-needs-review / not-accessible-outside-record-set). Every cited denial ground traces to the catalog, the deadline is computed, and the record is NEVER autonomously released or denied — a records / privacy officer fulfills or reviews every determination. The determination is a pure function of the request's own fields (dates as data, no clock). This is a PHI-bearing agent — the access decision references the patient's record. The exception catalog + 30/60-day math are illustrative, NOT a certified release-of-information system — real access is governed by HIPAA §164.524, the HITECH electronic-copy rules, and the covered entity's Notice of Privacy Practices.",
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
        requestType: determination.requestType,
        responseDeadline: determination.responseDeadline,
        daysUntilDeadline: determination.daysUntilDeadline,
        disposition: determination.disposition,
        accessGranted: determination.accessGranted,
        exceptionId: determination.exceptionId,
        exceptionType: determination.exceptionType,
        requiresHumanReview: determination.requiresHumanReview,
        accessGroundSourced: groundSourced,
        accessDeadlineComputed: deadlineComputed,
        accessNoAutonomousDenialOrRelease: noAutonomous,
        summaryDeadline: summary.responseDeadline
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
