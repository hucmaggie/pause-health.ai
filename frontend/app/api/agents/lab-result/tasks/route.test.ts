import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/lab-result/tasks", {
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

const NORMAL_REQUEST = {
  patientRef: "lab-patient-001",
  providerRef: "lab-provider-001",
  analyteId: "analyte.potassium",
  value: 4.2,
  unit: "mmol/L"
};

const CRITICAL_REQUEST = {
  patientRef: "lab-patient-002",
  providerRef: "lab-provider-002",
  analyteId: "analyte.potassium",
  value: 6.8,
  unit: "mmol/L"
};

describe("POST /api/agents/lab-result/tasks", () => {
  it("classifies a critical result → completed, with a parented trace", async () => {
    const taskId = "test-lab-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: CRITICAL_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.classification).toBe("critical-high");
    expect(body.result.metadata.agentFabric.isCritical).toBe(true);
    expect(body.result.metadata.agentFabric.requiresProviderNotification).toBe(true);
    expect(body.result.metadata.agentFabric.labCriticalValueNotified).toBe(true);
    expect(body.result.metadata.agentFabric.labRangeCited).toBe(true);
    expect(body.result.metadata.agentFabric.labClinicianReviewed).toBe(true);

    const data = dataPart(body).data as {
      result: { determination: { classification: string; analyteId: string } };
    };
    expect(data.result.determination.classification).toBe("critical-high");
    expect(data.result.determination.analyteId).toBe("analyte.potassium");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("lab.receive-result");
    expect(ops).toContain("lab.classify");
    expect(ops).toContain("lab.recommend");
    expect(ops).toContain("lab.log-audit");
    const classifySpan = spans.find((s) => s.operation === "lab.classify");
    expect(classifySpan?.agentId).toBe("lab-result-agent");
    expect(classifySpan?.attributes?.phiAccessed).toBe(true);
  });

  it("classifies a normal result (a completed allow, no notification)", async () => {
    const taskId = "test-lab-normal-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: NORMAL_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.classification).toBe("normal");
    expect(body.result.metadata.agentFabric.requiresProviderNotification).toBe(false);
    expect(body.result.metadata.agentFabric.requiresClinicianReview).toBe(false);
  });

  it("blocks a suppressed critical value (critical-value-notified)", async () => {
    const taskId = "test-lab-suppress-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: CRITICAL_REQUEST,
                determination: {
                  patientRef: "lab-patient-002",
                  providerRef: "lab-provider-002",
                  analyteId: "analyte.potassium",
                  classification: "critical-high",
                  isCritical: true,
                  requiresProviderNotification: false,
                  requiresClinicianReview: true
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
    expect(ids).toContain("policy.lab.critical-value-notified");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "lab.classify.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "lab.recommend")).toBe(false);
  });

  it("blocks an ad-hoc interpretation with no cited reference range (reference-range-sourced)", async () => {
    const taskId = "test-lab-norange-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: NORMAL_REQUEST,
                determination: {
                  patientRef: "lab-patient-001",
                  providerRef: "lab-provider-001",
                  analyteId: "analyte.we-just-decided",
                  classification: "abnormal-high",
                  isCritical: false,
                  requiresProviderNotification: false,
                  requiresClinicianReview: true
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
    expect(ids).toContain("policy.lab.reference-range-sourced");
  });

  it("blocks an autonomous action on a non-normal result (no-autonomous-clinical-action)", async () => {
    const taskId = "test-lab-autonomous-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: NORMAL_REQUEST,
                determination: {
                  patientRef: "lab-patient-003",
                  providerRef: "lab-provider-003",
                  analyteId: "analyte.glucose",
                  classification: "abnormal-high",
                  isCritical: false,
                  requiresProviderNotification: false,
                  requiresClinicianReview: false
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
    expect(ids).toContain("policy.lab.no-autonomous-clinical-action");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/lab-result/tasks", {
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
      new Request("http://localhost/api/agents/lab-result/tasks", {
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
