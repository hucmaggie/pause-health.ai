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
  type ListReconciliationDetermination,
  type ListReconciliationRequest,
  DEMO_LIST_RECONCILIATION_REQUEST,
  diffOptimal,
  diffSourced,
  evaluateListReconciliation,
  listReconciliationSummary,
  noAutonomousUpdate
} from "../../../../../lib/list-reconciliation";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "list-reconciliation-agent";

/**
 * Google A2A `tasks/send` endpoint for the Clinical List Reconciliation / Longest-Common-Subsequence (LCS)
 * Diff agent — a care-coordination reconciliation service that, given two ordered clinical lists (a prior list
 * and a current list), finds the LONGEST COMMON SUBSEQUENCE and derives what was retained, added, and removed.
 *
 *   POST /api/agents/list-reconciliation/tasks
 *
 * Loads a reconciliation request and DETERMINISTICALLY evaluates it via evaluateListReconciliation: it computes
 * the LCS over the two ordered lists (the retained items), then complements it to the removed (prior only) and
 * added (current only) items. There is no Levenshtein edit distance, no keyed set reconciliation, no k-way
 * merge, no EDF schedule, no Kadane max-subarray, no Dijkstra, no knapsack, no majority vote, no trie match,
 * no union-find, no topological order, and no checksum — it is the LONGEST COMMON SUBSEQUENCE, a pure function
 * of the two lists. The diff is sourced + self-consistent, LCS-optimal, and nothing is written back — a
 * clinician confirms. It IS PHI-bearing (phiAccessed:true throughout) — the lists are one patient's record.
 *
 * Enforced-block policies checked before any diff leaves the fabric:
 *   - policy.listdiff.diff-sourced (signal listDiffSourced).
 *   - policy.listdiff.lcs-optimal (signal listDiffLcsOptimal).
 *   - policy.listdiff.no-autonomous-update (signal listDiffNoAutonomousUpdate).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: ListReconciliationRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if the diff is sourced + self-consistent, LCS-optimal,
 *   and not auto-applied) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("list-reconciliation");
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
      ? (data.request as ListReconciliationRequest)
      : DEMO_LIST_RECONCILIATION_REQUEST;

  // Deterministic LCS reconciliation.
  const determination = evaluateListReconciliation(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as ListReconciliationDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: diff sourced + self-consistent, subsequence longest, no autonomous update.
  const sourced = diffSourced(determinationForCheck);
  const optimal = diffOptimal(determinationForCheck);
  const noAutonomous = noAutonomousUpdate(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      listDiffSourced: sourced,
      listDiffLcsOptimal: optimal,
      listDiffNoAutonomousUpdate: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "listdiff.diff-lcs.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        recordRef: request.recordRef,
        listDiffSourced: sourced,
        listDiffLcsOptimal: optimal,
        listDiffNoAutonomousUpdate: noAutonomous,
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
          `Pause Agent Fabric blocked this reconciliation: ${governance.blockingViolations
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

  const summary = listReconciliationSummary(determination);

  // Receive-lists span — the fabric records the two lists it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "listdiff.receive-lists",
    protocol: "a2a",
    attributes: {
      recordRef: request.recordRef,
      priorCount: determination.prior.length,
      currentCount: determination.current.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Diff span — LCS reconciliation, parented to the received lists.
  const diffSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "listdiff.diff-lcs",
    protocol: "a2a",
    attributes: {
      recordRef: request.recordRef,
      lcsLength: determination.lcsLength,
      listDiffSourced: sourced,
      listDiffLcsOptimal: optimal,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the reconciliation disposition, parented to the diff.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: diffSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "listdiff.classify-disposition",
    protocol: "a2a",
    attributes: {
      recordRef: request.recordRef,
      disposition: determination.disposition,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the reconciliation recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "listdiff.log-audit",
    protocol: "a2a",
    attributes: {
      recordRef: request.recordRef,
      disposition: determination.disposition,
      listDiffNoAutonomousUpdate: noAutonomous,
      requiresClinicianReview: determination.requiresClinicianReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, recordRef: request.recordRef };

  const completedMessage =
    determination.disposition === "changes-present"
      ? `List reconciliation complete — ${determination.retained.length} retained, ${determination.added.length} added, ${determination.removed.length} removed via longest common subsequence; a recommendation for a clinician, nothing written back (synthetic — LCS diff, NOT a certified medication-reconciliation system).`
      : `List reconciliation complete — the lists match, no changes; a recommendation for a clinician, nothing written back (synthetic — LCS diff, NOT a certified medication-reconciliation system).`;

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
        name: "ListReconciliationDetermination",
        description:
          "Deterministically-produced clinical list reconciliation. Given two ordered clinical lists for one record — a prior list (the medication list at admission, the problem list at last visit, the care-plan steps as last agreed) and a current list (the same list now) — it runs the LONGEST COMMON SUBSEQUENCE: a dynamic-programming table over the two ordered lists finds the longest subsequence common to both (the items preserved in both, in their shared order), and its complement in each list is what was removed (prior only) and added (current only) — reporting the retained / added / removed items, the LCS length, and the disposition: lists-match or changes-present. Order matters — LCS respects the sequence — which is exactly what set reconciliation throws away. The diff is sourced + self-consistent (the retained list a genuine common subsequence of both, the removed / added exactly the unmatched complements, the lcsLength matching, the disposition following), LCS-optimal — re-running the LCS dynamic program reproduces the reported lcsLength — and nothing is written back, chart-updated, or medication-changed; a clinician confirms. There is no Levenshtein edit distance, no keyed set reconciliation, no k-way merge, no EDF schedule, no Kadane max-subarray, no Dijkstra path, no knapsack, no majority vote, no trie match, no union-find, no topological order, and no checksum — it is the longest common subsequence, a pure function of the two lists. It COMPLEMENTS the Medication Name Safety agent (which measures character-level edit distance between two drug-name strings) and the Enrollment Reconciliation agent (which joins two record sets on a key, order-independent): this DIFFS two ORDERED lists respecting sequence. It IS PHI-bearing — the lists are one patient's clinical record. The lists are an illustrative synthetic, NOT a certified medication-reconciliation system (real medication / problem-list reconciliation normalizes to RxNorm / SNOMED and accounts for dose, route, frequency, therapeutic equivalence, and clinical intent).",
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
        retainedCount: determination.retained.length,
        addedCount: determination.added.length,
        removedCount: determination.removed.length,
        lcsLength: determination.lcsLength,
        priorCount: summary.priorCount,
        currentCount: summary.currentCount,
        requiresClinicianReview: summary.requiresClinicianReview,
        listDiffSourced: sourced,
        listDiffLcsOptimal: optimal,
        listDiffNoAutonomousUpdate: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
