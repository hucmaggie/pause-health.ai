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
  type BatchPartitionDetermination,
  type BatchPartitionRequest,
  DEMO_BATCH_PARTITION_REQUEST,
  batchPartitionSummary,
  evaluateBatchPartition,
  noAutonomousAssign,
  partitionOptimal,
  partitionSourced
} from "../../../../../lib/batch-partition";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "batch-partition-agent";

/**
 * Google A2A `tasks/send` endpoint for the Chart Review Batch Partitioning / Linear Partition
 * (Binary-Search-on-Answer) agent — a care-coordination workload-partitioning service that, given a
 * chronologically / priority-ordered clinical review worklist (each item carrying an effort weight) and a
 * reviewer count k, splits the worklist into k contiguous batches that minimize the busiest reviewer's load.
 *
 *   POST /api/agents/batch-partition/tasks
 *
 * Loads a partition request and DETERMINISTICALLY evaluates it via evaluateBatchPartition: it solves the
 * LINEAR PARTITION problem by BINARY SEARCH ON THE ANSWER (the minimal feasible peak load lies between the
 * single heaviest item and the total weight; a greedy feasibility test is monotonic in the cap), reconstructs
 * the order-preserving split with a DP, reads off the minimal peak load, and derives the disposition. There is
 * no worst-fit-decreasing bin-packing, no Kadane max-subarray, no Huffman code, no LCS diff, no EDF schedule,
 * no Dijkstra path, no knapsack, no stable matching, no interval selection, and no union-find — it is the
 * linear partition problem, a pure function of the weights + reviewer count. The partition is sourced +
 * self-consistent, optimal, and nothing is assigned — a supervisor confirms. It is PHI-adjacent
 * (phiAccessed:true — the item labels reference charts / encounters).
 *
 * Enforced-block policies checked before any partition leaves the fabric:
 *   - policy.batchpartition.partition-sourced (signal batchPartitionSourced).
 *   - policy.batchpartition.load-optimal (signal batchPartitionLoadOptimal).
 *   - policy.batchpartition.no-autonomous-assign (signal batchPartitionNoAutonomousAssign).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: BatchPartitionRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the partition is sourced + self-consistent, optimal, and not
 *   auto-assigned) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("batch-partition");
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
      ? (data.request as BatchPartitionRequest)
      : DEMO_BATCH_PARTITION_REQUEST;

  // Deterministic linear partition.
  const determination = evaluateBatchPartition(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as BatchPartitionDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: partition sourced + self-consistent, load optimal, no autonomous assign.
  const sourced = partitionSourced(determinationForCheck);
  const optimal = partitionOptimal(determinationForCheck);
  const noAutonomous = noAutonomousAssign(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      batchPartitionSourced: sourced,
      batchPartitionLoadOptimal: optimal,
      batchPartitionNoAutonomousAssign: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "batchpartition.partition.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        worklistRef: request.worklistRef,
        batchPartitionSourced: sourced,
        batchPartitionLoadOptimal: optimal,
        batchPartitionNoAutonomousAssign: noAutonomous,
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
          `Pause Agent Fabric blocked this partition: ${governance.blockingViolations
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

  const summary = batchPartitionSummary(determination);

  // Receive-worklist span — the fabric records the ordered worklist it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "batchpartition.receive-worklist",
    protocol: "a2a",
    attributes: {
      worklistRef: request.worklistRef,
      itemCount: determination.items.length,
      batchCount: determination.batchCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Partition span — linear partition / binary search on the answer, parented to the received worklist.
  const partitionSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "batchpartition.partition",
    protocol: "a2a",
    attributes: {
      worklistRef: request.worklistRef,
      maxBatchLoad: determination.maxBatchLoad,
      totalWeight: determination.totalWeight,
      batchPartitionSourced: sourced,
      batchPartitionLoadOptimal: optimal,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the partition disposition, parented to the partition.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: partitionSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "batchpartition.classify-disposition",
    protocol: "a2a",
    attributes: {
      worklistRef: request.worklistRef,
      disposition: determination.disposition,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the partition recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "batchpartition.log-audit",
    protocol: "a2a",
    attributes: {
      worklistRef: request.worklistRef,
      disposition: determination.disposition,
      batchPartitionNoAutonomousAssign: noAutonomous,
      requiresSupervisorReview: determination.requiresSupervisorReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, worklistRef: request.worklistRef };

  const completedMessage =
    determination.disposition === "divisible"
      ? `Partition complete — ${determination.items.length} item(s) of ${request.worklistRef} split across ${determination.batchCount} reviewer(s) with minimal peak load ${determination.maxBatchLoad} (total ${determination.totalWeight}); a recommendation for a supervisor, nothing assigned (synthetic — linear partition, NOT a certified staffing system).`
      : `Partition complete — ${determination.items.length} item(s) of ${request.worklistRef} split across ${determination.batchCount} reviewer(s); peak load ${determination.maxBatchLoad} is bound by the single heaviest item, more reviewers cannot lower it; a recommendation for a supervisor, nothing assigned (synthetic — linear partition, NOT a certified staffing system).`;

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
        name: "BatchPartitionDetermination",
        description:
          "Deterministically-produced chart-review batch partition. Given a CHRONOLOGICALLY / PRIORITY-ORDERED clinical review worklist — each item carrying an effort WEIGHT (estimated review minutes / complexity points) — and a reviewer count k, it solves the LINEAR PARTITION problem by BINARY SEARCH ON THE ANSWER: the minimal feasible peak load lies between the single heaviest item and the total weight, a greedy feasibility test (how many contiguous batches does a candidate cap require?) is monotonic in the cap, so binary search converges on the exact minimal maximum, and an order-preserving DP reconstructs the split into exactly k CONTIGUOUS batches (order preserved) — reporting the batch boundaries, each batch load, the minimal achievable peak load (maxBatchLoad), the heaviest single item, the total weight, and the disposition: divisible (the peak exceeds every single item) or item-bound (one dominant item sets the peak — more reviewers cannot lower it). The linear partition minimum is provably optimal — no contiguous k-way split achieves a smaller maximum. The partition is sourced + self-consistent (the batches, concatenated in order, reproducing exactly the submitted items — nothing dropped / added / reordered / split — with honest loads), optimal — re-running the linear-partition solver reproduces the reported maxBatchLoad — and nothing is assigned or dispatched; a supervisor confirms. CRUCIALLY this is NOT the Caseload Balancing agent's WORST-FIT-DECREASING BIN-PACKING (which reorders unordered members by descending acuity into capacity-bounded panels) and NOT the Peak-Window agent's KADANE MAXIMUM-SUBARRAY (which finds one best contiguous window, not a k-way split); it is also unlike the Huffman agent's OPTIMAL PREFIX CODING, the List Reconciliation agent's LONGEST COMMON SUBSEQUENCE, the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, the Care Routing agent's DIJKSTRA'S SHORTEST PATH, the Outreach agent's 0/1 KNAPSACK, the PCP Matching agent's GALE–SHAPLEY STABLE MATCHING, the Scheduling agent's INTERVAL SELECTION, or the Household Composition agent's UNION-FIND — it is the LINEAR PARTITION problem, a pure function of the weights + reviewer count. It COMPLEMENTS the Caseload Balancing agent (which greedily bin-packs unordered members into capacity-bounded panels): this splits an ORDERED worklist into contiguous batches, provably minimizing the peak. It is PHI-adjacent — the item labels reference charts / encounters, so a partition is on the HIPAA audit path. The weights are an illustrative synthetic, NOT a certified staffing / workforce-management system (real reviewer scheduling weighs skills, certifications, shift rules, breaks, and fatigue — not a bare contiguous split by an effort number).",
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
        worklistRef: request.worklistRef,
        disposition: determination.disposition,
        maxBatchLoad: determination.maxBatchLoad,
        maxItemWeight: determination.maxItemWeight,
        totalWeight: determination.totalWeight,
        itemCount: summary.itemCount,
        batchCount: summary.batchCount,
        requiresSupervisorReview: summary.requiresSupervisorReview,
        batchPartitionSourced: sourced,
        batchPartitionLoadOptimal: optimal,
        batchPartitionNoAutonomousAssign: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
