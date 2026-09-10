import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_MLR_REBATE_MEETS_REQUEST,
  DEMO_MLR_REBATE_REQUEST,
  DEMO_MLR_REBATE_SMALL_GROUP_REQUEST
} from "../../../../../lib/mlr-rebate";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/mlr-rebate/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/mlr-rebate/tasks", () => {
  it("individual below standard → completed, $21,100 rebate, with a parented NON-PHI trace", async () => {
    const taskId = "test-mlr-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_MLR_REBATE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.mlr).toBe(0.7789);
    expect(body.result.metadata.agentFabric.totalRebate).toBe(21100);
    expect(body.result.metadata.agentFabric.mlrInputsSourced).toBe(true);
    expect(body.result.metadata.agentFabric.mlrAllocationConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.mlrNoAutonomousDisbursement).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("mlr.receive-financials");
    expect(ops).toContain("mlr.compute-ratio");
    expect(ops).toContain("mlr.apportion-rebate");
    expect(ops).toContain("mlr.log-audit");
    const ratioSpan = spans.find((s) => s.operation === "mlr.compute-ratio");
    expect(ratioSpan?.agentId).toBe("mlr-rebate-agent");
    // NON-PHI agent.
    expect(ratioSpan?.attributes?.phiAccessed).toBe(false);
  });

  it("large-group meeting standard → no rebate", async () => {
    const taskId = "test-mlr-meets-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_MLR_REBATE_MEETS_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.meetsStandard).toBe(true);
    expect(body.result.metadata.agentFabric.totalRebate).toBe(0);
  });

  it("small-group uneven premiums → completed with an exact split", async () => {
    const taskId = "test-mlr-sg-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_MLR_REBATE_SMALL_GROUP_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.totalRebate).toBe(8400);
    const det = body.result.artifacts[0].parts[0].data.result.determination;
    const sum = det.allocations.reduce((s: number, a: { rebate: number }) => s + a.rebate, 0);
    expect(Math.round(sum * 100)).toBe(840000);
  });

  it("blocks an off-catalog market standard (inputs-sourced)", async () => {
    const taskId = "test-mlr-offcatalog-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_MLR_REBATE_REQUEST,
                determination: {
                  requestRef: "mlr-001",
                  market: "platinum-market",
                  standard: 0.5,
                  earnedPremium: 1000000,
                  incurredClaims: 700000,
                  qualityImprovementExpense: 40000,
                  taxesAndFees: 50000,
                  mlr: 0.7789,
                  totalRebate: 0,
                  allocations: [],
                  requiresTreasuryReview: true,
                  autoDisbursed: false
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
    expect(ids).toContain("policy.mlr.inputs-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "mlr.apportion-rebate.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "mlr.log-audit")).toBe(false);
  });

  it("blocks an apportionment that loses pennies (allocation-consistent)", async () => {
    const taskId = "test-mlr-penny-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_MLR_REBATE_REQUEST,
                determination: {
                  requestRef: "mlr-001",
                  market: "individual",
                  standard: 0.8,
                  earnedPremium: 1000000,
                  incurredClaims: 700000,
                  qualityImprovementExpense: 40000,
                  taxesAndFees: 50000,
                  mlr: 0.7789,
                  totalRebate: 21100,
                  allocations: [
                    { subscriberRef: "sub-A", premiumPaid: 400000, rebate: 8400 },
                    { subscriberRef: "sub-B", premiumPaid: 350000, rebate: 7350 },
                    { subscriberRef: "sub-C", premiumPaid: 250000, rebate: 5250 }
                  ],
                  requiresTreasuryReview: true,
                  autoDisbursed: false
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
    expect(ids).toContain("policy.mlr.allocation-consistent");
  });

  it("blocks an autonomous disbursement (no-autonomous-disbursement)", async () => {
    const taskId = "test-mlr-autodisburse-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_MLR_REBATE_REQUEST,
                determination: {
                  requestRef: "mlr-001",
                  market: "individual",
                  standard: 0.8,
                  earnedPremium: 1000000,
                  incurredClaims: 700000,
                  qualityImprovementExpense: 40000,
                  taxesAndFees: 50000,
                  mlr: 0.7789,
                  totalRebate: 21100,
                  allocations: [
                    { subscriberRef: "sub-A", premiumPaid: 400000, rebate: 8440 },
                    { subscriberRef: "sub-B", premiumPaid: 350000, rebate: 7385 },
                    { subscriberRef: "sub-C", premiumPaid: 250000, rebate: 5275 }
                  ],
                  requiresTreasuryReview: false,
                  autoDisbursed: true
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
    expect(ids).toContain("policy.mlr.no-autonomous-disbursement");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/mlr-rebate/tasks", {
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
      new Request("http://localhost/api/agents/mlr-rebate/tasks", {
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
