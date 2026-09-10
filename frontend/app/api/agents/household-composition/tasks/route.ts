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
  type HouseholdCompositionDetermination,
  type HouseholdCompositionRequest,
  DEMO_HOUSEHOLD_COMPOSITION_REQUEST,
  evaluateHouseholdComposition,
  householdCompositionSummary,
  householdLinksSourced,
  householdNoAutonomousMerge,
  householdPartitionConsistent
} from "../../../../../lib/household-composition";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "household-composition-agent";

/**
 * Google A2A `tasks/send` endpoint for the Household / Family-Unit Composition agent — a claims /
 * payer-operations service on the payer & plan operations plane that groups plan members into households
 * by computing the connected components of a relationship graph via union-find.
 *
 *   POST /api/agents/household-composition/tasks
 *
 * Loads a household-composition request and DETERMINISTICALLY evaluates it via
 * evaluateHouseholdComposition: it de-dupes the members, applies the links (only those between submitted
 * members), computes the connected components via union-find (the transitive closure of the relationship
 * links), and derives the disposition (all-singletons / households-formed). There is no percentile, no FSM
 * transition, no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval
 * merge, no topological sort, no set-difference, no dollar waterfall, no pairwise KB lookup, and no hash
 * chain — it is union-find / disjoint-set connected components, a pure function of the members + links.
 * Every link + household is sourced, the partition recomputes exactly, and nothing is merged — a data
 * steward confirms every grouping. This is a PHI-bearing agent (phiAccessed:true throughout). The members
 * + links are illustrative; real household composition uses the 834 subscriber / dependent structure.
 *
 * Enforced-block policies checked before any finding leaves the fabric:
 *   - policy.household.links-sourced (signal householdLinksSourced).
 *   - policy.household.partition-consistent (signal householdPartitionConsistent).
 *   - policy.household.no-autonomous-merge (signal householdNoAutonomousMerge).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: HouseholdCompositionRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if every link + household is sourced, the partition
 *   recomputes exactly, and it is not auto-merged) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("household-composition");
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
      ? (data.request as HouseholdCompositionRequest)
      : DEMO_HOUSEHOLD_COMPOSITION_REQUEST;

  // Deterministic household-composition finding.
  const determination = evaluateHouseholdComposition(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as HouseholdCompositionDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: links-sourced + partition-consistent + no autonomous merge.
  const linksSourced = householdLinksSourced(determinationForCheck);
  const partitionConsistent = householdPartitionConsistent(determinationForCheck);
  const noAutonomous = householdNoAutonomousMerge(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      householdLinksSourced: linksSourced,
      householdPartitionConsistent: partitionConsistent,
      householdNoAutonomousMerge: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "household.compute-components.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        batchRef: request.batchRef,
        householdLinksSourced: linksSourced,
        householdPartitionConsistent: partitionConsistent,
        householdNoAutonomousMerge: noAutonomous,
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
          `Pause Agent Fabric blocked this household-composition run: ${governance.blockingViolations
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

  const summary = householdCompositionSummary(determination);

  // Receive-batch span — the fabric records the batch it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "household.receive-batch",
    protocol: "a2a",
    attributes: {
      batchRef: request.batchRef,
      memberCount: determination.memberCount,
      linkCount: summary.linkCount,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-components span — the union-find, parented to the received batch.
  const computeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "household.compute-components",
    protocol: "a2a",
    attributes: {
      batchRef: request.batchRef,
      householdCount: determination.householdCount,
      largestHouseholdSize: determination.largestHouseholdSize,
      householdLinksSourced: linksSourced,
      householdPartitionConsistent: partitionConsistent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the disposition, parented to the component computation.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: computeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "household.classify-disposition",
    protocol: "a2a",
    attributes: {
      batchRef: request.batchRef,
      disposition: determination.disposition,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the finding recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "household.log-audit",
    protocol: "a2a",
    attributes: {
      batchRef: request.batchRef,
      disposition: determination.disposition,
      householdNoAutonomousMerge: noAutonomous,
      requiresStewardReview: determination.requiresStewardReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, batchRef: request.batchRef };

  const completedMessage =
    determination.disposition === "households-formed"
      ? `${determination.householdCount} household(s) formed from ${determination.memberCount} member(s) (largest ${determination.largestHouseholdSize}) — a recommendation for a data steward, no records merged (synthetic — illustrative members + links, NOT a certified enrollment / MDM system).`
      : `No households formed — all ${determination.memberCount} member(s) are singletons; a recommendation for a data steward, no records merged (synthetic — illustrative members + links, NOT a certified enrollment / MDM system).`;

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
        name: "HouseholdCompositionDetermination",
        description:
          "Deterministically-produced household grouping. It de-dupes the members, applies the relationship links (only those between submitted members), computes the connected components of the relationship graph via union-find (the transitive closure of the links — so a member linked to a member linked to a third all land in one household even when the first and third are not directly linked), and derives the disposition: all-singletons (no household has more than one member) or households-formed (at least one multi-member household). Every link connects two submitted members and the households partition exactly the submitted members (each member in exactly one household, all covered, none invented); the partition recomputes exactly from the links; and no member records are merged, enrollment changed, or family accumulator applied — a data steward confirms the grouping. There is no percentile, no FSM transition, no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, no dollar waterfall, no pairwise KB lookup, and no hash chain — it is union-find / disjoint-set connected components, a pure function of the members + links. This is a PHI-bearing agent — the members are patients. It is DISTINCT from the Master-Patient-Index agent (which matches records of the SAME person across systems); this GROUPS distinct members into a family unit. The members + links are illustrative, NOT a certified enrollment / MDM system — real household / family-unit composition uses the 834 subscriber / dependent structure, address normalization, tax-household rules, and a master-data-management steward's judgment.",
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
        householdCount: determination.householdCount,
        largestHouseholdSize: determination.largestHouseholdSize,
        memberCount: determination.memberCount,
        linkCount: summary.linkCount,
        requiresStewardReview: determination.requiresStewardReview,
        householdLinksSourced: linksSourced,
        householdPartitionConsistent: partitionConsistent,
        householdNoAutonomousMerge: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
