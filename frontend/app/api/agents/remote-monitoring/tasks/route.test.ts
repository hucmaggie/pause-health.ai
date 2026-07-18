import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/remote-monitoring/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

function dataPart(body: {
  result: { artifacts: { parts: { type: string; data?: unknown }[] }[] };
}) {
  return body.result.artifacts[0].parts.find(
    (p: { type: string }) => p.type === "data"
  ) as { type: "data"; data: Record<string, unknown> };
}

const WORSENING_READINGS = [
  { metricId: "metric.hot-flash-frequency", at: "2026-01-05", value: 6, source: "self-report" },
  { metricId: "metric.hot-flash-frequency", at: "2026-01-12", value: 8, source: "self-report" },
  { metricId: "metric.hot-flash-frequency", at: "2026-01-19", value: 10, source: "self-report" },
  { metricId: "metric.hot-flash-frequency", at: "2026-01-26", value: 12, source: "self-report" },
  { metricId: "metric.sleep-hours", at: "2026-01-05", value: 7, source: "wearable" },
  { metricId: "metric.sleep-hours", at: "2026-01-12", value: 6.5, source: "wearable" },
  { metricId: "metric.sleep-hours", at: "2026-01-19", value: 5.5, source: "wearable" },
  { metricId: "metric.sleep-hours", at: "2026-01-26", value: 5, source: "wearable" }
];

describe("POST /api/agents/remote-monitoring/tasks", () => {
  it("detects trends and routes worsening escalations to a clinician", async () => {
    const taskId = "test-rpm-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                readings: WORSENING_READINGS,
                monitoringPrefs: { hasMonitoringConsent: true }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.readingsTraceToSource).toBe(true);
    expect(body.result.metadata.agentFabric.escalationRoutedToHuman).toBe(true);
    expect(body.result.metadata.agentFabric.overallStatus).toBe("escalate");
    expect(body.result.metadata.agentFabric.escalationsRaised).toBeGreaterThan(0);

    const data = dataPart(body).data as {
      assessment: {
        perMetricTrends: { metricId: string; trend: string }[];
        escalations: { metricId: string; routedTo: string; triggeringRule: string }[];
      };
    };
    expect(data.assessment.perMetricTrends.length).toBe(2);
    for (const e of data.assessment.escalations) {
      expect(e.routedTo).toBe("clinician-review");
      expect(e.triggeringRule).toMatch(/^rule\./);
    }

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("rpm.ingest");
    expect(ops).toContain("rpm.detect-trends");
    expect(ops).toContain("rpm.route-to-clinician");
    const detect = spans.find((s) => s.operation === "rpm.detect-trends");
    expect(detect?.agentId).toBe("remote-monitoring-agent");
    expect(detect?.attributes?.escalationRoutedToHuman).toBe(true);
    expect(detect?.attributes?.phiAccessed).toBe(true);
  });

  it("blocks a fabricated reading with no valid source", async () => {
    const taskId = "test-rpm-fabricated-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                readings: [
                  { metricId: "metric.sleep-hours", at: "2026-01-05", value: 5, source: "fabricated" }
                ],
                monitoringPrefs: { hasMonitoringConsent: true }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.rpm.reading-source-integrity");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "rpm.detect.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "rpm.detect-trends")).toBe(false);
  });

  it("blocks a caller-asserted autonomous escalation (not routed to a clinician)", async () => {
    const taskId = "test-rpm-autonomous-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                readings: WORSENING_READINGS,
                monitoringPrefs: { hasMonitoringConsent: true },
                escalations: [
                  {
                    metricId: "metric.hot-flash-frequency",
                    metricLabel: "Hot-flash frequency",
                    triggeringRule: "rule.worsening-trend",
                    ruleDescription: "worsening",
                    severity: "elevated",
                    routedTo: "auto-order",
                    rationale: "autonomous action attempt"
                  }
                ]
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.rpm.no-autonomous-escalation");
  });

  it("blocks a monitoring run without patient consent", async () => {
    const taskId = "test-rpm-noconsent-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                readings: WORSENING_READINGS,
                monitoringPrefs: { hasMonitoringConsent: false }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.rpm.consent-to-monitor");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/remote-monitoring/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "x", method: "tasks/get" })
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("rejects unparseable JSON with -32700", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/remote-monitoring/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json"
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });
});
