import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/population-health/tasks", {
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

const PANEL = [
  {
    patientRef: "panel-patient-001",
    intakeSeverity: "high",
    assessmentBand: "severe",
    openCareGaps: 3,
    medicationAdherence: "lapsed",
    monitoringTrend: "worsening"
  },
  {
    patientRef: "panel-patient-002",
    intakeSeverity: "moderate",
    assessmentBand: "moderate",
    openCareGaps: 1,
    sdohPositiveDomains: 1
  },
  {
    patientRef: "panel-patient-003",
    intakeSeverity: "low",
    assessmentBand: "mild",
    monitoringTrend: "improving"
  }
];

describe("POST /api/agents/population-health/tasks", () => {
  it("stratifies a panel and builds a prioritized worklist for care-manager review", async () => {
    const taskId = "test-pophealth-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { panel: PANEL } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.riskScoreTracesToFactors).toBe(true);
    expect(body.result.metadata.agentFabric.excludesProtectedAttributes).toBe(true);
    expect(body.result.metadata.agentFabric.tierReviewedByHuman).toBe(true);
    expect(body.result.metadata.agentFabric.patientsStratified).toBe(3);

    const data = dataPart(body).data as {
      stratification: {
        perPatient: { patientRef: string; score: number; tier: string }[];
        worklist: string[];
        tierCounts: Record<string, number>;
      };
    };
    expect(data.stratification.perPatient).toHaveLength(3);
    expect(data.stratification.tierCounts.high).toBe(1);
    // Highest-risk patient leads the worklist.
    expect(data.stratification.worklist[0]).toBe("panel-patient-001");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("pophealth.ingest-panel");
    expect(ops).toContain("pophealth.score");
    expect(ops).toContain("pophealth.stratify");
    expect(ops).toContain("pophealth.build-worklist");
    const stratify = spans.find((s) => s.operation === "pophealth.stratify");
    expect(stratify?.agentId).toBe("population-health-agent");
    expect(stratify?.attributes?.phiAccessed).toBe(true);
    const worklist = spans.find((s) => s.operation === "pophealth.build-worklist");
    expect(worklist?.attributes?.autonomousCareDecision).toBe(false);
  });

  it("blocks an opaque / off-spec score (transparent-risk-model)", async () => {
    const taskId = "test-pophealth-opaque-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                panel: PANEL,
                profiles: [
                  {
                    patientRef: "panel-patient-001",
                    score: 9,
                    tier: "high",
                    contributingFactors: [
                      { factorId: "factor.opaque-blackbox", factorLabel: "?", points: 9, detail: "" }
                    ]
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
    expect(violationIds).toContain("policy.pophealth.transparent-risk-model");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "pophealth.stratify.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "pophealth.stratify")).toBe(false);
  });

  it("blocks a protected-class scoring factor (no-protected-class-factors)", async () => {
    const taskId = "test-pophealth-protected-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                panel: PANEL,
                scoringFactors: ["factor.intake-severity", "attr.race"]
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
    expect(violationIds).toContain("policy.pophealth.no-protected-class-factors");
  });

  it("blocks an autonomous care decision (no-autonomous-care-decision)", async () => {
    const taskId = "test-pophealth-autonomous-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                panel: PANEL,
                careActions: [
                  {
                    patientRef: "panel-patient-001",
                    tier: "high",
                    action: "auto-enroll in disease-management program",
                    routedTo: "auto-enroll"
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
    expect(violationIds).toContain("policy.pophealth.no-autonomous-care-decision");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/population-health/tasks", {
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
      new Request("http://localhost/api/agents/population-health/tasks", {
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
