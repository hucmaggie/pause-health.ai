import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/immunization/tasks", {
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

const MIDLIFE_REQUEST = {
  patientRef: "imm-patient-001",
  asOfDate: "2026-09-05",
  birthDate: "1974-03-15",
  history: [
    { ruleId: "rule.influenza", administeredDate: "2025-10-01" },
    { ruleId: "rule.tdap-booster", administeredDate: "2014-01-01" }
  ],
  contraindications: []
};

describe("POST /api/agents/immunization/tasks", () => {
  it("forecasts a midlife patient → completed, with a parented trace", async () => {
    const taskId = "test-imm-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: MIDLIFE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.requiresClinicianOrder).toBe(true);
    expect(body.result.metadata.agentFabric.dueCount).toBe(1);
    expect(body.result.metadata.agentFabric.overdueCount).toBe(2);
    expect(body.result.metadata.agentFabric.immunizationScheduleCited).toBe(true);
    expect(body.result.metadata.agentFabric.immunizationContraindicationHonored).toBe(true);
    expect(body.result.metadata.agentFabric.immunizationNoAutonomousAdministration).toBe(true);

    const data = dataPart(body).data as {
      result: { determination: { ageYears: number; requiresClinicianOrder: boolean } };
    };
    expect(data.result.determination.ageYears).toBe(52);
    expect(data.result.determination.requiresClinicianOrder).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("immunization.receive-patient");
    expect(ops).toContain("immunization.forecast");
    expect(ops).toContain("immunization.recommend");
    expect(ops).toContain("immunization.log-audit");
    const forecastSpan = spans.find((s) => s.operation === "immunization.forecast");
    expect(forecastSpan?.agentId).toBe("immunization-agent");
    expect(forecastSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("withholds a contraindicated vaccine but still completes", async () => {
    const taskId = "test-imm-contra-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: {
                  patientRef: "imm-patient-002",
                  asOfDate: "2026-09-05",
                  birthDate: "1974-03-15",
                  history: [],
                  contraindications: ["rule.zoster-rzv"]
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.contraindicatedCount).toBe(1);
    expect(body.result.metadata.agentFabric.immunizationContraindicationHonored).toBe(true);
  });

  it("blocks an off-catalog rule (schedule-sourced)", async () => {
    const taskId = "test-imm-nosource-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: MIDLIFE_REQUEST,
                determination: {
                  patientRef: "imm-patient-001",
                  forecast: [
                    { ruleId: "rule.we-made-up", vaccine: "x", status: "due", contraindicated: false }
                  ],
                  dueCount: 1,
                  overdueCount: 0,
                  requiresClinicianOrder: true
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.immunization.schedule-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "immunization.forecast.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "immunization.recommend")).toBe(false);
  });

  it("blocks a recommended contraindicated vaccine (contraindication-honored)", async () => {
    const taskId = "test-imm-contra-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: MIDLIFE_REQUEST,
                determination: {
                  patientRef: "imm-patient-001",
                  forecast: [
                    { ruleId: "rule.zoster-rzv", vaccine: "zoster", status: "overdue", contraindicated: true }
                  ],
                  dueCount: 0,
                  overdueCount: 1,
                  requiresClinicianOrder: true
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.immunization.contraindication-honored");
  });

  it("blocks due vaccines without a clinician order (no-autonomous-administration)", async () => {
    const taskId = "test-imm-autonomous-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: MIDLIFE_REQUEST,
                determination: {
                  patientRef: "imm-patient-001",
                  forecast: [
                    { ruleId: "rule.covid19", vaccine: "covid19", status: "due", contraindicated: false }
                  ],
                  dueCount: 1,
                  overdueCount: 0,
                  requiresClinicianOrder: false
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.immunization.no-autonomous-administration");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/immunization/tasks", {
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
      new Request("http://localhost/api/agents/immunization/tasks", {
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
