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
  type ImmunizationDetermination,
  type ImmunizationRequest,
  DEMO_IMMUNIZATION_REQUEST,
  evaluateImmunization,
  immunizationContraindicationHonored,
  immunizationNoAutonomousAdministration,
  immunizationScheduleCited,
  immunizationSummary
} from "../../../../../lib/immunization";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "immunization-agent";

/**
 * Google A2A `tasks/send` endpoint for the Immunization Forecasting (ACIP) agent — the
 * clinical-decision service that forecasts which vaccines a patient is up-to-date / due /
 * overdue / contraindicated / not-indicated for against an ACIP-style schedule.
 *
 *   POST /api/agents/immunization/tasks
 *
 * Loads a patient and DETERMINISTICALLY evaluates them via evaluateImmunization: it computes
 * the patient's age, then for each schedule rule computes a per-vaccine forecast, citing the
 * governing schedule rule and the next-due date. The forecast is a pure function of the
 * request + its own asOfDate + the schedule catalog (no randomness, no clock). Every forecast
 * entry cites a recorded schedule rule, a contraindicated vaccine is never recommended, and a
 * due / overdue vaccine requires a clinician order (never autonomously administered). The
 * schedule + intervals are illustrative / synthetic; a real forecast uses the current ACIP
 * recommendations and the CDC immunization schedules.
 *
 * Enforced-block policies checked before any determination is acted on:
 *   - policy.immunization.schedule-sourced (signal immunizationScheduleCited) — every forecast
 *     entry must cite a recorded schedule rule.
 *   - policy.immunization.contraindication-honored (signal immunizationContraindicationHonored)
 *     — a contraindicated vaccine may never be recommended.
 *   - policy.immunization.no-autonomous-administration (signal immunizationNoAutonomousAdministration)
 *     — due / overdue vaccines must require a clinician order.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { request?: ImmunizationRequest, determination?: object } — the request is evaluated; a
 *   caller-asserted `determination` (admissible only if every entry cites a schedule rule,
 *   no contraindicated vaccine is recommended, and due / overdue vaccines require a clinician
 *   order) demonstrates the three governance blocks.
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
  const taskId = params.id || newTaskId("immunization");
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
      ? (data.request as ImmunizationRequest)
      : DEMO_IMMUNIZATION_REQUEST;

  // Deterministic immunization forecast.
  const determination = evaluateImmunization(request);

  // The determination the governance gates check: the caller-asserted determination
  // (to demonstrate the blocks) or the produced determination.
  const assertedDetermination =
    data.determination && typeof data.determination === "object"
      ? (data.determination as ImmunizationDetermination)
      : undefined;
  const determinationForCheck = assertedDetermination ?? determination;

  // Honest governance signals: every entry is schedule-sourced, no contraindicated vaccine is
  // recommended, and due / overdue vaccines require a clinician order.
  const scheduleCited = immunizationScheduleCited(determinationForCheck);
  const contraindicationHonored = immunizationContraindicationHonored(determinationForCheck);
  const noAutonomousAdministration =
    immunizationNoAutonomousAdministration(determinationForCheck);

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      immunizationScheduleCited: scheduleCited,
      immunizationContraindicationHonored: contraindicationHonored,
      immunizationNoAutonomousAdministration: noAutonomousAdministration
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "immunization.forecast.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        patientRef: request.patientRef,
        immunizationScheduleCited: scheduleCited,
        immunizationContraindicationHonored: contraindicationHonored,
        immunizationNoAutonomousAdministration: noAutonomousAdministration,
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
          `Pause Agent Fabric blocked this immunization run: ${governance.blockingViolations
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

  const summary = immunizationSummary(determination);

  // Receive-patient span — the fabric records the patient it received, parented under the
  // caller's span if any.
  const receiveSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "immunization.receive-patient",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      ageYears: determination.ageYears,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Forecast span — the deterministic per-vaccine forecast, parented to the received patient.
  const forecastSpan = recordInstantSpan({
    taskId,
    parentSpanId: receiveSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "immunization.forecast",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      dueCount: determination.dueCount,
      overdueCount: determination.overdueCount,
      contraindicatedCount: determination.contraindicatedCount,
      immunizationScheduleCited: scheduleCited,
      immunizationContraindicationHonored: contraindicationHonored,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Recommend span — the recommendation (clinician-order-gated), parented to the forecast.
  const recommendSpan = recordInstantSpan({
    taskId,
    parentSpanId: forecastSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "immunization.recommend",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      requiresClinicianOrder: determination.requiresClinicianOrder,
      immunizationNoAutonomousAdministration: noAutonomousAdministration,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Log-audit span — the determination recorded to the audit trail, parented to the
  // recommendation. Every immunization forecast is logged.
  const auditSpan = recordInstantSpan({
    taskId,
    parentSpanId: recommendSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "immunization.log-audit",
    protocol: "a2a",
    attributes: {
      patientRef: request.patientRef,
      requiresClinicianOrder: determination.requiresClinicianOrder,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  const result = { determination, patientRef: request.patientRef };

  const completedMessage = determination.requiresClinicianOrder
    ? `Immunization forecast for ${request.patientRef} (age ${determination.ageYears}): ${determination.dueCount} due + ${determination.overdueCount} overdue vaccine(s) — a RECOMMENDATION requiring a clinician order${determination.contraindicatedCount > 0 ? `; ${determination.contraindicatedCount} contraindicated vaccine(s) withheld` : ""} (synthetic — illustrative ACIP-style schedule; a real forecast uses the current ACIP recommendations + CDC schedules).`
    : `Immunization forecast for ${request.patientRef} (age ${determination.ageYears}): no due or overdue vaccines${determination.contraindicatedCount > 0 ? `; ${determination.contraindicatedCount} contraindicated vaccine(s) withheld` : ""} (synthetic — NOT a certified immunization forecaster).`;

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
        name: "ImmunizationDetermination",
        description:
          "Deterministically-produced ACIP-style immunization forecast. It computes the patient's age from the birth date + asOfDate, then for each schedule rule (influenza, Td/Tdap booster, recombinant zoster/RZV at 50+, pneumococcal at 65+, COVID-19) computes a per-vaccine forecast (up-to-date / due / overdue / contraindicated / not-indicated) by applying age-eligibility, dose-series / booster-interval logic, and any recorded contraindications, citing the governing schedule rule and the next-due date. A vaccine the patient is contraindicated for is NEVER recommended — it is withheld and flagged. A due / overdue vaccine is a RECOMMENDATION requiring a clinician order — the agent never administers, orders, or records a vaccine autonomously. The forecast is a pure function of the request + its own asOfDate + the schedule catalog (no randomness, no clock). The schedule catalog, age-eligibility, dose series, and booster intervals are illustrative/synthetic, NOT a certified immunization forecaster — a real forecast uses the current ACIP recommendations, the CDC immunization schedules, and the patient's full clinical context.",
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
        patientRef: request.patientRef,
        ageYears: determination.ageYears,
        ruleCount: summary.ruleCount,
        dueCount: determination.dueCount,
        overdueCount: determination.overdueCount,
        contraindicatedCount: determination.contraindicatedCount,
        requiresClinicianOrder: determination.requiresClinicianOrder,
        immunizationScheduleCited: scheduleCited,
        immunizationContraindicationHonored: contraindicationHonored,
        immunizationNoAutonomousAdministration: noAutonomousAdministration
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
