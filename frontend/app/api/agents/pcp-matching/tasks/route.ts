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
  type PcpMatchingDetermination,
  type PcpMatchingRequest,
  DEMO_PCP_MATCHING_REQUEST,
  evaluatePcpMatching,
  matchingSourced,
  matchingStable,
  noAutonomousAssignment,
  pcpMatchingSummary
} from "../../../../../lib/pcp-matching";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "pcp-matching-agent";

/**
 * Google A2A `tasks/send` endpoint for the Primary Care Provider (PCP) Assignment / Member–Provider
 * Matching agent — a care-coordination service on the patient-care plane that assigns a panel of members to
 * primary care providers using the member-proposing Gale–Shapley deferred-acceptance algorithm, producing
 * the member-optimal STABLE matching.
 *
 *   POST /api/agents/pcp-matching/tasks
 *
 * Loads a PCP-matching request and DETERMINISTICALLY evaluates it via evaluatePcpMatching: it runs the
 * member-proposing deferred acceptance over the members' + providers' preference lists and the providers'
 * capacities, records one assignment per member (with the member's preference rank), tallies the provider
 * loads, and derives all-matched / partial-match. There is no geospatial distance, no checksum, no
 * union-find, no percentile, no identity match, no largest-remainder apportionment, no FSM transition, no
 * edit distance, no interval selection, no bin-packing, no sliding-window count, no interval merge, no
 * topological sort, no set-difference, and no hash chain — it is TWO-SIDED STABLE MATCHING (Gale–Shapley),
 * a pure function of the preferences + capacities. Every assignment is sourced, the matching is stable (no
 * blocking pair), and nothing is committed — a care-coordination lead confirms every matching. This is a
 * PHI-bearing agent (phiAccessed:true throughout). The panel is illustrative; real PCP assignment also
 * weighs geography, language, continuity of care, and plan-network rules.
 *
 * Enforced-block policies checked before any matching leaves the fabric:
 *   - policy.pcp.matching-sourced (signal matchingSourced).
 *   - policy.pcp.matching-stable (signal matchingStable).
 *   - policy.pcp.no-autonomous-assignment (signal pcpNoAutonomousAssignment).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: PcpMatchingRequest, determination?: object } — the request is evaluated; a caller-asserted
 *   `determination` (admissible only if every assignment is sourced, the matching recomputes stably, and it
 *   is not auto-assigned) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("pcp-matching");
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
      ? (data.request as PcpMatchingRequest)
      : DEMO_PCP_MATCHING_REQUEST;

  // Deterministic PCP matching.
  const determination = evaluatePcpMatching(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as PcpMatchingDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: matching-sourced + matching-stable + no autonomous assignment.
  const sourced = matchingSourced(determinationForCheck);
  const stable = matchingStable(determinationForCheck);
  const noAutonomous = noAutonomousAssignment(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      matchingSourced: sourced,
      matchingStable: stable,
      pcpNoAutonomousAssignment: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "pcp.run-deferred-acceptance.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        panelRef: request.panelRef,
        matchingSourced: sourced,
        matchingStable: stable,
        pcpNoAutonomousAssignment: noAutonomous,
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
          `Pause Agent Fabric blocked this PCP-matching run: ${governance.blockingViolations
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

  const summary = pcpMatchingSummary(determination);

  // Receive-panel span — the fabric records the panel it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "pcp.receive-panel",
    protocol: "a2a",
    attributes: {
      panelRef: request.panelRef,
      memberCount: determination.members.length,
      providerCount: determination.providers.length,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Run-deferred-acceptance span — the Gale–Shapley run, parented to the received panel.
  const matchSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "pcp.run-deferred-acceptance",
    protocol: "a2a",
    attributes: {
      panelRef: request.panelRef,
      matchedCount: determination.matchedCount,
      unmatchedCount: determination.unmatchedCount,
      matchingSourced: sourced,
      matchingStable: stable,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the disposition, parented to the matching.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: matchSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "pcp.classify-disposition",
    protocol: "a2a",
    attributes: {
      panelRef: request.panelRef,
      disposition: determination.disposition,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the matching recorded to the audit trail, parented to the disposition.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: classifySpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "pcp.log-audit",
    protocol: "a2a",
    attributes: {
      panelRef: request.panelRef,
      disposition: determination.disposition,
      pcpNoAutonomousAssignment: noAutonomous,
      requiresCoordinatorReview: determination.requiresCoordinatorReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, panelRef: request.panelRef };

  const completedMessage =
    determination.disposition === "all-matched"
      ? `PCP matching complete — all ${determination.total} member(s) matched to a preferred provider in a stable matching (no blocking pair); a recommendation for a care-coordination lead, nothing committed (synthetic — member-optimal Gale–Shapley, NOT a certified panel-management system).`
      : `PCP matching complete — ${determination.matchedCount} of ${determination.total} member(s) matched, ${determination.unmatchedCount} unmatched, in a stable matching (no blocking pair); flagged for a care-coordination lead, nothing committed (synthetic — member-optimal Gale–Shapley, NOT a certified panel-management system).`;

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
        name: "PcpMatchingDetermination",
        description:
          "Deterministically-produced PCP-matching finding. It runs the member-proposing Gale–Shapley deferred-acceptance algorithm over the members' + providers' preference lists and the providers' capacities, producing the member-optimal STABLE matching — one assignment per member (with the member's preference rank), the provider loads, and the disposition: all-matched (every member matched to a preferred provider) or partial-match (some members unmatched — capacity exhausted or short preference lists). Every assignment pairs a submitted member with a submitted provider (no phantom member or provider), the provider loads echo the submitted capacities, and the matching is stable — recomputing the deferred acceptance reproduces the assignment and no member and provider both prefer each other over their current assignment (no blocking pair) and no provider is over capacity; and no assignment is ever committed, no patient reassigned, and no provider panel overridden — a care-coordination lead confirms the matching. There is no geospatial distance, no checksum, no union-find, no percentile, no identity match, no largest-remainder apportionment, no FSM transition, no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, and no hash chain — it is two-sided stable matching (Gale–Shapley), a pure function of the preferences + capacities. This is a PHI-bearing agent — the members are patients. It is DISTINCT from the Caseload Balancing agent (which bin-packs a panel across managers' capacity to balance load, with no preferences and no stability guarantee), the Care Team & Case Management agent (the team around one patient), and the Population Health agent (prioritizing a panel); this produces a stable two-sided matching of members to PCPs. The panel is illustrative synthetics, NOT a certified panel-management system (real PCP assignment also weighs geography, language, continuity of care, plan-network rules, and member choice).",
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
        panelRef: request.panelRef,
        disposition: determination.disposition,
        matchedCount: determination.matchedCount,
        unmatchedCount: determination.unmatchedCount,
        total: determination.total,
        requiresCoordinatorReview: summary.requiresCoordinatorReview,
        matchingSourced: sourced,
        matchingStable: stable,
        pcpNoAutonomousAssignment: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
