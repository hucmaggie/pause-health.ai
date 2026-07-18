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
  type MonitoringEscalation,
  type MonitoringReading,
  assessMonitoring,
  escalationsRouteToHuman,
  readingsTraceToSource
} from "../../../../../lib/remote-monitoring";

export const runtime = "nodejs";

const FABRIC_AGENT_ID = "remote-monitoring-agent";

/**
 * Google A2A `tasks/send` endpoint for the Remote Patient Monitoring &
 * Symptom-Trend Tracking agent — the Salesforce "Agentforce for Health" /
 * Health Cloud remote-patient-monitoring analog.
 *
 *   POST /api/agents/remote-monitoring/tasks
 *
 * Ingests a LONGITUDINAL (time-series) reading set for a menopause/midlife
 * patient (hot-flash frequency, sleep duration, mood score, resting heart rate,
 * weight — self-reported or from wearables/devices), DETERMINISTICALLY detects
 * each metric's trend over the reading window (improving / stable / worsening)
 * and applies (synthetic) red-flag thresholds, and ROUTES worsening / red-flag
 * trends to a human clinician for review — it never takes an autonomous clinical
 * action. The metrics + thresholds are illustrative/synthetic, NOT a certified
 * remote-monitoring device.
 *
 * Enforced-block policies checked before any trend is acted on:
 *   - policy.rpm.reading-source-integrity (signal readingsTraceToSource) — every
 *     reading must trace to a device/self-report source + a defined metric.
 *   - policy.rpm.no-autonomous-escalation (signal escalationRoutedToHuman) —
 *     every escalation must route to a human clinician, never act autonomously.
 *   - policy.rpm.consent-to-monitor (signal monitoringHasConsent) — longitudinal
 *     monitoring requires the patient's consent.
 * A block returns HTTP 200 with a `failed` task.
 *
 * Input (data part):
 *   { readings: MonitoringReading[], monitoringPrefs?: {hasMonitoringConsent},
 *     escalations?: MonitoringEscalation[] } — readings are ingested + trended;
 *   caller-asserted `escalations` (admissible only if every one routes to a
 *   clinician) demonstrate the no-autonomous-escalation block.
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
  const taskId = params.id || newTaskId("rpm");
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
  const readings = Array.isArray(data.readings)
    ? (data.readings as MonitoringReading[])
    : [];
  const assertedEscalations = data.escalations as MonitoringEscalation[] | undefined;
  const usingAssertedEscalations = Array.isArray(assertedEscalations);
  const monitoringPrefs = (data.monitoringPrefs ?? {}) as {
    hasMonitoringConsent?: boolean;
  };

  // Deterministic assessment of the ingested readings (catalog metrics only).
  const assessment = assessMonitoring(readings);
  // The escalations the governance gate checks: the caller-asserted set (to
  // demonstrate the no-autonomous-escalation block) or the detected set.
  const escalations = usingAssertedEscalations
    ? (assertedEscalations as MonitoringEscalation[])
    : assessment.escalations;

  // Honest governance signals. Every reading must trace to a source + catalog
  // metric; every escalation must route to a human clinician; monitoring is
  // consent-gated (defaults to present, can be toggled off).
  const readingsTrace = readingsTraceToSource(readings);
  const escalationRouted = escalationsRouteToHuman(escalations);
  const monitoringHasConsent = monitoringPrefs.hasMonitoringConsent !== false;

  const governance = evaluateGovernance({
    agentId: FABRIC_AGENT_ID,
    task: {
      readingsTraceToSource: readingsTrace,
      escalationRoutedToHuman: escalationRouted,
      monitoringHasConsent
    }
  });

  if (governance.decision === "block") {
    recordInstantSpan({
      taskId,
      parentSpanId,
      agentId: FABRIC_AGENT_ID,
      operation: "rpm.detect.blocked",
      protocol: "a2a",
      status: "error",
      attributes: {
        readingsConsidered: readings.length,
        readingsTraceToSource: readingsTrace,
        escalationRoutedToHuman: escalationRouted,
        monitoringHasConsent,
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
          `Pause Agent Fabric blocked this remote-monitoring run: ${governance.blockingViolations
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

  // Ingest span — the fabric records the readings it ingested (all tracing to a
  // source), parented under the caller's span if any.
  const ingestSpan = recordInstantSpan({
    taskId,
    parentSpanId,
    agentId: FABRIC_AGENT_ID,
    operation: "rpm.ingest",
    protocol: "a2a",
    attributes: {
      readingsIngested: readings.length,
      metrics: assessment.perMetricTrends.map((t) => t.metricId),
      readingsTraceToSource: readingsTrace,
      monitoringHasConsent,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Detection span — parented to the ingest it read from.
  const trendsByMetric: Record<string, string> = {};
  for (const t of assessment.perMetricTrends) trendsByMetric[t.metricId] = t.trend;
  const detectSpan = recordInstantSpan({
    taskId,
    parentSpanId: ingestSpan.id,
    agentId: FABRIC_AGENT_ID,
    operation: "rpm.detect-trends",
    protocol: "a2a",
    attributes: {
      metricsMonitored: assessment.perMetricTrends.length,
      trends: trendsByMetric,
      escalationsRaised: assessment.escalations.length,
      overallStatus: assessment.overallStatus,
      escalationRoutedToHuman: escalationRouted,
      phiAccessed: true,
      synthetic: true,
      ...(personaId ? { personaId } : {})
    }
  });

  // Route each escalation to a human clinician for review — never autonomous.
  for (const e of assessment.escalations) {
    recordInstantSpan({
      taskId,
      parentSpanId: detectSpan.id,
      agentId: FABRIC_AGENT_ID,
      operation: "rpm.route-to-clinician",
      protocol: "a2a",
      attributes: {
        metricId: e.metricId,
        triggeringRule: e.triggeringRule,
        severity: e.severity,
        routedTo: e.routedTo,
        autonomousAction: false,
        phiAccessed: true,
        ...(personaId ? { personaId } : {})
      }
    });
  }

  const trendSummary = assessment.perMetricTrends
    .map((t) => `${t.metricLabel} (${t.trend}${t.redFlag ? ", red-flag" : ""})`)
    .join("; ");

  const completed: A2ATask = {
    id: taskId,
    sessionId,
    status: {
      state: "completed",
      timestamp: nowIso(),
      message: agentMessage(
        assessment.escalations.length > 0
          ? `Monitored ${assessment.perMetricTrends.length} metric${
              assessment.perMetricTrends.length === 1 ? "" : "s"
            } over the reading window and routed ${assessment.escalations.length} escalation${
              assessment.escalations.length === 1 ? "" : "s"
            } to clinician review: ${trendSummary}. No autonomous clinical action was taken (synthetic — illustrative thresholds, not a certified remote-monitoring device).`
          : `Monitored ${assessment.perMetricTrends.length} metric${
              assessment.perMetricTrends.length === 1 ? "" : "s"
            } over the reading window; no worsening / red-flag trend to escalate (${trendSummary || "no readings"}).`,
        { assessment }
      )
    },
    history: params.message ? [params.message] : undefined,
    artifacts: [
      {
        name: "RemoteMonitoringAssessment",
        description:
          "Deterministically-detected longitudinal symptom/vital trends for a menopause/midlife patient — per-metric trend classification (improving / stable / worsening) over the reading window with (synthetic) red-flag thresholds, plus worsening / red-flag escalations each routed to a human clinician for review (never an autonomous clinical action), each citing the metric + rule that triggered it. The monitored metrics + thresholds are illustrative/synthetic, NOT a certified remote-monitoring device.",
        index: 0,
        parts: [
          {
            type: "data",
            data: { assessment } as unknown as Record<string, unknown>
          }
        ]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: governance.appliesPolicies.map((p) => p.id),
        traceSpanId: detectSpan.id,
        traceTaskId: taskId,
        metricsMonitored: assessment.perMetricTrends.length,
        escalationsRaised: assessment.escalations.length,
        overallStatus: assessment.overallStatus,
        readingsTraceToSource: readingsTrace,
        escalationRoutedToHuman: escalationRouted
      }
    }
  };

  return NextResponse.json({ jsonrpc: "2.0", id: parsed.id, result: completed });
}
