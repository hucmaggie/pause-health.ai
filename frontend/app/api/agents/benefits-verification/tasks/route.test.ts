import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/benefits-verification/tasks", {
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

describe("POST /api/agents/benefits-verification/tasks", () => {
  it("verifies coverage and returns the structured result + summary", async () => {
    const taskId = "test-benefits-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                coverageQuery: { payer: "Aetna", memberId: "M-1001", patientZip: "94110" }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.nextAgent).toBe("agentforce-intake");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(typeof body.result.metadata.agentFabric.ebvTransactionId).toBe("string");

    const data = dataPart(body).data as {
      result: {
        eligibilityStatus: string;
        network: string;
        payerName: string;
        estimatedPatientResponsibility: number;
        source: { synthetic: boolean; transactionId: string };
      };
      summary: { sourced: boolean; ebvTransactionId: string };
    };
    expect(data.result.payerName).toBe("Aetna");
    expect(data.result.network).toBe("in-network");
    expect(data.result.eligibilityStatus).toBe("active");
    expect(data.result.source.synthetic).toBe(true);
    expect(data.summary.sourced).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("benefits.verify");
    expect(spans.every((s) => s.agentId === "benefits-verification-agent")).toBe(
      true
    );
    const verify = spans.find((s) => s.operation === "benefits.verify");
    expect(verify?.attributes?.sourced).toBe(true);
    expect(verify?.attributes?.synthetic).toBe(true);
  });

  it("reads a bare data object as the coverage query and resolves out-of-network for an uncontracted payer", async () => {
    const taskId = "test-benefits-oon-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { payer: "Humana", memberId: "M-2" } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.network).toBe("out-of-network");
  });

  it("blocks a caller-asserted coverage result that carries no EBV source", async () => {
    const taskId = "test-benefits-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                // A fabricated coverage result with NO source provenance —
                // the source-integrity policy must reject it.
                coverage: {
                  eligibilityStatus: "active",
                  network: "in-network",
                  payerName: "Aetna",
                  planName: "Totally Real Plan",
                  productType: "PPO",
                  serviceType: "mscp-specialist-visit",
                  deductibleTotal: 0,
                  deductibleMet: 0,
                  deductibleRemaining: 0,
                  coinsuranceRate: 0,
                  estimatedVisitCost: 0,
                  estimatedPatientResponsibility: 0
                }
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
    expect(violationIds).toContain("policy.benefits.eligibility-source-integrity");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "benefits.verify.blocked")).toBe(true);
    // No verified result span was emitted.
    expect(spans.some((s) => s.operation === "benefits.verify")).toBe(false);
  });

  it("blocks a coverage verification without an ai-decision-support consent", async () => {
    const taskId = "test-benefits-consent-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                coverageQuery: { payer: "Aetna", memberId: "M-3" },
                hasConsent: false
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
    expect(violationIds).toContain(
      "policy.data360.consent-required-before-grounding"
    );
  });

  it("verifies self-pay as inactive but still source-backed (not a block)", async () => {
    const taskId = "test-benefits-selfpay-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { coverageQuery: { payer: "self-pay" } } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.eligibilityStatus).toBe("inactive");
    const data = dataPart(body).data as { summary: { sourced: boolean } };
    expect(data.summary.sourced).toBe(true);
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/benefits-verification/tasks", {
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
      new Request("http://localhost/api/agents/benefits-verification/tasks", {
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
