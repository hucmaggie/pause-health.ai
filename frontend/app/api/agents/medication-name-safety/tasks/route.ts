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
  type MedicationNameSafetyDetermination,
  type MedicationNameSafetyRequest,
  DEMO_MEDICATION_NAME_SAFETY_REQUEST,
  evaluateMedicationNameSafety,
  lasaCandidatesSourced,
  lasaDistancesConsistent,
  lasaNoAutonomousSubstitution,
  medicationNameSafetySummary
} from "../../../../../lib/medication-name-safety";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "medication-name-safety-agent";

/**
 * Google A2A `tasks/send` endpoint for the Medication Name Safety (LASA) agent — a clinical-decision
 * service on the patient / clinical plane that flags look-alike / sound-alike drug-name confusion using
 * edit distance.
 *
 *   POST /api/agents/medication-name-safety/tasks
 *
 * Loads a medication-name-safety request and DETERMINISTICALLY evaluates it via
 * evaluateMedicationNameSafety: it normalizes the prescribed name, computes the Levenshtein edit distance
 * to every catalog drug, finds the nearest match, collects the look-alikes within the threshold, and
 * derives the disposition (recognized-clear / lasa-warning / unrecognized). There is no interval
 * selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no
 * set-difference, no dollar waterfall, no pairwise KB lookup, no exact identity match, and no hash chain
 * — it is string edit distance, a pure function of the name + catalog. Every candidate is sourced, the
 * distances recompute exactly, and nothing is substituted — a pharmacist confirms every finding. This is
 * a PHI-bearing agent (phiAccessed:true throughout). The catalog is illustrative; real LASA safety uses
 * the ISMP / FDA lists, tall-man lettering, and RxNorm vocabularies.
 *
 * Enforced-block policies checked before any finding leaves the fabric:
 *   - policy.lasa.candidates-sourced (signal lasaCandidatesSourced).
 *   - policy.lasa.distances-consistent (signal lasaDistancesConsistent).
 *   - policy.lasa.no-autonomous-substitution (signal lasaNoAutonomousSubstitution).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: MedicationNameSafetyRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if every candidate is sourced, the distances
 *   recompute exactly, and it is not auto-substituted) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("medication-name-safety");
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
      ? (data.request as MedicationNameSafetyRequest)
      : DEMO_MEDICATION_NAME_SAFETY_REQUEST;

  // Deterministic medication-name-safety finding.
  const determination = evaluateMedicationNameSafety(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as MedicationNameSafetyDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: candidates-sourced + distances-consistent + no autonomous substitution.
  const candidatesSourced = lasaCandidatesSourced(determinationForCheck);
  const distancesConsistent = lasaDistancesConsistent(determinationForCheck);
  const noAutonomous = lasaNoAutonomousSubstitution(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      lasaCandidatesSourced: candidatesSourced,
      lasaDistancesConsistent: distancesConsistent,
      lasaNoAutonomousSubstitution: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "lasa.compute-distances.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        lasaCandidatesSourced: candidatesSourced,
        lasaDistancesConsistent: distancesConsistent,
        lasaNoAutonomousSubstitution: noAutonomous,
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
          `Pause Agent Fabric blocked this medication-name-safety run: ${governance.blockingViolations
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

  const summary = medicationNameSafetySummary(determination);

  // Receive-name span — the fabric records the name it received, parented under caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "lasa.receive-name",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      prescribedName: determination.prescribedName,
      catalogSize: determination.catalogSize,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Compute-distances span — the Levenshtein scan, parented to the received name.
  const computeSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "lasa.compute-distances",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      nearestName: summary.nearestName,
      nearestDistance: summary.nearestDistance,
      confusableCount: summary.confusableCount,
      lasaCandidatesSourced: candidatesSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Flag-lookalike span — the disposition, parented to the distance computation.
  const flagSpan = recordInstantSpan({
    taskId,
    parentSpanId: computeSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "lasa.flag-lookalike",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      lasaDistancesConsistent: distancesConsistent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the finding recorded to the audit trail, parented to the flag.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: flagSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "lasa.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      lasaNoAutonomousSubstitution: noAutonomous,
      requiresPharmacistReview: determination.requiresPharmacistReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage =
    determination.disposition === "lasa-warning"
      ? `"${determination.prescribedName}" has ${determination.confusable.length} look-alike / sound-alike name(s) within edit distance ${determination.editDistanceThreshold} — a recommendation for a pharmacist to confirm the intended medication, no substitution made (synthetic — illustrative catalog, NOT a certified medication-safety system).`
      : determination.disposition === "unrecognized"
        ? `"${determination.prescribedName}" is not recognized within edit distance ${determination.editDistanceThreshold} — a recommendation for a pharmacist to confirm, no substitution made (synthetic — illustrative catalog, NOT a certified medication-safety system).`
        : `"${determination.prescribedName}" matches ${determination.nearestMatch?.name} with no look-alike within edit distance ${determination.editDistanceThreshold} — a recommendation for a pharmacist, no substitution made (synthetic — illustrative catalog, NOT a certified medication-safety system).`;

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
        name: "MedicationNameSafetyDetermination",
        description:
          "Deterministically-produced look-alike / sound-alike (LASA) medication-name finding. It normalizes the prescribed name, computes the Levenshtein edit distance to every catalog drug, finds the nearest match, collects the look-alikes within the confusability threshold (0 < distance ≤ threshold), and derives the disposition: recognized-clear (an exact match with no look-alike), lasa-warning (a look-alike within the threshold — a possible wrong-drug confusion or near-miss misspelling), or unrecognized (no exact match and nothing within the threshold). Every candidate — the nearest match and every confusable look-alike — traces to a real catalog drug; the distances recompute exactly from the catalog; and no drug is ever substituted, corrected, or dispensed — a pharmacist confirms the intended medication. There is no interval selection, no bin-packing, no sliding-window count, no interval merge, no topological sort, no set-difference, no dollar waterfall, no pairwise KB lookup, no exact identity match, and no hash chain — it is string edit distance, a pure function of the name + catalog. This is a PHI-bearing agent — the prescribed name is for a patient's medication order. The catalog + names are illustrative, NOT a certified medication-safety system — real LASA safety uses the ISMP / FDA LASA lists, tall-man lettering, RxNorm / First Databank vocabularies, indication / dose context, and barcode scanning.",
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
        patientRef: determination.patientRef,
        disposition: determination.disposition,
        exactMatch: determination.exactMatch,
        nearestName: summary.nearestName,
        nearestDistance: summary.nearestDistance,
        confusableCount: summary.confusableCount,
        editDistanceThreshold: determination.editDistanceThreshold,
        requiresPharmacistReview: determination.requiresPharmacistReview,
        lasaCandidatesSourced: candidatesSourced,
        lasaDistancesConsistent: distancesConsistent,
        lasaNoAutonomousSubstitution: noAutonomous
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
