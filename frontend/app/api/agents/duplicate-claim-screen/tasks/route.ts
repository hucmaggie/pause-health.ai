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
  type DuplicateScreenDetermination,
  type DuplicateScreenRequest,
  DEMO_DUPLICATE_SCREEN_REQUEST,
  duplicateScreenSummary,
  evaluateDuplicateScreen,
  filterSourced,
  membershipExact,
  noAutonomousReject
} from "../../../../../lib/duplicate-claim-screen";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "duplicate-claim-screen-agent";

/**
 * Google A2A `tasks/send` endpoint for the Duplicate-Claim Pre-Screen / Bloom-Filter Membership Test agent — a
 * payer-operations claims pre-screen service that, given a set of already-processed claim ids and a batch of
 * incoming claim ids, builds a Bloom filter over the processed ids and screens each incoming id as
 * definitely-new (provably never processed) or possibly-duplicate (route to the authoritative exact check).
 *
 *   POST /api/agents/duplicate-claim-screen/tasks
 *
 * Loads a request and DETERMINISTICALLY evaluates it via evaluateDuplicateScreen: it builds the BLOOM FILTER
 * (set k seeded-hash bits per processed id) and queries each incoming id (all k bits set ⇒ possibly-duplicate,
 * any clear ⇒ definitely-new — a Bloom filter has NO false negatives). There is no keyed set-difference, no
 * majority vote, no k-way merge, no hash chain, no checksum, and no trie — it is Bloom-filter membership, a pure
 * function of the ids + config. The filter is sourced + self-consistent, membership-exact (no false negatives),
 * and nothing is rejected — a claims adjudicator confirms. It is PHI-adjacent (phiAccessed:true — claim ids).
 *
 * A possible-duplicates disposition is a LEGITIMATE FINDING (some ids need the authoritative check), NOT a
 * governance block. Enforced-block policies checked before any screen leaves the fabric:
 *   - policy.dupscreen.filter-sourced (signal dupScreenFilterSourced).
 *   - policy.dupscreen.membership-exact (signal dupScreenMembershipExact).
 *   - policy.dupscreen.no-autonomous-reject (signal dupScreenNoAutonomousReject).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: DuplicateScreenRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if the filter is sourced + self-consistent, membership-exact, and not
 *   auto-rejected) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("duplicate-claim-screen");
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
      ? (data.request as DuplicateScreenRequest)
      : DEMO_DUPLICATE_SCREEN_REQUEST;

  // Deterministic Bloom-filter pre-screen.
  const determination = evaluateDuplicateScreen(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as DuplicateScreenDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: filter sourced + self-consistent, membership exact, no autonomous reject.
  const sourced = filterSourced(determinationForCheck);
  const exact = membershipExact(determinationForCheck);
  const noAutonomous = noAutonomousReject(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      dupScreenFilterSourced: sourced,
      dupScreenMembershipExact: exact,
      dupScreenNoAutonomousReject: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "dupscreen.screen.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        batchRef: request.batchRef,
        dupScreenFilterSourced: sourced,
        dupScreenMembershipExact: exact,
        dupScreenNoAutonomousReject: noAutonomous,
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
          `Pause Agent Fabric blocked this pre-screen: ${governance.blockingViolations
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

  const summary = duplicateScreenSummary(determination);

  // Receive-batch span — the fabric records the batch it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "dupscreen.receive-batch",
    protocol: "a2a",
    attributes: {
      batchRef: request.batchRef,
      processedCount: determination.processedCount,
      incomingCount: determination.incomingCount,
      bitSize: determination.bitSize,
      hashCount: determination.hashCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Screen span — Bloom-filter membership test, parented to the received batch.
  const screenSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "dupscreen.screen",
    protocol: "a2a",
    attributes: {
      batchRef: request.batchRef,
      possibleDuplicateCount: determination.possibleDuplicateCount,
      definitelyNewCount: determination.definitelyNewCount,
      estimatedFalsePositiveRate: determination.estimatedFalsePositiveRate,
      dupScreenFilterSourced: sourced,
      dupScreenMembershipExact: exact,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the screen disposition, parented to the screen.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: screenSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "dupscreen.classify-disposition",
    protocol: "a2a",
    attributes: {
      batchRef: request.batchRef,
      disposition: determination.disposition,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the screen recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "dupscreen.log-audit",
    protocol: "a2a",
    attributes: {
      batchRef: request.batchRef,
      disposition: determination.disposition,
      dupScreenNoAutonomousReject: noAutonomous,
      requiresAdjudicatorReview: determination.requiresAdjudicatorReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, batchRef: request.batchRef };

  const completedMessage =
    determination.disposition === "all-clear"
      ? `Pre-screen complete — all ${determination.incomingCount} incoming claim id(s) in ${request.batchRef} are definitely new (est. FP ${determination.estimatedFalsePositiveRate}); a recommendation for a claims adjudicator, nothing rejected (synthetic — Bloom filter, NOT a certified claims-dedup system).`
      : `Pre-screen complete — ${determination.possibleDuplicateCount} of ${determination.incomingCount} incoming claim id(s) in ${request.batchRef} are possible duplicates to route to the authoritative check (${determination.definitelyNewCount} definitely new, est. FP ${determination.estimatedFalsePositiveRate}); a recommendation for a claims adjudicator, nothing rejected (synthetic — Bloom filter, NOT a certified claims-dedup system).`;

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
        name: "DuplicateScreenDetermination",
        description:
          "Deterministically-produced duplicate-claim pre-screen. Given a set of already-PROCESSED claim ids and a batch of INCOMING claim ids, it builds a BLOOM FILTER over the processed ids (a fixed bit array of size m, probed by k seeded hash functions via double hashing) and screens each incoming id: all k bits set ⇒ POSSIBLY-DUPLICATE (route to the authoritative exact check), any bit clear ⇒ DEFINITELY-NEW (provably never processed — a Bloom filter has NO false negatives). If no incoming id is possibly-duplicate the disposition is all-clear; otherwise possible-duplicates (the honest finding that some ids need the exact check — NOT an error). The one-sided guarantee (no false negatives) and the honest false-positive rate ((1 - e^(-k*n/m))^k) are the invariants. The filter is sourced + self-consistent (the reported bit array is the exact insert of the processed ids, the set-bit count honest, each verdict consistent with the array), membership-exact — re-building the filter and re-querying reproduces every verdict AND never reports a known duplicate as definitely-new — and nothing is rejected or denied; a claims adjudicator confirms, and a possibly-duplicate ALWAYS defers to the exact check. CRUCIALLY this is NOT the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE (an exact two-roster diff — this is a probabilistic one-sided membership pre-screen with a tunable false-positive rate and no per-key storage), NOT the Source Consensus agent's BOYER–MOORE MAJORITY VOTE, NOT the Timeline Merge agent's K-WAY MERGE, NOT the Audit Log Integrity agent's HASH CHAIN, NOT the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, and NOT the Code Taxonomy agent's TRIE LONGEST-PREFIX MATCH — it is Bloom-filter membership, a pure function of the ids + config. It is PHI-adjacent — claim ids are PHI-adjacent, so a determination is on the HIPAA audit path. The ids are an illustrative synthetic, NOT a certified claims-dedup / payment-integrity system (real duplicate-claim detection weighs the full claim key (member, provider, DOS, procedure, units), adjustment / void logic, and an authoritative claims store — not a bare Bloom pre-screen over illustrative ids).",
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
        batchRef: request.batchRef,
        disposition: determination.disposition,
        possibleDuplicateCount: determination.possibleDuplicateCount,
        definitelyNewCount: determination.definitelyNewCount,
        estimatedFalsePositiveRate: determination.estimatedFalsePositiveRate,
        setBitCount: determination.setBitCount,
        processedCount: summary.processedCount,
        incomingCount: summary.incomingCount,
        requiresAdjudicatorReview: summary.requiresAdjudicatorReview,
        dupScreenFilterSourced: sourced,
        dupScreenMembershipExact: exact,
        dupScreenNoAutonomousReject: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
