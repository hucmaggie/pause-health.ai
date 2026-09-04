import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/balance-billing/tasks", {
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

const EMERGENCY_REQUEST = {
  claimRef: "bb-claim-001",
  patientRef: "bb-patient-001",
  basisId: "basis.emergency",
  serviceType: "emergency",
  isAncillary: false,
  billedCharge: 5000,
  inNetworkAllowed: 1200,
  waiverObtained: false
};

describe("POST /api/agents/balance-billing/tasks", () => {
  it("protects an emergency claim → completed, with a parented trace", async () => {
    const taskId = "test-bb-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: EMERGENCY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.protected).toBe(true);
    expect(body.result.metadata.agentFabric.balanceBillProhibited).toBe(true);
    expect(body.result.metadata.agentFabric.costShareBasis).toBe("in-network-qpa");
    expect(body.result.metadata.agentFabric.balanceBillBasisCited).toBe(true);
    expect(body.result.metadata.agentFabric.balanceBillCostShareInNetwork).toBe(true);
    expect(body.result.metadata.agentFabric.balanceBillProhibitionHonored).toBe(true);

    const data = dataPart(body).data as {
      result: { determination: { protected: boolean; balanceBillAmount: number } };
    };
    expect(data.result.determination.protected).toBe(true);
    expect(data.result.determination.balanceBillAmount).toBe(0);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("balancebill.receive-claim");
    expect(ops).toContain("balancebill.evaluate");
    expect(ops).toContain("balancebill.recommend");
    expect(ops).toContain("balancebill.log-audit");
    const evalSpan = spans.find((s) => s.operation === "balancebill.evaluate");
    expect(evalSpan?.agentId).toBe("balance-billing-agent");
    expect(evalSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("permits a balance bill on a non-protected ground-ambulance claim (requires review)", async () => {
    const taskId = "test-bb-ground-001";
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
                  claimRef: "bb-claim-004",
                  patientRef: "bb-patient-004",
                  basisId: "basis.ground-ambulance",
                  serviceType: "ground-ambulance",
                  billedCharge: 1800,
                  inNetworkAllowed: 700
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.protected).toBe(false);
    expect(body.result.metadata.agentFabric.balanceBillAmount).toBe(1100);
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(true);
  });

  it("blocks an ad-hoc protection call with no cited basis (protection-basis-sourced)", async () => {
    const taskId = "test-bb-nobasis-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: EMERGENCY_REQUEST,
                determination: {
                  claimRef: "bb-claim-001",
                  patientRef: "bb-patient-001",
                  basisId: "basis.we-just-decided",
                  protected: true,
                  costShareBasis: "in-network-qpa",
                  balanceBillAllowed: false
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
    expect(ids).toContain("policy.balancebill.protection-basis-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "balancebill.evaluate.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "balancebill.recommend")).toBe(false);
  });

  it("blocks a protected patient's cost-share based on the billed charge (cost-share-in-network-basis)", async () => {
    const taskId = "test-bb-costshare-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: EMERGENCY_REQUEST,
                determination: {
                  claimRef: "bb-claim-001",
                  patientRef: "bb-patient-001",
                  basisId: "basis.emergency",
                  protected: true,
                  costShareBasis: "billed-charge",
                  balanceBillAllowed: false
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
    expect(ids).toContain("policy.balancebill.cost-share-in-network-basis");
  });

  it("blocks a balance bill allowed on a protected claim (no-autonomous-balance-bill)", async () => {
    const taskId = "test-bb-protectedbill-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: EMERGENCY_REQUEST,
                determination: {
                  claimRef: "bb-claim-001",
                  patientRef: "bb-patient-001",
                  basisId: "basis.emergency",
                  protected: true,
                  costShareBasis: "in-network-qpa",
                  balanceBillAllowed: true
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
    expect(ids).toContain("policy.balancebill.no-autonomous-balance-bill");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/balance-billing/tasks", {
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
      new Request("http://localhost/api/agents/balance-billing/tasks", {
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
