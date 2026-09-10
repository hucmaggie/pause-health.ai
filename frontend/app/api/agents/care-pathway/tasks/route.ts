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
  type CarePathwayDetermination,
  type CarePathwayRequest,
  DEMO_CARE_PATHWAY_REQUEST,
  carePathwaySummary,
  evaluateCarePathway,
  pathwayNoAutonomousExecution,
  pathwaySequenceValid,
  pathwayStepsSourced
} from "../../../../../lib/care-pathway";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "care-pathway-agent";

/**
 * Google A2A `tasks/send` endpoint for the Care Pathway Sequencing agent — a clinical-decision service
 * on the patient / clinical plane that orders a clinical pathway's steps to respect their prerequisite
 * dependencies.
 *
 *   POST /api/agents/care-pathway/tasks
 *
 * Loads a pathway request and DETERMINISTICALLY evaluates it via evaluateCarePathway: it runs a
 * topological ordering (Kahn's algorithm) over the step dependency graph, detecting dependency cycles
 * (no valid order exists) and missing prerequisites (a step depends on a step absent from the pathway).
 * There is no set-difference, no identity match, no lookup, and no ratio — it is a topological sort +
 * cycle detection, a pure function of the pathway's steps. Every step id is sourced, the sequence
 * respects every prerequisite, and no step is executed — a clinician orders every one. This is a
 * PHI-bearing agent (phiAccessed:true throughout). The pathways are illustrative; real pathway
 * management uses evidence-based order sets and the care team's judgment.
 *
 * Enforced-block policies checked before any determination leaves the fabric:
 *   - policy.pathway.steps-sourced (signal pathwayStepsSourced).
 *   - policy.pathway.sequence-valid (signal pathwaySequenceValid).
 *   - policy.pathway.no-autonomous-execution (signal pathwayNoAutonomousExecution).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: CarePathwayRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if its steps are sourced, its sequence is valid,
 *   and it is not auto-executed) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("care-pathway");
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
      ? (data.request as CarePathwayRequest)
      : DEMO_CARE_PATHWAY_REQUEST;

  // Deterministic sequencing.
  const determination = evaluateCarePathway(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as CarePathwayDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: steps-sourced + sequence-valid + no autonomous execution.
  const stepsSourced = pathwayStepsSourced(determinationForCheck);
  const sequenceValid = pathwaySequenceValid(determinationForCheck);
  const noAutonomous = pathwayNoAutonomousExecution(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      pathwayStepsSourced: stepsSourced,
      pathwaySequenceValid: sequenceValid,
      pathwayNoAutonomousExecution: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "pathway.topological-sort.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        pathwayStepsSourced: stepsSourced,
        pathwaySequenceValid: sequenceValid,
        pathwayNoAutonomousExecution: noAutonomous,
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
          `Pause Agent Fabric blocked this care-pathway run: ${governance.blockingViolations
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

  const summary = carePathwaySummary(determination);

  // Receive-steps span — the fabric records the pathway it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "pathway.receive-steps",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      pathwayRef: request.pathwayRef,
      stepCount: determination.steps.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Check-prerequisites span — the sourced steps, parented to the received pathway.
  const checkSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "pathway.check-prerequisites",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      pathwayStepsSourced: stepsSourced,
      missingCount: summary.missingCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Topological-sort span — the ordered / cycle result, parented to the check.
  const sortSpan = recordInstantSpan({
    taskId,
    parentSpanId: checkSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "pathway.topological-sort",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      stageCount: summary.stageCount,
      cycleCount: summary.cycleCount,
      pathwaySequenceValid: sequenceValid,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the sort.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: sortSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "pathway.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      pathwayNoAutonomousExecution: noAutonomous,
      requiresClinicianReview: determination.requiresClinicianReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage =
    determination.disposition === "sequenced"
      ? `Pathway ${request.pathwayRef} sequenced: ${determination.orderedSteps.length} step(s) across ${summary.stageCount} stage(s) — a recommendation for a clinician, no step executed autonomously (synthetic — illustrative pathway, NOT a certified clinical pathway engine).`
      : determination.disposition === "cannot-sequence-cycle-detected"
        ? `Pathway ${request.pathwayRef} cannot be sequenced: a dependency cycle involves ${determination.cycleMembers.length} step(s) — flagged for clinician review (synthetic — illustrative pathway, NOT a certified clinical pathway engine).`
        : `Pathway ${request.pathwayRef} cannot be sequenced: ${determination.unmetPrerequisites.length} step(s) reference a missing prerequisite — flagged for clinician review (synthetic — illustrative pathway, NOT a certified clinical pathway engine).`;

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
        name: "CarePathwayDetermination",
        description:
          "Deterministically-produced care pathway sequencing. It runs a topological ordering (Kahn's algorithm, ties broken by step id) over the pathway's step dependency graph and reports the disposition — sequenced (the ordered steps, with each step's stage), cannot-sequence-cycle-detected (the steps in a circular dependency), or cannot-sequence-missing-prerequisite (the steps whose prerequisites reference ids absent from the pathway). Every step id in the output references a submitted step (no fabricated / dangling step), the sequence respects every prerequisite (when sequenced, the ordered steps are a complete permutation of the pathway and every step appears after all its prerequisites; when un-sequenceable, no order is asserted), and no step is ever executed — a clinician confirms and orders every one. There is no set-difference, no identity match, no lookup, and no ratio — it is a topological sort + cycle detection, a pure function of the pathway's steps. This is a PHI-bearing agent — the pathway references the patient. The pathways + steps are illustrative, NOT a certified clinical pathway engine — real pathway management uses evidence-based order sets, the patient's clinical context, scheduling / timing constraints, and the care team's judgment.",
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
        pathwayRef: determination.pathwayRef,
        disposition: determination.disposition,
        stepCount: summary.stepCount,
        stageCount: summary.stageCount,
        cycleCount: summary.cycleCount,
        missingCount: summary.missingCount,
        requiresClinicianReview: determination.requiresClinicianReview,
        pathwayStepsSourced: stepsSourced,
        pathwaySequenceValid: sequenceValid,
        pathwayNoAutonomousExecution: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
