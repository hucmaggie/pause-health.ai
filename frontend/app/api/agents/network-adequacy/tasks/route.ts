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
  type NetworkAdequacyDetermination,
  type NetworkAdequacyRequest,
  DEMO_NETWORK_ADEQUACY_REQUEST,
  distancesConsistent,
  evaluateNetworkAdequacy,
  networkAdequacySummary,
  noAutonomousNetworkChange,
  providersSourced
} from "../../../../../lib/network-adequacy";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "network-adequacy-agent";

/**
 * Google A2A `tasks/send` endpoint for the Network Adequacy / Time-and-Distance agent — a claims /
 * payer-operations service on the payer & plan operations plane that decides whether a plan's network meets
 * the time-and-distance adequacy standard for a required specialty by computing the great-circle (haversine)
 * distance from the member to each in-network provider.
 *
 *   POST /api/agents/network-adequacy/tasks
 *
 * Loads a network-adequacy request and DETERMINISTICALLY evaluates it via evaluateNetworkAdequacy: it
 * filters the providers to the required specialty, computes the haversine distance from the member to each,
 * sorts ascending, takes the nearest, and decides adequacy-met / adequacy-gap against the standard. There
 * is no checksum, no union-find, no percentile, no identity match, no FSM transition, no edit distance, no
 * interval selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no
 * set-difference, and no hash chain — it is GEOSPATIAL GREAT-CIRCLE DISTANCE (the haversine formula) plus a
 * nearest-neighbor scan and a threshold comparison, a pure function of the coordinates + standard. Every
 * provider is sourced, the distances recompute exactly, and nothing is certified — a network manager
 * confirms every finding. This is a PHI-bearing agent (phiAccessed:true throughout). The member + providers
 * are illustrative; real time-and-distance adequacy uses drive-time isochrones and CMS / state rules.
 *
 * Enforced-block policies checked before any finding leaves the fabric:
 *   - policy.adequacy.providers-sourced (signal providersSourced).
 *   - policy.adequacy.distances-consistent (signal distancesConsistent).
 *   - policy.adequacy.no-autonomous-network-change (signal noAutonomousNetworkChange).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: NetworkAdequacyRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if every provider is sourced, the distances recompute
 *   exactly, and it is not auto-certified) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("network-adequacy");
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
      ? (data.request as NetworkAdequacyRequest)
      : DEMO_NETWORK_ADEQUACY_REQUEST;

  // Deterministic network-adequacy finding.
  const determination = evaluateNetworkAdequacy(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as NetworkAdequacyDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: providers-sourced + distances-consistent + no autonomous network change.
  const sourced = providersSourced(determinationForCheck);
  const consistent = distancesConsistent(determinationForCheck);
  const noAutonomous = noAutonomousNetworkChange(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      providersSourced: sourced,
      distancesConsistent: consistent,
      noAutonomousNetworkChange: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "adequacy.compute-distances.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        caseRef: request.caseRef,
        providersSourced: sourced,
        distancesConsistent: consistent,
        noAutonomousNetworkChange: noAutonomous,
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
          `Pause Agent Fabric blocked this network-adequacy run: ${governance.blockingViolations
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

  const summary = networkAdequacySummary(determination);

  // Receive-request span — the fabric records the request it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "adequacy.receive-request",
    protocol: "a2a",
    attributes: {
      caseRef: request.caseRef,
      requiredSpecialty: determination.requiredSpecialty,
      maxDistanceMiles: determination.maxDistanceMiles,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-distances span — the haversine scan, parented to the received request.
  const computeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "adequacy.compute-distances",
    protocol: "a2a",
    attributes: {
      caseRef: request.caseRef,
      matchingProviderCount: determination.matchingProviderCount,
      nearestDistanceMiles: determination.nearestDistanceMiles,
      providersSourced: sourced,
      distancesConsistent: consistent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Classify-disposition span — the disposition, parented to the distance computation.
  const classifySpan = recordInstantSpan({
    taskId,
    parentSpanId: computeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "adequacy.classify-disposition",
    protocol: "a2a",
    attributes: {
      caseRef: request.caseRef,
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
    operation: "adequacy.log-audit",
    protocol: "a2a",
    attributes: {
      caseRef: request.caseRef,
      disposition: determination.disposition,
      noAutonomousNetworkChange: noAutonomous,
      requiresNetworkReview: determination.requiresNetworkReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, caseRef: request.caseRef };

  const completedMessage =
    determination.disposition === "adequacy-met"
      ? `Network adequacy met for ${determination.requiredSpecialty} — nearest in-network provider ${determination.nearestDistanceMiles} mi away, within the ${determination.maxDistanceMiles} mi standard; a recommendation for a network manager, nothing certified (synthetic — straight-line great-circle distance, NOT a certified network-adequacy engine).`
      : `Network-adequacy GAP for ${determination.requiredSpecialty} — ${determination.nearestDistanceMiles === null ? "no in-network provider submitted" : `nearest in-network provider ${determination.nearestDistanceMiles} mi away, beyond the ${determination.maxDistanceMiles} mi standard`}; flagged for a network manager, nothing certified (synthetic — straight-line great-circle distance, NOT a certified network-adequacy engine).`;

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
        name: "NetworkAdequacyDetermination",
        description:
          "Deterministically-produced network-adequacy finding. It filters the plan's in-network providers to the required specialty, computes the great-circle (haversine) distance from the member's coordinates to each, sorts ascending (providerId tie-break), takes the nearest, and derives the disposition: adequacy-met (a nearest provider within the time-and-distance standard) or adequacy-gap (the nearest exceeds the standard, or there is no in-network provider of that specialty at all). Every evaluated provider is a submitted in-network provider of the required specialty (same id + coordinates, none dropped or invented) and the nearest is one of the evaluated; the distances recompute exactly from the coordinates; and the network is never certified, no gap closed, and no provider added or removed — a network manager confirms the finding. There is no checksum, no union-find, no percentile, no identity match, no FSM transition, no edit distance, no interval selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, and no hash chain — it is geospatial great-circle distance (the haversine formula) plus a nearest-neighbor scan and a threshold comparison, a pure function of the coordinates + standard. This is a PHI-bearing agent — the member's location + the specialty they need is health information. It is DISTINCT from the Provider Credentialing agent (whether a provider is qualified and in the directory), the Referral Management agent (routing a specific referral), and the Provider Benchmarking agent (a provider's cost / quality percentile); this measures whether the network is geographically adequate. It computes STRAIGHT-LINE great-circle distance only — NOT drive time / road distance, and NOT the full CMS 42 CFR 422.116 / state ratio, county-designation, provider-capacity, or telehealth rules; the member + providers + coordinates are illustrative synthetics, NOT a certified network-adequacy engine.",
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
        caseRef: request.caseRef,
        disposition: determination.disposition,
        requiredSpecialty: determination.requiredSpecialty,
        maxDistanceMiles: determination.maxDistanceMiles,
        matchingProviderCount: determination.matchingProviderCount,
        nearestDistanceMiles: determination.nearestDistanceMiles,
        requiresNetworkReview: summary.requiresNetworkReview,
        providersSourced: sourced,
        distancesConsistent: consistent,
        noAutonomousNetworkChange: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
