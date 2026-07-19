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
  type MemberCaseIntake,
  type PhiSafeRoutingSummary,
  type ResolutionProposal,
  DEMO_GRIEVANCE_INTAKE,
  assembleGrievanceCase,
  caseResolutionRequiresHumanQueue,
  deadlineTracesToCatalog,
  proposeCaseResolution,
  routingSummaryIsPhiSafe
} from "../../../../../lib/grievance-appeals";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "grievance-appeals-agent";

/**
 * Google A2A `tasks/send` endpoint for the Grievance & Appeals agent — a
 * member-service intake agent that classifies grievances and coverage-
 * denial appeals, routes them to the correct human queue, and stamps a
 * regulatory deadline.
 *
 *   POST /api/agents/grievance-appeals/tasks
 *
 * DETERMINISTICALLY classifies the intake, routes to the correct human
 * queue (member-services / clinical-review / compliance), and stamps the
 * regulatory deadline. It NEVER resolves, approves, or denies a case on
 * its own; every case is queued for human review; the routing summary
 * handed to the queue is PHI-safe (structured only).
 *
 * Enforced-block policies checked before any case is returned:
 *   - policy.grievance.no-autonomous-resolution (signal
 *     caseResolutionRequiresHumanQueue) — every resolution proposal must
 *     be human-queue gated.
 *   - policy.grievance.deadline-integrity (signal
 *     deadlineTracesToCatalog) — every case deadline must trace to the
 *     case-type catalog + received date and not exceed the regulatory
 *     maximum.
 *   - policy.grievance.no-phi-in-routing-summary (signal
 *     routingSummaryIsPhiSafe) — the routing summary must be structured
 *     only (no free-text PHI, no extra keys).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { intake?: MemberCaseIntake, proposals?: ResolutionProposal[],
 *     routingSummaryOverride?: object, deadlineOverride?:
 *     { caseType, receivedDate, deadlineDate } } — the intake is classified
 *   by default; caller-asserted proposals / routingSummaryOverride /
 *   deadlineOverride demonstrate the three governance blocks.
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
  const taskId = params.id || newTaskId("grievance");
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
  const intake =
    data.intake && typeof data.intake === "object"
      ? (data.intake as MemberCaseIntake)
      : DEMO_GRIEVANCE_INTAKE;

  // Deterministic case assembly.
  const grievanceCase = assembleGrievanceCase(intake);

  // The proposals the no-autonomous-resolution gate checks — the caller-
  // asserted set (to demonstrate the block) or an empty set (agent default).
  const proposalsForCheck = Array.isArray(data.proposals)
    ? (data.proposals as ResolutionProposal[])
    : [];

  // The routing summary the PHI-safe gate checks — the caller-asserted
  // override (to demonstrate the block) or the produced structured summary.
  const assertedRoutingSummary =
    data.routingSummaryOverride && typeof data.routingSummaryOverride === "object"
      ? (data.routingSummaryOverride as Record<string, unknown>)
      : undefined;
  const routingSummaryForCheck = assertedRoutingSummary ?? grievanceCase.phiSafeRoutingSummary;

  // The deadline the deadline-integrity gate checks — the caller-asserted
  // override (to demonstrate the block) or the produced case's deadline.
  const assertedDeadline =
    data.deadlineOverride && typeof data.deadlineOverride === "object"
      ? (data.deadlineOverride as {
          caseType?: string;
          receivedDate?: string;
          deadlineDate?: string;
        })
      : undefined;
  const deadlineForCheck = assertedDeadline ?? {
    caseType: grievanceCase.caseType,
    receivedDate: intake.receivedDate,
    deadlineDate: grievanceCase.deadlineDate
  };

  // Honest governance signals.
  const resolutionHuman = caseResolutionRequiresHumanQueue(proposalsForCheck);
  const deadlineOk = deadlineTracesToCatalog(deadlineForCheck);
  const phiSafe = routingSummaryIsPhiSafe(routingSummaryForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      caseResolutionRequiresHumanQueue: resolutionHuman,
      deadlineTracesToCatalog: deadlineOk,
      routingSummaryIsPhiSafe: phiSafe
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "grievance.classify.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        memberRef: intake.memberRef,
        caseResolutionRequiresHumanQueue: resolutionHuman,
        deadlineTracesToCatalog: deadlineOk,
        routingSummaryIsPhiSafe: phiSafe,
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
          `Pause Agent Fabric blocked this grievance-and-appeals run: ${governance.blockingViolations
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

  // Classify span — records the classification + urgency + deadline stamping.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "grievance.classify",
    protocol: "a2a",
    attributes: {
      memberRef: intake.memberRef,
      receivedDate: intake.receivedDate,
      caseType: grievanceCase.caseType,
      urgency: grievanceCase.urgency,
      deadlineDate: grievanceCase.deadlineDate,
      deadlineTracesToCatalog: deadlineOk,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Route span — records the human-queue routing with the PHI-safe payload.
  const routeSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "grievance.route-to-queue",
    protocol: "a2a",
    attributes: {
      queue: grievanceCase.queue,
      state: grievanceCase.state,
      caseResolutionRequiresHumanQueue: resolutionHuman,
      routingSummaryIsPhiSafe: phiSafe,
      // Attach the structured (PHI-safe) summary to the span — safe because
      // it contains no free-text PHI.
      routingSummary: grievanceCase.phiSafeRoutingSummary as unknown as Record<
        string,
        unknown
      >,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // A default illustrative proposal — a queue-action proposal for the human
  // queue to resolve. ALWAYS requiresHumanQueueAction:true / applied:false.
  const defaultProposal = proposeCaseResolution({
    caseId: grievanceCase.caseId,
    queue: grievanceCase.queue,
    rationale: `${grievanceCase.caseTypeLabel} — ${grievanceCase.urgency}`
  });

  const result = { case: grievanceCase, proposal: defaultProposal };

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        `Classified member intake for ${grievanceCase.memberRef} received ${intake.receivedDate} as ${grievanceCase.caseTypeLabel} (${grievanceCase.urgency}); routed to ${grievanceCase.queue}; regulatory deadline ${grievanceCase.deadlineDate} (${grievanceCase.deadlineDays}d). Every case is queued for human review; the routing summary is PHI-safe (structured only); the deadline traces to the case-type catalog. Synthetic — illustrative catalog and windows, not a certified grievance-and-appeals system.`,
        { result }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "GrievanceAppealCase",
        description:
          "Deterministically-classified member grievance / coverage-denial appeal case — a case-type (grievance-quality-of-service / grievance-billing-dispute / appeal-coverage-denial / appeal-expedited-coverage-denial), a target human queue (member-services / clinical-review / compliance), a regulatory deadline (received-date + catalog deadline-days), a PHI-safe routing summary (structured only — no free-text PHI), and a human-queue-action gated resolution proposal (NEVER autonomously applied). The case-type catalog, deadline windows, and queue mapping are illustrative/synthetic, NOT Medicare Advantage Chapter 13 or a real appeal-adjudication engine.",
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
        traceSpanId: routeSpan.id,
        traceTaskId: taskId,
        memberRef: intake.memberRef,
        caseId: grievanceCase.caseId,
        caseType: grievanceCase.caseType,
        urgency: grievanceCase.urgency,
        queue: grievanceCase.queue,
        deadlineDate: grievanceCase.deadlineDate,
        deadlineDays: grievanceCase.deadlineDays,
        state: grievanceCase.state,
        caseResolutionRequiresHumanQueue: resolutionHuman,
        deadlineTracesToCatalog: deadlineOk,
        routingSummaryIsPhiSafe: phiSafe
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
