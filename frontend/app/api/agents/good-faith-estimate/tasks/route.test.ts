import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/good-faith-estimate/tasks", {
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

const COMPLETE_REQUEST = {
  patientRef: "gfe-patient-001",
  providerRef: "gfe-provider-001",
  primaryServiceId: "svc.menopause-consult-comprehensive",
  lineItems: [
    { serviceId: "svc.menopause-consult-comprehensive", quantity: 1 },
    { serviceId: "svc.lab-panel-hormone", quantity: 1 }
  ]
};

describe("POST /api/agents/good-faith-estimate/tasks", () => {
  it("prices a complete estimate → completed, with a parented trace", async () => {
    const taskId = "test-gfe-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: COMPLETE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.totalEstimate).toBe(580);
    expect(body.result.metadata.agentFabric.expectedItemsComplete).toBe(true);
    expect(body.result.metadata.agentFabric.binding).toBe(false);
    expect(body.result.metadata.agentFabric.gfeChargeMasterSourced).toBe(true);
    expect(body.result.metadata.agentFabric.gfeExpectedItemsComplete).toBe(true);
    expect(body.result.metadata.agentFabric.gfeEstimateNotBinding).toBe(true);

    const data = dataPart(body).data as {
      result: { determination: { totalEstimate: number; primaryServiceId: string } };
    };
    expect(data.result.determination.totalEstimate).toBe(580);
    expect(data.result.determination.primaryServiceId).toBe("svc.menopause-consult-comprehensive");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("gfe.receive-request");
    expect(ops).toContain("gfe.price");
    expect(ops).toContain("gfe.assemble");
    expect(ops).toContain("gfe.log-audit");
    const priceSpan = spans.find((s) => s.operation === "gfe.price");
    expect(priceSpan?.agentId).toBe("good-faith-estimate-agent");
    expect(priceSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("blocks an off-catalog / off-schedule charge (charge-master-sourced)", async () => {
    const taskId = "test-gfe-offcatalog-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: COMPLETE_REQUEST,
                determination: {
                  patientRef: "gfe-patient-001",
                  providerRef: "gfe-provider-001",
                  primaryServiceId: "svc.menopause-consult-comprehensive",
                  lineItems: [
                    { serviceId: "svc.menopause-consult-comprehensive", unitAmount: 400, quantity: 1 },
                    { serviceId: "svc.we-made-this-up", unitAmount: 999, quantity: 1 }
                  ],
                  binding: false
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
    expect(ids).toContain("policy.gfe.charge-master-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "gfe.price.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "gfe.assemble")).toBe(false);
  });

  it("blocks an incomplete estimate missing an expected item (expected-items-complete)", async () => {
    const taskId = "test-gfe-missing-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: COMPLETE_REQUEST,
                determination: {
                  patientRef: "gfe-patient-001",
                  providerRef: "gfe-provider-001",
                  primaryServiceId: "svc.menopause-consult-comprehensive",
                  lineItems: [
                    { serviceId: "svc.menopause-consult-comprehensive", unitAmount: 400, quantity: 1 }
                  ],
                  binding: false
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
    expect(ids).toContain("policy.gfe.expected-items-complete");
  });

  it("blocks a determination presented as a binding bill (estimate-not-binding)", async () => {
    const taskId = "test-gfe-binding-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: COMPLETE_REQUEST,
                determination: {
                  patientRef: "gfe-patient-001",
                  providerRef: "gfe-provider-001",
                  primaryServiceId: "svc.menopause-consult-comprehensive",
                  lineItems: [
                    { serviceId: "svc.menopause-consult-comprehensive", unitAmount: 400, quantity: 1 },
                    { serviceId: "svc.lab-panel-hormone", unitAmount: 180, quantity: 1 }
                  ],
                  binding: true
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
    expect(ids).toContain("policy.gfe.estimate-not-binding");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/good-faith-estimate/tasks", {
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
      new Request("http://localhost/api/agents/good-faith-estimate/tasks", {
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
