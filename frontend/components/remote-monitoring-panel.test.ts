import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REMOTE_MONITORING_PRESETS,
  buildRemoteMonitoringRequestBody,
  remoteMonitoringViewFromTask,
  runRemoteMonitoringTask
} from "./remote-monitoring-panel";
import type { A2ATask } from "../lib/a2a";
import {
  assessMonitoring,
  escalationsRouteToHuman,
  isValidReadingSource,
  readingsTraceToSource,
  type MonitoringReading
} from "../lib/remote-monitoring";

/**
 * Unit coverage for the /demo/intake Remote Patient Monitoring agent panel.
 * This repo tests components as node-env pure functions (see
 * care-gap-panel.test.ts) rather than rendering them, so we exercise the exact
 * logic the panel invokes: the JSON-RPC A2A body it POSTs, that
 * runRemoteMonitoringTask returns the resulting task, and that
 * remoteMonitoringViewFromTask lifts an assessment and a governance block into
 * render-ready shapes. The task fixtures mirror the shapes
 * app/api/agents/remote-monitoring actually returns.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function completedTask(): A2ATask {
  const preset = REMOTE_MONITORING_PRESETS.find((p) => p.id === "multi-metric-window")!;
  const assessment = assessMonitoring(preset.readings as MonitoringReading[]);
  return {
    id: "rpm-abc",
    status: { state: "completed", timestamp: "2026-01-01T00:00:00Z" },
    artifacts: [
      {
        name: "RemoteMonitoringAssessment",
        index: 0,
        parts: [{ type: "data", data: { assessment } }]
      }
    ],
    metadata: {
      agentFabric: {
        decision: "allow",
        policiesEvaluated: ["policy.rpm.reading-source-integrity"],
        traceSpanId: "span-1",
        traceTaskId: "rpm-abc",
        metricsMonitored: assessment.perMetricTrends.length,
        escalationsRaised: assessment.escalations.length,
        overallStatus: assessment.overallStatus,
        readingsTraceToSource: true,
        escalationRoutedToHuman: true
      }
    }
  };
}

function blockedTask(): A2ATask {
  return {
    id: "rpm-block",
    status: {
      state: "failed",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "agent",
        timestamp: "2026-01-01T00:00:00Z",
        parts: [
          {
            type: "text",
            text: "Pause Agent Fabric blocked this remote-monitoring run: policy.rpm.consent-to-monitor (no consent)"
          }
        ]
      }
    },
    metadata: {
      agentFabric: {
        decision: "block",
        policiesEvaluated: ["policy.rpm.consent-to-monitor"],
        violations: [
          {
            policyId: "policy.rpm.consent-to-monitor",
            reason: "monitoring without consent"
          }
        ]
      }
    }
  };
}

describe("REMOTE_MONITORING_PRESETS", () => {
  it("detects worsening escalations for the multi-metric window preset", () => {
    const preset = REMOTE_MONITORING_PRESETS.find((p) => p.id === "multi-metric-window");
    expect(preset).toBeDefined();
    const assessment = assessMonitoring(preset!.readings as MonitoringReading[]);
    expect(assessment.overallStatus).toBe("escalate");
    expect(assessment.escalations.length).toBeGreaterThan(0);
    expect(escalationsRouteToHuman(assessment.escalations)).toBe(true);
  });

  it("produces no escalation for the benign preset", () => {
    const preset = REMOTE_MONITORING_PRESETS.find((p) => p.id === "benign-window");
    const assessment = assessMonitoring(preset!.readings as MonitoringReading[]);
    expect(assessment.escalations).toHaveLength(0);
    expect(assessment.overallStatus).toBe("improving");
  });

  it("crosses a red-flag threshold for the red-flag preset", () => {
    const preset = REMOTE_MONITORING_PRESETS.find((p) => p.id === "red-flag-window");
    const assessment = assessMonitoring(preset!.readings as MonitoringReading[]);
    expect(assessment.perMetricTrends.some((t) => t.redFlag)).toBe(true);
    expect(assessment.escalations.some((e) => e.severity === "urgent")).toBe(true);
  });

  it("has a fabricated-reading preset whose reading has no valid source", () => {
    const preset = REMOTE_MONITORING_PRESETS.find((p) => p.id === "fabricated-reading-block");
    expect(preset).toBeDefined();
    expect(readingsTraceToSource(preset!.readings as MonitoringReading[])).toBe(false);
    expect(isValidReadingSource(preset!.readings![0].source)).toBe(false);
  });

  it("has an autonomous-escalation preset that isn't routed to a clinician", () => {
    const preset = REMOTE_MONITORING_PRESETS.find((p) => p.id === "autonomous-escalation-block");
    expect(preset).toBeDefined();
    expect(preset!.assertedEscalations).toBeDefined();
    expect(
      escalationsRouteToHuman(
        preset!.assertedEscalations as Array<{ routedTo: "clinician-review" }>
      )
    ).toBe(false);
  });

  it("has a no-consent preset that withholds monitoring consent", () => {
    const preset = REMOTE_MONITORING_PRESETS.find((p) => p.id === "no-consent-block");
    expect(preset).toBeDefined();
    expect(preset!.monitoringPrefs?.hasMonitoringConsent).toBe(false);
  });
});

describe("buildRemoteMonitoringRequestBody", () => {
  it("builds a JSON-RPC tasks/send envelope with a readings data part", () => {
    const readings: MonitoringReading[] = [
      { metricId: "metric.sleep-hours", at: "2026-01-05", value: 6, source: "wearable" }
    ];
    const body = buildRemoteMonitoringRequestBody({
      taskId: "task-xyz",
      personaId: "demo",
      readings,
      monitoringPrefs: { hasMonitoringConsent: true }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.id).toBe("task-xyz");
    expect(body.params.metadata).toEqual({ personaId: "demo" });
    const part = body.params.message.parts[0];
    expect(part.type).toBe("data");
    expect(part.data).toEqual({
      readings,
      monitoringPrefs: { hasMonitoringConsent: true }
    });
  });

  it("posts caller-asserted escalations under an `escalations` data part", () => {
    const escalations = [{ metricId: "metric.sleep-hours", routedTo: "auto-order" }];
    const body = buildRemoteMonitoringRequestBody({
      taskId: "task-block",
      assertedEscalations: escalations
    });
    expect(body.params.message.parts[0].data).toEqual({ escalations });
  });
});

describe("runRemoteMonitoringTask", () => {
  it("POSTs the A2A body to the RPM agent and returns the resulting task", async () => {
    const task = completedTask();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("/api/agents/remote-monitoring/tasks");
      expect(init?.method).toBe("POST");
      const sent = JSON.parse(String(init?.body));
      expect(sent.method).toBe("tasks/send");
      expect(Array.isArray(sent.params.message.parts[0].data.readings)).toBe(true);
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: "task-1", result: task })
      } as unknown as Response;
    });

    const out = await runRemoteMonitoringTask(
      {
        taskId: "task-1",
        readings: [
          { metricId: "metric.sleep-hours", at: "2026-01-05", value: 6, source: "wearable" }
        ]
      },
      fetchImpl as unknown as typeof fetch
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out.id).toBe("rpm-abc");
  });

  it("throws on a non-OK response (malformed envelope / parse error)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({})
    } as unknown as Response));
    await expect(
      runRemoteMonitoringTask(
        { taskId: "t", readings: [] },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toThrow(/400/);
  });
});

describe("remoteMonitoringViewFromTask", () => {
  it("lifts a detected assessment with per-metric trends + clinician-routed escalations", () => {
    const view = remoteMonitoringViewFromTask(completedTask());
    expect(view.kind).toBe("assessed");
    if (view.kind !== "assessed") return;
    expect(view.perMetricTrends.length).toBeGreaterThan(0);
    for (const e of view.escalations) {
      expect(e.routedTo).toBe("clinician-review");
    }
    expect(view.overallStatus).toBe("escalate");
    expect(view.readingsTraceToSource).toBe(true);
    expect(view.escalationRoutedToHuman).toBe(true);
    expect(view.traceTaskId).toBe("rpm-abc");
  });

  it("lifts a governance block with the blocking policy, reason, and message", () => {
    const view = remoteMonitoringViewFromTask(blockedTask());
    expect(view.kind).toBe("blocked");
    if (view.kind !== "blocked") return;
    expect(view.message).toMatch(/blocked this remote-monitoring run/);
    expect(view.violations.map((v) => v.policyId)).toContain(
      "policy.rpm.consent-to-monitor"
    );
    expect(view.policiesEvaluated).toContain("policy.rpm.consent-to-monitor");
    expect(view.traceTaskId).toBe("rpm-block");
  });

  it("treats a failed non-block task as an invalid (not-processed) result", () => {
    const task: A2ATask = {
      id: "rpm-invalid",
      status: {
        state: "failed",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          role: "agent",
          timestamp: "2026-01-01T00:00:00Z",
          parts: [{ type: "text", text: "The monitoring assessment could not be produced." }]
        }
      },
      metadata: {
        agentFabric: { decision: "allow", policiesEvaluated: [], error: "bad input" }
      }
    };
    const view = remoteMonitoringViewFromTask(task);
    expect(view.kind).toBe("invalid");
    if (view.kind !== "invalid") return;
    expect(view.message).toMatch(/could not be produced/);
  });
});
