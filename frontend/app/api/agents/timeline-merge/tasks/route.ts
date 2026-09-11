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
  type TimelineMergeDetermination,
  type TimelineMergeRequest,
  DEMO_TIMELINE_MERGE_REQUEST,
  eventsSourced,
  evaluateTimelineMerge,
  mergeConsistent,
  noAutonomousMerge,
  timelineMergeSummary
} from "../../../../../lib/timeline-merge";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "timeline-merge-agent";

/**
 * Google A2A `tasks/send` endpoint for the Clinical Event Timeline Merge / Multi-Source Record
 * Reconciliation agent — a platform / data-substrate service on the platform & data-substrate plane that
 * merges a patient's clinical events from several already-sorted source streams into one chronological
 * unified timeline using the K-WAY MERGE OF SORTED STREAMS, flagging cross-source duplicates.
 *
 *   POST /api/agents/timeline-merge/tasks
 *
 * Loads a timeline-merge request and DETERMINISTICALLY evaluates it via evaluateTimelineMerge: it k-way
 * merges the sorted streams into one chronological order, flags the duplicates by content key, tallies the
 * per-source contributions, and derives clean-merge / duplicates-found. There is no recursive boolean tree,
 * no stable matching, no geospatial distance, no checksum, no union-find, no percentile, no identity match,
 * no largest-remainder apportionment, no FSM transition, no edit distance, no interval selection, no
 * bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, and no
 * hash chain — it is the k-way merge of sorted streams, a pure function of the streams. Every event is
 * sourced, the merge recomputes, and nothing is written back — a data steward confirms every merge. This is
 * a PHI-bearing agent (phiAccessed:true throughout). The events are illustrative; real record reconciliation
 * resolves identity first (an EMPI) and applies source-of-truth precedence rules.
 *
 * Enforced-block policies checked before any merge leaves the fabric:
 *   - policy.timeline.events-sourced (signal timelineEventsSourced).
 *   - policy.timeline.merge-consistent (signal timelineMergeConsistent).
 *   - policy.timeline.no-autonomous-merge (signal timelineNoAutonomousMerge).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: TimelineMergeRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if every event is sourced, the merge recomputes, and it is not
 *   auto-written) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("timeline-merge");
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
      ? (data.request as TimelineMergeRequest)
      : DEMO_TIMELINE_MERGE_REQUEST;

  // Deterministic timeline merge.
  const determination = evaluateTimelineMerge(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as TimelineMergeDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: events-sourced + merge-consistent + no autonomous merge.
  const sourced = eventsSourced(determinationForCheck);
  const consistent = mergeConsistent(determinationForCheck);
  const noAutonomous = noAutonomousMerge(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      timelineEventsSourced: sourced,
      timelineMergeConsistent: consistent,
      timelineNoAutonomousMerge: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "timeline.merge-streams.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        recordRef: request.recordRef,
        timelineEventsSourced: sourced,
        timelineMergeConsistent: consistent,
        timelineNoAutonomousMerge: noAutonomous,
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
          `Pause Agent Fabric blocked this timeline merge: ${governance.blockingViolations
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

  const summary = timelineMergeSummary(determination);

  // Receive-streams span — the fabric records the streams it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "timeline.receive-streams",
    protocol: "a2a",
    attributes: {
      recordRef: request.recordRef,
      streamCount: determination.streams.length,
      totalSubmitted: determination.totalSubmitted,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Merge-streams span — the k-way merge, parented to the received streams.
  const mergeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "timeline.merge-streams",
    protocol: "a2a",
    attributes: {
      recordRef: request.recordRef,
      keptCount: determination.keptCount,
      duplicateCount: determination.duplicateCount,
      timelineEventsSourced: sourced,
      timelineMergeConsistent: consistent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the disposition, parented to the merge.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: mergeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "timeline.classify-disposition",
    protocol: "a2a",
    attributes: {
      recordRef: request.recordRef,
      disposition: determination.disposition,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the merge recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "timeline.log-audit",
    protocol: "a2a",
    attributes: {
      recordRef: request.recordRef,
      disposition: determination.disposition,
      timelineNoAutonomousMerge: noAutonomous,
      requiresStewardReview: determination.requiresStewardReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, recordRef: request.recordRef };

  const completedMessage =
    determination.disposition === "duplicates-found"
      ? `Timeline merge complete — ${determination.totalSubmitted} events from ${determination.streams.length} source(s) merged into ${determination.keptCount} unique event(s), ${determination.duplicateCount} duplicate(s) flagged; a recommendation for a data steward, nothing written back (synthetic — k-way merge of sorted streams, NOT a certified record-reconciliation / EMPI system).`
      : `Timeline merge complete — ${determination.totalSubmitted} events from ${determination.streams.length} source(s) merged into a clean chronological timeline, no duplicates; a recommendation for a data steward, nothing written back (synthetic — k-way merge of sorted streams, NOT a certified record-reconciliation / EMPI system).`;

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
        name: "TimelineMergeDetermination",
        description:
          "Deterministically-produced timeline-merge finding. It takes a patient's clinical events in several already-sorted source streams and runs the K-WAY MERGE OF SORTED STREAMS — repeatedly taking the earliest head across the stream cursors to produce one globally-ordered chronological sequence — plus a content-key deduplication pass that flags the second-and-later report of the same clinical event, reporting the merged timeline (each entry with a duplicate-of link), the per-source contributions, the kept / duplicate / total tallies, and the disposition: clean-merge (no duplicates) or duplicates-found (the same clinical event reported by more than one source). Every timeline entry traces to a submitted stream event (no fabricated event), every submitted event appears exactly once (none dropped or double-listed), the merge recomputes — re-running the k-way merge reproduces the chronological order and the duplicate flags — and no timeline is ever written back to a source of record, no duplicate purged, and no chart overwritten; a data steward confirms the merge. There is no recursive boolean tree, no stable matching, no geospatial distance, no checksum, no union-find, no percentile, no identity match, no largest-remainder apportionment, no FSM transition, no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, and no hash chain — it is the k-way merge of sorted streams, a pure function of the streams. This is a PHI-bearing agent — the events are a patient's clinical data. It is DISTINCT from the Master Patient Index agent (which resolves identity across systems), the Enrollment Reconciliation agent (a keyed set-difference between two rosters), and the Transitions of Care agent (medication reconciliation for one encounter); this merges a patient's already-resolved event streams into one timeline. The events are illustrative synthetics, NOT a certified record-reconciliation / EMPI system (real reconciliation resolves identity first via an EMPI, reconciles with FHIR resource provenance, and applies source-of-truth precedence rules).",
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
        recordRef: request.recordRef,
        disposition: determination.disposition,
        totalSubmitted: determination.totalSubmitted,
        keptCount: determination.keptCount,
        duplicateCount: determination.duplicateCount,
        sourceCount: summary.sourceCount,
        requiresStewardReview: summary.requiresStewardReview,
        timelineEventsSourced: sourced,
        timelineMergeConsistent: consistent,
        timelineNoAutonomousMerge: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
