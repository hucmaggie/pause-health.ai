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
  type InformationBlockingDetermination,
  type InformationBlockingRequest,
  DEMO_INFORMATION_BLOCKING_REQUEST,
  blockingDeterminationNotOverstated,
  blockingExceptionSourced,
  blockingNoAutonomousBlockOrRelease,
  evaluateInformationBlocking,
  informationBlockingSummary
} from "../../../../../lib/information-blocking";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "information-blocking-agent";

/**
 * Google A2A `tasks/send` endpoint for the Information Blocking (21st Century Cures Act / 45 CFR Part
 * 171) agent — a control-plane / data-substrate compliance service on the platform plane that
 * adjudicates whether an actor's practice that interfered with EHI access is information blocking, or
 * fits a recorded exception.
 *
 *   POST /api/agents/information-blocking/tasks
 *
 * Loads a practice review and DETERMINISTICALLY evaluates it via evaluateInformationBlocking: it
 * checks the claimed exception against the recorded catalog, verifies every required condition is
 * satisfied, and decides the disposition. There is no date math and no dollar waterfall — it is a
 * conditions-satisfaction classifier, a pure function of the request's own fields. Every claimed
 * exception cites a recorded catalog entry, an exception is reported met only when every condition is
 * satisfied, and EHI is never autonomously withheld or released — a compliance officer confirms every
 * determination. This is an EHI-bearing agent (phiAccessed:true throughout). The catalog + conditions
 * are illustrative; real analysis is governed by 45 CFR Part 171 and OIG enforcement.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.information-blocking.exception-sourced (signal blockingExceptionSourced).
 *   - policy.information-blocking.determination-not-overstated (signal blockingDeterminationNotOverstated).
 *   - policy.information-blocking.no-autonomous-block-or-release (signal blockingNoAutonomousBlockOrRelease).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: InformationBlockingRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if the exception is cataloged, no exception is
 *   overstated, and no auto block/release) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("information-blocking");
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
      ? (data.request as InformationBlockingRequest)
      : DEMO_INFORMATION_BLOCKING_REQUEST;

  // Deterministic information-blocking adjudication.
  const determination = evaluateInformationBlocking(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as InformationBlockingDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: exception-sourced + not-overstated + no autonomous block/release.
  const exceptionSourced = blockingExceptionSourced(determinationForCheck);
  const notOverstated = blockingDeterminationNotOverstated(determinationForCheck, {
    conditionsMet: request.conditionsMet
  });
  const noAutonomous = blockingNoAutonomousBlockOrRelease(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      blockingExceptionSourced: exceptionSourced,
      blockingDeterminationNotOverstated: notOverstated,
      blockingNoAutonomousBlockOrRelease: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "blocking.assess-exception.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        blockingExceptionSourced: exceptionSourced,
        blockingDeterminationNotOverstated: notOverstated,
        blockingNoAutonomousBlockOrRelease: noAutonomous,
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
          `Pause Agent Fabric blocked this information-blocking run: ${governance.blockingViolations
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

  const summary = informationBlockingSummary(determination);

  // Receive-practice span — the fabric records the practice review it received, parented under the caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "blocking.receive-practice",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      actorRef: request.actorRef,
      ehiRequestType: request.ehiRequestType,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Assess-exception span — the claimed exception classified, parented to the received practice.
  const exceptionSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "blocking.assess-exception",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      claimedExceptionId: determination.claimedExceptionId,
      blockingExceptionSourced: exceptionSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Check-conditions span — the condition satisfaction + disposition, parented to the exception.
  const conditionsSpan = recordInstantSpan({
    taskId,
    parentSpanId: exceptionSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "blocking.check-conditions",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      exceptionSatisfied: determination.exceptionSatisfied,
      missingConditions: determination.missingConditions,
      blockingDeterminationNotOverstated: notOverstated,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the conditions.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: conditionsSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "blocking.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      blockingNoAutonomousBlockOrRelease: noAutonomous,
      requiresComplianceReview: determination.requiresComplianceReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage = `Information-blocking review ${request.requestRef} (${request.actorType} · ${request.ehiRequestType}) for ${request.actorRef}: ${determination.disposition}${determination.claimedExceptionName ? ` (claimed ${determination.claimedExceptionName})` : ""}${determination.missingConditions.length > 0 ? `, missing ${determination.missingConditions.length} condition(s)` : ""} — recommendation for a compliance officer, no EHI withheld or released autonomously (synthetic — illustrative 45 CFR Part 171 catalog, NOT certified compliance counsel).`;

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
        name: "InformationBlockingDetermination",
        description:
          "Deterministically-produced 21st Century Cures Act / 45 CFR Part 171 information-blocking determination. It checks the claimed exception against the recorded catalog (preventing harm / privacy / security / infeasibility / health IT performance / content & manner / fees / licensing), verifies EVERY required condition of that exception is satisfied, and decides the disposition (not-information-blocking-no-interference / not-information-blocking-exception-met / potential-information-blocking-needs-review). Every claimed exception cites a recorded catalog entry, an exception is reported met only when every condition is satisfied, and EHI is NEVER autonomously withheld (which could itself be information blocking) or force-released (which could breach privacy) — a compliance officer confirms and acts on every determination. There is no date math and no dollar waterfall — it is a conditions-satisfaction classifier, a pure function of the request's own fields. This is an EHI-bearing agent — the review references a request for the patient's electronic health information. The catalog + conditions are illustrative, NOT certified compliance counsel — real analysis is governed by the 21st Century Cures Act and 45 CFR Part 171 (the full text of the eight exceptions and every sub-condition), the ONC / ASTP rules, and OIG enforcement.",
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
        actorRef: determination.actorRef,
        disposition: determination.disposition,
        claimedExceptionId: determination.claimedExceptionId,
        exceptionSatisfied: determination.exceptionSatisfied,
        missingConditions: determination.missingConditions,
        requiresComplianceReview: determination.requiresComplianceReview,
        blockingExceptionSourced: exceptionSourced,
        blockingDeterminationNotOverstated: notOverstated,
        blockingNoAutonomousBlockOrRelease: noAutonomous,
        summaryDisposition: summary.disposition
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
