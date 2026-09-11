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
  type WorklistDetermination,
  type WorklistRequest,
  DEMO_WORKLIST_REQUEST,
  evaluateWorklist,
  noAutonomousDispatch,
  scheduleOrdered,
  scheduleSourced,
  worklistSummary
} from "../../../../../lib/sla-worklist";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "sla-worklist-agent";

/**
 * Google A2A `tasks/send` endpoint for the SLA Worklist Sequencing / Earliest-Deadline-First (EDF) Scheduling
 * agent — a payer-operations work-sequencing service that, given a worklist of pending cases each with a
 * duration + an SLA deadline, orders them EARLIEST-DEADLINE-FIRST and flags the SLA breaches.
 *
 *   POST /api/agents/sla-worklist/tasks
 *
 * Loads a worklist request and DETERMINISTICALLY evaluates it via evaluateWorklist: it orders the cases by
 * deadline ascending (tie-break by case id), processes them sequentially from time zero, and flags each
 * completion that exceeds its deadline. There is no weighted-interval schedule, no greedy interval selection,
 * no Kadane max-subarray, no Dijkstra, no knapsack, no majority vote, no trie match, no k-way merge, no
 * percentile, no union-find, no apportionment, and no checksum — it is EDF scheduling, a pure function of the
 * tasks. The schedule is sourced + self-consistent, EDF-ordered, and nothing is dispatched — a supervisor
 * confirms. It IS PHI-bearing (phiAccessed:true throughout) — each case references the member / claim.
 *
 * Enforced-block policies checked before any schedule leaves the fabric:
 *   - policy.worklist.schedule-sourced (signal worklistScheduleSourced).
 *   - policy.worklist.edf-ordered (signal worklistEdfOrdered).
 *   - policy.worklist.no-autonomous-dispatch (signal worklistNoAutonomousDispatch).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: WorklistRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the schedule is sourced + self-consistent, EDF-ordered, and not
 *   auto-dispatched) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("sla-worklist");
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
      ? (data.request as WorklistRequest)
      : DEMO_WORKLIST_REQUEST;

  // Deterministic EDF sequencing.
  const determination = evaluateWorklist(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as WorklistDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: schedule sourced + self-consistent, order EDF, no autonomous dispatch.
  const sourced = scheduleSourced(determinationForCheck);
  const ordered = scheduleOrdered(determinationForCheck);
  const noAutonomous = noAutonomousDispatch(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      worklistScheduleSourced: sourced,
      worklistEdfOrdered: ordered,
      worklistNoAutonomousDispatch: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "worklist.sequence-edf.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        queueRef: request.queueRef,
        worklistScheduleSourced: sourced,
        worklistEdfOrdered: ordered,
        worklistNoAutonomousDispatch: noAutonomous,
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
          `Pause Agent Fabric blocked this worklist: ${governance.blockingViolations
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

  const summary = worklistSummary(determination);

  // Receive-cases span — the fabric records the worklist it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "worklist.receive-cases",
    protocol: "a2a",
    attributes: {
      queueRef: request.queueRef,
      taskCount: determination.tasks.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Sequence span — EDF scheduling, parented to the received worklist.
  const sequenceSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "worklist.sequence-edf",
    protocol: "a2a",
    attributes: {
      queueRef: request.queueRef,
      lateCount: determination.lateCount,
      worklistScheduleSourced: sourced,
      worklistEdfOrdered: ordered,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the worklist disposition, parented to the sequencing.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: sequenceSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "worklist.classify-disposition",
    protocol: "a2a",
    attributes: {
      queueRef: request.queueRef,
      disposition: determination.disposition,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the worklist recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "worklist.log-audit",
    protocol: "a2a",
    attributes: {
      queueRef: request.queueRef,
      disposition: determination.disposition,
      worklistNoAutonomousDispatch: noAutonomous,
      requiresReviewerReview: determination.requiresReviewerReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, queueRef: request.queueRef };

  const completedMessage =
    determination.lateCount > 0
      ? `SLA worklist complete — ${determination.total} case(s) sequenced earliest-deadline-first, ${determination.lateCount} will breach SLA; a recommendation for a supervisor, nothing dispatched (synthetic — EDF scheduling, NOT a certified workforce system).`
      : `SLA worklist complete — all ${determination.total} case(s) sequenced earliest-deadline-first, all on time; a recommendation for a supervisor, nothing dispatched (synthetic — EDF scheduling, NOT a certified workforce system).`;

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
        name: "WorklistDetermination",
        description:
          "Deterministically-produced SLA worklist schedule. Given a single worklist of pending cases for one processor (a UM nurse's queue, an appeals analyst's desk, a claims-review bench) — each case a unit of work with a processing duration and an SLA deadline — it runs EARLIEST-DEADLINE-FIRST (EDF) SCHEDULING: order the entire worklist by deadline ascending (documented tie-break: earlier deadline first, then lexical case id), then process the cases sequentially from time zero — each case starts when the previous finishes, its completion time is the running cumulative duration, and it breaches when its completion time exceeds its deadline — reporting the ordered worklist, the per-case completion times + lateness, the breach count, and the disposition: all-on-time or breaches-present. EDF is the classic optimal single-processor discipline: if any ordering can meet every deadline, EDF does. The schedule is sourced + self-consistent (a permutation of the submitted cases, each echoing its duration + deadline, the completion times chaining, each late flag honest), EDF-ordered — re-running the EDF discipline reproduces the reported order — and nothing is dispatched, started, or reassigned; a supervisor confirms. There is no weighted-interval schedule, no greedy interval selection, no Kadane max-subarray, no Dijkstra path, no knapsack, no majority vote, no trie match, no k-way merge, no percentile, no union-find, no apportionment, and no checksum — it is EDF scheduling, a pure function of the tasks. It COMPLEMENTS the Resource Scheduling agent (which selects a max-value non-overlapping subset for one resource) and the Caseload Balancing agent (which bin-packs patients across care managers): this ORDERS a whole worklist for one processor by SLA deadline and flags the breaches. It IS PHI-bearing — each case references the member / claim being worked. The worklist is an illustrative synthetic, NOT a certified workforce / queueing system (real worklist management uses staffing levels, skills-based routing, case arrival times, preemption, priority tiers, and shift schedules).",
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
        queueRef: request.queueRef,
        disposition: determination.disposition,
        lateCount: determination.lateCount,
        onTimeCount: determination.onTimeCount,
        total: determination.total,
        taskCount: summary.taskCount,
        requiresReviewerReview: summary.requiresReviewerReview,
        worklistScheduleSourced: sourced,
        worklistEdfOrdered: ordered,
        worklistNoAutonomousDispatch: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
