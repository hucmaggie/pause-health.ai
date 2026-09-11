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
  type BlockScheduleDetermination,
  type BlockScheduleRequest,
  DEMO_BLOCK_SCHEDULE_REQUEST,
  blockScheduleSummary,
  evaluateBlockSchedule,
  noAutonomousBooking,
  selectionOptimal,
  selectionSourced
} from "../../../../../lib/resource-scheduling";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "resource-scheduling-agent";

/**
 * Google A2A `tasks/send` endpoint for the Resource-Block Scheduling / Max-Value Non-Overlapping Selection
 * agent — a care-coordination capacity-optimization service that, given a shared scarce resource and a batch
 * of competing weighted time-window requests, selects the max-total-weight non-overlapping subset via
 * WEIGHTED INTERVAL SCHEDULING (dynamic programming).
 *
 *   POST /api/agents/resource-scheduling/tasks
 *
 * Loads a scheduling request and DETERMINISTICALLY evaluates it via evaluateBlockSchedule: it sorts by end,
 * computes p(i), fills dp[i] = max(dp[i-1], weight_i + dp[p(i)]), and backtracks for the max-weight
 * compatible subset. There is no greedy interval selection, no bin-packing, no knapsack, no Dijkstra, no
 * majority vote, no trie match, no regression, no CUSUM, no k-way merge, no stable matching, no great-circle
 * distance, no union-find, no percentile, and no checksum — it is a weighted-interval DP, a pure function of
 * the requests. The selection is sourced + feasible, optimal, and nothing is booked — a scheduler confirms.
 * It IS PHI-bearing (phiAccessed:true throughout) — each request references the patient being scheduled.
 *
 * Enforced-block policies checked before any schedule leaves the fabric:
 *   - policy.block-schedule.selection-sourced (signal blockScheduleSourced).
 *   - policy.block-schedule.schedule-optimal (signal blockScheduleOptimal).
 *   - policy.block-schedule.no-autonomous-booking (signal blockScheduleNoAutonomousBooking).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: BlockScheduleRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the selection is sourced + feasible, optimal, and not auto-booked)
 *   demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("resource-scheduling");
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
      ? (data.request as BlockScheduleRequest)
      : DEMO_BLOCK_SCHEDULE_REQUEST;

  // Deterministic weighted-interval-scheduling selection.
  const determination = evaluateBlockSchedule(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as BlockScheduleDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: selection sourced + feasible, selection optimal, no autonomous booking.
  const sourced = selectionSourced(determinationForCheck);
  const optimal = selectionOptimal(determinationForCheck);
  const noAutonomous = noAutonomousBooking(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      blockScheduleSourced: sourced,
      blockScheduleOptimal: optimal,
      blockScheduleNoAutonomousBooking: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "schedule.optimize-selection.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        resourceRef: request.resourceRef,
        blockScheduleSourced: sourced,
        blockScheduleOptimal: optimal,
        blockScheduleNoAutonomousBooking: noAutonomous,
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
          `Pause Agent Fabric blocked this schedule: ${governance.blockingViolations
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

  const summary = blockScheduleSummary(determination);

  // Receive-requests span — the fabric records the resource + requests it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "schedule.receive-requests",
    protocol: "a2a",
    attributes: {
      resourceRef: request.resourceRef,
      requestCount: determination.requests.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Optimize-selection span — the weighted-interval DP, parented to the received requests.
  const optimizeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "schedule.optimize-selection",
    protocol: "a2a",
    attributes: {
      resourceRef: request.resourceRef,
      totalWeight: determination.totalWeight,
      scheduledCount: determination.scheduledCount,
      blockScheduleSourced: sourced,
      blockScheduleOptimal: optimal,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the schedule disposition, parented to the optimization.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: optimizeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "schedule.classify-disposition",
    protocol: "a2a",
    attributes: {
      resourceRef: request.resourceRef,
      disposition: determination.disposition,
      contendedCount: determination.contendedCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the schedule recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "schedule.log-audit",
    protocol: "a2a",
    attributes: {
      resourceRef: request.resourceRef,
      disposition: determination.disposition,
      blockScheduleNoAutonomousBooking: noAutonomous,
      requiresSchedulerReview: determination.requiresSchedulerReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, resourceRef: request.resourceRef };

  const completedMessage =
    determination.contendedCount > 0
      ? `Resource-block schedule complete — ${determination.scheduledCount}/${determination.total} request(s) selected for total weight ${determination.totalWeight}, ${determination.contendedCount} contended; a recommendation for a scheduler, nothing booked (synthetic — weighted interval scheduling, NOT a certified scheduling system).`
      : `Resource-block schedule complete — all ${determination.total} request(s) scheduled for total weight ${determination.totalWeight}; a recommendation for a scheduler, nothing booked (synthetic — weighted interval scheduling, NOT a certified scheduling system).`;

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
        name: "BlockScheduleDetermination",
        description:
          "Deterministically-produced resource-block schedule. Given a single shared scarce resource (an infusion chair, an OR block, a specialist's slot ladder, an imaging machine) and a batch of competing requests for it — each a half-open [start, end) time window with a priority weight (clinical value / acuity) — it runs WEIGHTED INTERVAL SCHEDULING via DYNAMIC PROGRAMMING: sort the requests by end time, compute for each request i the latest earlier request p(i) that does not overlap it, fill dp[i] = max(dp[i-1], weight_i + dp[p(i)]), and backtrack to recover the max-weight compatible subset — selecting the maximum-total-weight set of non-overlapping requests the resource can honor, reporting the rest as contended, and deriving the disposition: all-scheduled or contended. The selection is sourced + feasible (every selected id a submitted request, the selected windows pairwise non-overlapping — the resource is never double-booked — the totalWeight equal to the selected sum, the counts adding up), optimal — re-running the weighted-interval DP reproduces the reported totalWeight + disposition — and nothing is booked, bumped, or confirmed; a scheduler confirms. A greedy earliest-finish rule maximizes the COUNT of appointments but can leave clinical VALUE on the table (two short low-acuity blocks beat one long high-acuity block by count, but not by weight); the DP maximizes the total weight the resource delivers. There is no greedy interval selection, no bin-packing, no knapsack, no Dijkstra shortest path, no majority vote, no trie match, no regression, no CUSUM, no k-way merge, no stable matching, no great-circle distance, no union-find, no percentile, and no checksum — it is a weighted-interval DP, a pure function of the requests. It COMPLEMENTS the Scheduling Conflict agent (which maximizes the COUNT of double-booking-free appointments) and the Caseload Balancing agent (which bin-packs patients across care managers): this picks the max-VALUE non-overlapping set for one contended resource. It IS PHI-bearing — each request references the patient being scheduled. The resource + requests are illustrative synthetics, NOT a certified scheduling / capacity system (real resource scheduling uses provider availability calendars, appointment-type durations, buffer / turnover times, room / equipment constraints, and staffing ratios).",
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
        resourceRef: request.resourceRef,
        disposition: determination.disposition,
        totalWeight: determination.totalWeight,
        scheduledCount: determination.scheduledCount,
        contendedCount: determination.contendedCount,
        total: determination.total,
        requestCount: summary.requestCount,
        requiresSchedulerReview: summary.requiresSchedulerReview,
        blockScheduleSourced: sourced,
        blockScheduleOptimal: optimal,
        blockScheduleNoAutonomousBooking: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
