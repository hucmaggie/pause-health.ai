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
  type ScheduleConflictDetermination,
  type ScheduleConflictRequest,
  DEMO_SCHEDULE_CONFLICT_REQUEST,
  evaluateScheduleConflict,
  scheduleConflictFree,
  scheduleConflictSummary,
  scheduleIntervalsSourced,
  scheduleNoAutonomousBooking
} from "../../../../../lib/schedule-conflict";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "schedule-conflict-agent";

/**
 * Google A2A `tasks/send` endpoint for the Scheduling Conflict / Double-Booking Guard agent — a
 * care-coordination service on the patient / clinical plane that computes the maximum conflict-free
 * schedule for a resource and waitlists the collisions.
 *
 *   POST /api/agents/schedule-conflict/tasks
 *
 * Loads a scheduling-conflict request and DETERMINISTICALLY evaluates it via evaluateScheduleConflict:
 * it runs the classic activity-selection greedy — sort the requested intervals by earliest finish time
 * and admit each one that doesn't overlap the last admitted, waitlisting the rest. There is no
 * bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, no
 * dollar waterfall, no identity match, and no hash chain — it is greedy interval selection, a pure
 * function of the requested intervals. Every appointment is sourced + accounted for once, the schedule is
 * conflict-free, and nothing is booked — a scheduler confirms every schedule. This is a PHI-bearing agent
 * (phiAccessed:true throughout). The resource + intervals are illustrative; real scheduling uses
 * availability calendars, appointment durations, and buffer times.
 *
 * Enforced-block policies checked before any schedule leaves the fabric:
 *   - policy.schedule.intervals-sourced (signal scheduleIntervalsSourced).
 *   - policy.schedule.conflict-free (signal scheduleConflictFree).
 *   - policy.schedule.no-autonomous-booking (signal scheduleNoAutonomousBooking).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: ScheduleConflictRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if every appointment is sourced + accounted for
 *   once, the schedule is conflict-free, and it is not auto-booked) demonstrates the three governance
 *   blocks.
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
  const taskId = params.id || newTaskId("schedule-conflict");
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
      ? (data.request as ScheduleConflictRequest)
      : DEMO_SCHEDULE_CONFLICT_REQUEST;

  // Deterministic conflict-free schedule.
  const determination = evaluateScheduleConflict(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as ScheduleConflictDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: intervals-sourced + conflict-free + no autonomous booking.
  const intervalsSourced = scheduleIntervalsSourced(determinationForCheck);
  const conflictFree = scheduleConflictFree(determinationForCheck);
  const noAutonomous = scheduleNoAutonomousBooking(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      scheduleIntervalsSourced: intervalsSourced,
      scheduleConflictFree: conflictFree,
      scheduleNoAutonomousBooking: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "schedule.select-intervals.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        scheduleIntervalsSourced: intervalsSourced,
        scheduleConflictFree: conflictFree,
        scheduleNoAutonomousBooking: noAutonomous,
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
          `Pause Agent Fabric blocked this scheduling-conflict run: ${governance.blockingViolations
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

  const summary = scheduleConflictSummary(determination);

  // Receive-requests span — the fabric records the batch it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "schedule.receive-requests",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      resourceRef: request.resourceRef,
      requestCount: determination.totalRequests,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Select-intervals span — the greedy activity-selection, parented to the received batch.
  const selectSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "schedule.select-intervals",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      scheduledCount: determination.scheduledCount,
      conflictCount: determination.conflictCount,
      scheduleIntervalsSourced: intervalsSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Check-conflicts span — the conflict check + disposition, parented to the selection.
  const conflictSpan = recordInstantSpan({
    taskId,
    parentSpanId: selectSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "schedule.check-conflicts",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      scheduleConflictFree: conflictFree,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the schedule recorded to the audit trail, parented to the conflict check.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: conflictSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "schedule.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      scheduleNoAutonomousBooking: noAutonomous,
      requiresSchedulerReview: determination.requiresSchedulerReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage =
    determination.disposition === "conflicts-waitlisted"
      ? `Resource ${request.resourceRef}: ${summary.scheduledCount} of ${determination.totalRequests} request(s) scheduled conflict-free; ${summary.conflictCount} waitlisted (they overlap a scheduled appointment) — a recommendation for a scheduler, no appointment booked autonomously (synthetic — illustrative, NOT a certified scheduling system).`
      : `Resource ${request.resourceRef}: all ${determination.totalRequests} request(s) scheduled conflict-free — no double-booking — a recommendation for a scheduler, no appointment booked autonomously (synthetic — illustrative, NOT a certified scheduling system).`;

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
        name: "ScheduleConflictDetermination",
        description:
          "Deterministically-produced conflict-free schedule for a resource. It runs the classic activity-selection greedy — sorting the requested intervals by earliest finish time and admitting each interval that does not overlap the last admitted, provably maximizing the number of non-overlapping appointments — waitlisting each request that collides (recording which scheduled appointment it conflicts with). Every scheduled / waitlisted appointment traces to a submitted request (same id, member, start, end) and every request is accounted for exactly once (no fabricated appointment, no dropped patient, no double-count); the scheduled set is pairwise non-overlapping (no double-booking) and every waitlist is justified (the request genuinely overlaps the scheduled appointment it names); and no appointment is ever booked, cancelled, or bumped — a scheduler confirms every schedule. There is no bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, no dollar waterfall, no identity match, and no hash chain — it is greedy interval selection, a pure function of the requested intervals. This is a PHI-bearing agent — the requests reference the patients being scheduled. The resource + intervals are illustrative, NOT a certified scheduling system — real scheduling uses provider availability calendars, appointment-type durations, buffer / turnover times, and room / equipment constraints.",
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
        resourceRef: determination.resourceRef,
        disposition: determination.disposition,
        totalRequests: determination.totalRequests,
        scheduledCount: determination.scheduledCount,
        conflictCount: determination.conflictCount,
        requiresSchedulerReview: determination.requiresSchedulerReview,
        scheduleIntervalsSourced: intervalsSourced,
        scheduleConflictFree: conflictFree,
        scheduleNoAutonomousBooking: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
