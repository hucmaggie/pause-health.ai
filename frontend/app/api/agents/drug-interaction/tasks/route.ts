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
  type DrugInteractionDetermination,
  type DrugInteractionRequest,
  DEMO_DRUG_INTERACTION_REQUEST,
  ddiInteractionSourced,
  ddiNoAutonomousHoldOrOverride,
  ddiSeverityConsistent,
  drugInteractionSummary,
  evaluateDrugInteractions
} from "../../../../../lib/drug-interaction";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "drug-interaction-agent";

/**
 * Google A2A `tasks/send` endpoint for the Drug–Drug Interaction (DDI) Safety Check agent — a
 * clinical-decision service on the patient / clinical plane that screens a proposed medication against
 * the patient's active medication list.
 *
 *   POST /api/agents/drug-interaction/tasks
 *
 * Loads a screen request and DETERMINISTICALLY evaluates it via evaluateDrugInteractions: it pairs the
 * proposed drug with each active medication, looks up every recorded interaction, ranks them by
 * severity, and decides the disposition. There is no date math and no dollar waterfall — it is a
 * pairwise knowledge-base lookup + severity ranking, a pure function of the request's own fields.
 * Every reported interaction cites a recorded record, the overall severity is consistent with the
 * detected interactions, and the order is never autonomously held or the alert overridden — a
 * pharmacist / prescriber acts on every finding. This is a PHI-bearing agent (phiAccessed:true
 * throughout). The knowledge base is illustrative; real interaction checking uses a maintained
 * compendium and the clinician's judgment.
 *
 * Enforced-block policies checked before any finding is acted on:
 *   - policy.ddi.interaction-sourced (signal ddiInteractionSourced).
 *   - policy.ddi.severity-consistent (signal ddiSeverityConsistent).
 *   - policy.ddi.no-autonomous-hold-or-override (signal ddiNoAutonomousHoldOrOverride).
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: DrugInteractionRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if every interaction is cataloged, the severity
 *   is consistent, and no auto hold/override) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("drug-interaction");
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
      ? (data.request as DrugInteractionRequest)
      : DEMO_DRUG_INTERACTION_REQUEST;

  // Deterministic DDI screen.
  const determination = evaluateDrugInteractions(request);

  // The determination the governance gates check: the caller-asserted one (to demonstrate the
  // blocks) or the produced one.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as DrugInteractionDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: interaction-sourced + severity-consistent + no autonomous hold/override.
  const interactionSourced = ddiInteractionSourced(determinationForCheck);
  const severityConsistent = ddiSeverityConsistent(determinationForCheck);
  const noAutonomous = ddiNoAutonomousHoldOrOverride(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      ddiInteractionSourced: interactionSourced,
      ddiSeverityConsistent: severityConsistent,
      ddiNoAutonomousHoldOrOverride: noAutonomous
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "ddi.match-interactions.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        requestRef: request.requestRef,
        ddiInteractionSourced: interactionSourced,
        ddiSeverityConsistent: severityConsistent,
        ddiNoAutonomousHoldOrOverride: noAutonomous,
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
          `Pause Agent Fabric blocked this drug-interaction run: ${governance.blockingViolations
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

  const summary = drugInteractionSummary(determination);

  // Receive-order span — the fabric records the screen request it received, parented under the caller.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "ddi.receive-order",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      patientRef: request.patientRef,
      proposedDrug: determination.proposedDrug,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Match-interactions span — the detected interactions, parented to the received order.
  const matchSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "ddi.match-interactions",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      interactionCount: determination.interactionCount,
      ddiInteractionSourced: interactionSourced,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Rank-severity span — the overall severity + disposition, parented to the matched interactions.
  const rankSpan = recordInstantSpan({
    taskId,
    parentSpanId: matchSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "ddi.rank-severity",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      overallSeverity: determination.overallSeverity,
      disposition: determination.disposition,
      ddiSeverityConsistent: severityConsistent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the finding recorded to the audit trail, parented to the ranking.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: rankSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "ddi.log-audit",
    protocol: "a2a",
    attributes: {
      requestRef: request.requestRef,
      disposition: determination.disposition,
      ddiNoAutonomousHoldOrOverride: noAutonomous,
      requiresClinicianReview: determination.requiresClinicianReview,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, requestRef: request.requestRef };

  const completedMessage = `DDI screen ${request.requestRef} for ${request.patientRef}: proposed ${determination.proposedDrug} vs ${determination.activeMedicationCount} active med(s) → ${determination.interactionCount} interaction(s), overall severity ${determination.overallSeverity} (${determination.disposition}) — recommendation for a pharmacist / prescriber, no order held or alert overridden autonomously (synthetic — illustrative interaction knowledge base, NOT certified clinical decision support).`;

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
        name: "DrugInteractionDetermination",
        description:
          "Deterministically-produced drug–drug interaction screen. It pairs the proposed drug with each active medication, looks up every recorded interaction in the knowledge base, ranks them by severity (contraindicated / major / moderate / minor), reports the overall severity + mechanism + management, and decides the disposition (no-interaction-detected / monitor / review-recommended / review-required / do-not-coadminister-needs-review). Every reported interaction cites a recorded record with a matching pair + severity, the overall severity equals the highest cataloged severity among the detected interactions, and the order is NEVER autonomously held (which could deny needed therapy) or the alert overridden (which could push through a contraindicated combination) — a pharmacist / prescriber acts on or reviews every finding. There is no date math and no dollar waterfall — it is a pairwise knowledge-base lookup + severity ranking, a pure function of the request's own fields. This is a PHI-bearing agent — the screen references the patient's active medication list. The knowledge base + severity assignments are illustrative, NOT a certified clinical decision support system — real interaction checking uses a maintained compendium, normalized drug vocabularies (RxNorm), dose / route / timing context, patient-specific factors, and the pharmacist's / prescriber's clinical judgment.",
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
        proposedDrug: determination.proposedDrug,
        interactionCount: determination.interactionCount,
        overallSeverity: determination.overallSeverity,
        disposition: determination.disposition,
        requiresClinicianReview: determination.requiresClinicianReview,
        ddiInteractionSourced: interactionSourced,
        ddiSeverityConsistent: severityConsistent,
        ddiNoAutonomousHoldOrOverride: noAutonomous,
        summaryDisposition: summary.disposition
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
