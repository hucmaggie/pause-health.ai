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
  type ConsensusDetermination,
  type ConsensusRequest,
  DEMO_CONSENSUS_REQUEST,
  consensusConsistent,
  consensusSummary,
  evaluateConsensus,
  noAutonomousWrite,
  votesSourced
} from "../../../../../lib/source-consensus";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "source-consensus-agent";

/**
 * Google A2A `tasks/send` endpoint for the Source-of-Truth Consensus / Golden-Record Field Reconciliation
 * agent — a data-reconciliation / master-data service on the platform & data-substrate plane that, given a
 * single logical field whose value is reported by several source systems, decides whether those votes have a
 * strict-majority consensus via the BOYER–MOORE MAJORITY VOTE.
 *
 *   POST /api/agents/source-consensus/tasks
 *
 * Loads a reconciliation request and DETERMINISTICALLY evaluates it via evaluateConsensus: it runs the
 * Boyer–Moore majority vote over the source votes, derives the consensus, and attributes each source. There
 * is no regression, no knapsack, no CUSUM, no k-way merge, no recursive boolean tree, no stable matching, no
 * geospatial distance, no checksum, no union-find, no percentile, no largest-remainder apportionment, no edit
 * distance, no interval selection, no hash chain, no topological sort, no unweighted BFS hop-count, no
 * Dijkstra shortest path, no keyed set-difference, and no weighted identity match — it is the Boyer–Moore
 * majority vote, a pure function of the votes. The attribution is sourced, the consensus recomputes, and
 * nothing is written — a data steward confirms. This is DELIBERATELY NOT a PHI-bearing agent
 * (phiAccessed:false throughout) — a golden-record reference attribute, not patient health information.
 *
 * Enforced-block policies checked before any reconciliation leaves the fabric:
 *   - policy.consensus.votes-sourced (signal consensusVotesSourced).
 *   - policy.consensus.consensus-consistent (signal consensusConsistent).
 *   - policy.consensus.no-autonomous-write (signal consensusNoAutonomousWrite).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: ConsensusRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the attribution is sourced, the consensus recomputes, and it is not
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
  const taskId = params.id || newTaskId("source-consensus");
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
      ? (data.request as ConsensusRequest)
      : DEMO_CONSENSUS_REQUEST;

  // Deterministic Boyer–Moore majority-vote reconciliation.
  const determination = evaluateConsensus(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as ConsensusDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: votes-sourced + consensus-consistent + no autonomous write.
  const sourced = votesSourced(determinationForCheck);
  const consistent = consensusConsistent(determinationForCheck);
  const noAutonomous = noAutonomousWrite(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      consensusVotesSourced: sourced,
      consensusConsistent: consistent,
      consensusNoAutonomousWrite: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "consensus.run-majority-vote.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        fieldRef: request.fieldRef,
        consensusVotesSourced: sourced,
        consensusConsistent: consistent,
        consensusNoAutonomousWrite: noAutonomous,
        violations: governance.blockingViolations,
        policiesEvaluated: governance.appliesPolicies.length,
        phiAccessed: false,
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

  const summary = consensusSummary(determination);

  // Receive-votes span — the fabric records the source votes it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "consensus.receive-votes",
    protocol: "a2a",
    attributes: {
      fieldRef: request.fieldRef,
      voteCount: determination.votes.length,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Run-majority-vote span — the Boyer–Moore election, parented to the received votes.
  const voteSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "consensus.run-majority-vote",
    protocol: "a2a",
    attributes: {
      fieldRef: request.fieldRef,
      candidate: determination.candidate,
      candidateCount: determination.candidateCount,
      consensusVotesSourced: sourced,
      consensusConsistent: consistent,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-consensus span — the disposition, parented to the election.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: voteSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "consensus.classify-consensus",
    protocol: "a2a",
    attributes: {
      fieldRef: request.fieldRef,
      disposition: determination.disposition,
      hasConsensus: determination.hasConsensus,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the reconciliation recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "consensus.log-audit",
    protocol: "a2a",
    attributes: {
      fieldRef: request.fieldRef,
      disposition: determination.disposition,
      consensusNoAutonomousWrite: noAutonomous,
      requiresStewardReview: determination.requiresStewardReview,
      phiAccessed: false,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, fieldRef: request.fieldRef };

  const completedMessage = determination.hasConsensus
    ? `Source-of-truth reconciliation complete — consensus "${determination.candidate}" (${determination.candidateCount}/${determination.total} sources); a recommendation for a data steward, nothing written (synthetic — Boyer–Moore majority vote, NOT a certified master-data-management / golden-record system).`
    : `Source-of-truth reconciliation complete — NO CONSENSUS on ${determination.fieldRef} across ${determination.total} source vote(s); a recommendation for a data steward, nothing written (synthetic — Boyer–Moore majority vote, NOT a certified master-data-management / golden-record system).`;

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
        name: "ConsensusDetermination",
        description:
          "Deterministically-produced source-of-truth reconciliation finding. Given a single logical field whose value is reported by several source systems, it runs the BOYER–MOORE MAJORITY VOTE — the linear-time, constant-space strict-majority election (a single cancellation pass electing a candidate, plus one verification pass confirming it occurs in more than half the votes) — reporting the consensus value, its count, per-source agreement, and the disposition: consensus (a value carries a strict majority) or no-consensus (no value does). The per-source attribution is sourced (every agreement traces to a submitted vote; no fabricated or dropped source), the consensus recomputes — re-running the majority vote reproduces the winner, its count, the has-consensus flag, and every real source's agreement flag — and no consensus value is written to the golden record, no source is overwritten, and no value is promoted to system-of-record; a data steward confirms. There is no regression, no knapsack, no CUSUM, no k-way merge, no recursive boolean tree, no stable matching, no geospatial distance, no checksum, no union-find, no percentile, no largest-remainder apportionment, no edit distance, no interval selection, no hash chain, no topological sort, no unweighted BFS hop-count, no Dijkstra shortest path, no keyed set-difference, and no weighted identity match — it is the Boyer–Moore majority vote, a pure function of the votes. This is DELIBERATELY NOT a PHI-bearing agent — a golden-record reference attribute, not patient health information. It is DISTINCT from the Enrollment Reconciliation agent (which diffs WHO is on two rosters), the Master-Patient-Index agent (which decides whether two records are the same person), and the Timeline Merge agent (which chronologically merges event streams); this reconciles ONE field's conflicting source values into a golden-record value. The fields + sources + values are illustrative synthetics, NOT a certified master-data-management / golden-record system (real MDM weights sources by trust and recency, resolves value semantics, and survives field-by-field with lineage — not a bare majority of raw string votes).",
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
        fieldRef: request.fieldRef,
        disposition: determination.disposition,
        candidate: determination.candidate,
        candidateCount: determination.candidateCount,
        total: determination.total,
        hasConsensus: determination.hasConsensus,
        voteCount: summary.voteCount,
        requiresStewardReview: summary.requiresStewardReview,
        consensusVotesSourced: sourced,
        consensusConsistent: consistent,
        consensusNoAutonomousWrite: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
