import { NextResponse } from "next/server";
import {
  newTaskId,
  sendA2ATask,
  userMessage
} from "../../../../lib/a2a";
import type { IntakeRecord } from "../../../../lib/care-router";
import { recordInstantSpan } from "../../../../lib/agent-fabric";
import {
  assessmentToIntakeSignal,
  isAllowlistedInstrument,
  scoreAssessment,
  type AssessmentResponse
} from "../../../../lib/assessments";
import {
  DEMO_DATA360_PATIENT_ID,
  getGroundingContext,
  resolveIdentity
} from "../../../../lib/data-360";
import {
  getGroundingContextPreferReal,
  resolveIdentityFromOrg,
  warnSalesforceDegradationOnce
} from "../../../../lib/salesforce/grounding";
import { isSalesforceConfigured } from "../../../../lib/salesforce/auth";

/**
 * Server-side A2A handoff from the (mocked) Agentforce Service Agent
 * to the Pause Care Router agent.
 *
 *   POST /api/intake/route-to-care-router
 *   { "intake": { ... } }
 *
 * Flow:
 *   1. Generate a session-scoped task id (used as the Agent Fabric
 *      trace correlation key).
 *   2. Record a synthetic "intake.complete" span attributed to the
 *      Agentforce intake agent -- this is what an Anypoint OpenTelemetry
 *      tap would emit in production.
 *   3. POST an A2A `tasks/send` request to the Care Router endpoint,
 *      threading the trace via metadata.parentSpanId.
 *   4. Return both the routing decision and the task id so the client
 *      can pivot to /demo/agent-fabric?taskId=<id> and watch the trace.
 *
 * Why a server-side handoff: the prototype's fallback intake runs in
 * the browser, so the patient's browser would never see the Care
 * Router endpoint's logs. Threading through the server route gives us
 * a single trace context, real network latency, and the ability to
 * later add OAuth between agents without changing the client.
 */
export async function POST(req: Request) {
  type Body = {
    intake?: IntakeRecord;
    sessionId?: string;
    /**
     * Optional demo cohort persona id (e.g. "anika-patel"). When
     * present, threaded into every span emitted by this handler so
     * /demo/analytics can filter Care Router decisions + grounding
     * spans by persona. Production callers omit this field and the
     * filter just stays empty on analytics; nothing else branches.
     */
    personaId?: string;
    /**
     * Optional short origin tag (e.g. "agentforce-chat") identifying
     * the surface that completed the intake. Stamped on every span so
     * the trace viewer can tell a chat-originated handoff from the
     * /demo/routing "Run Care Router" button. Sanitized to a strict
     * slug so no free text / PHI can ride in on this attribute.
     */
    origin?: string;
    /**
     * Optional validated-instrument assessment. When present and on the
     * allow-list, the Assessment Agent's deterministic score drives
     * IntakeRecord.severity (and the red-flag screen) — so the Care Router
     * decision is backed by a real instrument score rather than a
     * self-reported band. Additive: absent = today's behavior, unchanged.
     */
    assessment?: AssessmentResponse;
  };
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = body.sessionId ?? newTaskId("session");
  const taskId = newTaskId("intake-to-router");
  const personaId =
    typeof body.personaId === "string" && body.personaId.length > 0
      ? body.personaId
      : undefined;
  // Strict slug so this attribute can never carry free text / PHI.
  const origin =
    typeof body.origin === "string" && /^[a-z0-9-]{1,40}$/.test(body.origin)
      ? body.origin
      : undefined;

  // Optional validated-instrument scoring. When a body.assessment for an
  // allow-listed instrument is present, the Assessment Agent's deterministic
  // score drives IntakeRecord.severity (and the red-flag screen) before the
  // intake hands off — a real score behind the routing decision. Best-effort:
  // a malformed assessment must never break intake routing.
  let intake: IntakeRecord = body.intake ?? {};
  let assessmentSpanId: string | undefined;
  let assessmentMeta: Record<string, unknown> | undefined;
  if (body.assessment && isAllowlistedInstrument(body.assessment.instrument)) {
    try {
      const result = scoreAssessment(body.assessment);
      const signal = assessmentToIntakeSignal(result);
      intake = {
        ...intake,
        severity: signal.severity,
        redFlagsAcknowledged: signal.redFlagsAcknowledged
      };
      const assessmentSpan = recordInstantSpan({
        taskId,
        agentId: "assessment-agent",
        operation: "assessment.score",
        protocol: "rest",
        attributes: {
          instrument: result.instrument,
          instrumentName: result.instrumentName,
          total: result.total,
          maxTotal: result.maxTotal,
          severityBand: result.severityBand,
          normalizedSeverity: result.normalizedSeverity,
          redFlag: result.redFlags.length > 0,
          validatedInstrument: true,
          scoringMethod: "deterministic",
          ...(personaId ? { personaId } : {}),
          ...(origin ? { origin } : {})
        }
      });
      assessmentSpanId = assessmentSpan.id;
      assessmentMeta = {
        instrument: result.instrument,
        total: result.total,
        maxTotal: result.maxTotal,
        severityBand: result.severityBand,
        normalizedSeverity: signal.severity,
        redFlag: result.redFlags.length > 0,
        severityDrivenByAssessment: true
      };
    } catch {
      // Best-effort: leave the intake untouched on a malformed assessment.
    }
  }

  const intakeSpan = recordInstantSpan({
    taskId,
    parentSpanId: assessmentSpanId,
    agentId: "agentforce-intake",
    operation: "intake.complete",
    protocol: "rest",
    attributes: {
      capturedFields: Object.values(intake).filter((v) => v !== undefined).length,
      redFlag: intake.redFlagsAcknowledged === "yes",
      ageBand: intake.ageBand,
      primarySymptom: intake.primarySymptom,
      severity: intake.severity,
      patientZipProvided: Boolean(intake.patientZip),
      ...(personaId ? { personaId } : {}),
      ...(origin ? { origin } : {})
    }
  });

  // 1. Identity resolution via Data 360 -- maps the partial intake
  //    identity to the unified patient id. Prefer real-org resolution
  //    when SF is configured; degrade silently to the deterministic mock
  //    on any failure so the trace never breaks for a transient network
  //    blip against the org.
  const idStartedAt = Date.now();
  let identitySource: "real" | "mock" = "mock";
  let identity = resolveIdentity({
    preferredName: intake.preferredName,
    ageBand: intake.ageBand,
    cycleStatus: intake.cycleStatus
  });
  if (isSalesforceConfigured()) {
    try {
      const real = await resolveIdentityFromOrg({
        preferredName: intake.preferredName,
        ageBand: intake.ageBand,
        cycleStatus: intake.cycleStatus
      });
      if (real) {
        identity = real;
        identitySource = "real";
      }
    } catch (err) {
      warnSalesforceDegradationOnce("intake.identity.resolve", err);
    }
  }
  const idFinishedAt = Date.now();
  const identitySpan = recordInstantSpan({
    taskId,
    parentSpanId: intakeSpan.id,
    agentId: "salesforce-data-360",
    operation: "data360.identity.resolve",
    protocol: "rest",
    attributes: {
      _source: identitySource,
      unifiedPatientId: identity.unifiedPatientId,
      confidence: identity.confidence,
      matchedSources: identity.matchedSources,
      resolutionRuleset: identity.resolutionRuleset,
      durationMs: idFinishedAt - idStartedAt,
      ...(personaId ? { personaId } : {}),
      ...(origin ? { origin } : {})
    }
  });

  // 2. Federated grounding query. Prefer real Health Cloud grounding
  //    (Phase 1: Contact + CareProgramEnrollee + CarePlan + Case); fall
  //    back to the deterministic mock. The returned shape is identical
  //    so the Care Router code path doesn't branch.
  const groundingStartedAt = Date.now();
  const { source: groundingSource, grounding } = await getGroundingContextPreferReal({
    patientId: identity.unifiedPatientId || DEMO_DATA360_PATIENT_ID,
    hint: {
      ageBand: intake.ageBand,
      primarySymptom: intake.primarySymptom,
      cycleStatus: intake.cycleStatus
    }
  });
  const groundingFinishedAt = Date.now();
  recordInstantSpan({
    taskId,
    parentSpanId: identitySpan.id,
    agentId: "salesforce-data-360",
    operation: "data360.grounding.federated-query",
    protocol: "rest",
    attributes: {
      _source: groundingSource,
      unifiedPatientId: grounding.unifiedPatientId,
      computedInsightsCount: grounding.groundingProvenance.computedInsightsCount,
      sourcesQueried: grounding.groundingProvenance.sourcesQueried,
      cohort: grounding.cohortComparison.cohortName,
      cohortSize: grounding.cohortComparison.cohortSize,
      patientPercentile: grounding.cohortComparison.patientPercentile,
      patientPercentileBasis: grounding.cohortComparison.basis,
      lastClinicianContactDaysAgo: grounding.lastClinicianContact.daysAgo,
      durationMs: groundingFinishedAt - groundingStartedAt,
      ...(personaId ? { personaId } : {}),
      ...(origin ? { origin } : {})
    }
  });

  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;
  const careRouterUrl = `${base}/api/agents/care-router`;

  try {
    const task = await sendA2ATask(careRouterUrl, {
      id: taskId,
      sessionId,
      message: userMessage(
        "Please route this menopause intake to the appropriate care pathway. Longitudinal context attached from Salesforce Data 360.",
        { intake, data360Grounding: grounding, data360Identity: identity }
      ),
      metadata: {
        parentSpanId: intakeSpan.id,
        ...(personaId ? { personaId } : {}),
        ...(origin ? { origin } : {})
      }
    });

    const decisionPart = task.artifacts?.[0]?.parts?.find(
      (p) => p.type === "data"
    );
    const decision =
      decisionPart && decisionPart.type === "data" ? decisionPart.data : null;

    return NextResponse.json({
      meta: {
        _note:
          "A2A handoff: Agentforce intake -> Data 360 identity resolution -> Data 360 federated grounding query -> Pause Care Router. Open /demo/agent-fabric?taskId=" +
          taskId +
          " to see the four-span multi-agent trace.",
        _taskId: taskId,
        _sessionId: sessionId,
        _careRouterUrl: careRouterUrl,
        _data360UnifiedPatientId: identity.unifiedPatientId,
        _data360IdentitySource: identitySource,
        _data360GroundingSource: groundingSource,
        _salesforceConfigured: isSalesforceConfigured(),
        ...(assessmentMeta ? { _assessment: assessmentMeta } : {})
      },
      taskId,
      sessionId,
      task,
      decision,
      ...(assessmentMeta ? { assessment: assessmentMeta } : {}),
      data360: {
        source: { identity: identitySource, grounding: groundingSource },
        identity,
        grounding
      }
    });
  } catch (err) {
    recordInstantSpan({
      taskId,
      parentSpanId: intakeSpan.id,
      agentId: "care-router-claude",
      operation: "a2a.tasks/send.transport-error",
      protocol: "a2a",
      status: "error",
      attributes: {
        error: (err as Error).message,
        ...(personaId ? { personaId } : {}),
        ...(origin ? { origin } : {})
      }
    });
    return NextResponse.json(
      {
        meta: { _taskId: taskId, _sessionId: sessionId },
        error: (err as Error).message
      },
      { status: 502 }
    );
  }
}
