import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_COST_SHARE_DEDUCTIBLE_REQUEST,
  DEMO_COST_SHARE_OOP_REQUEST,
  DEMO_COST_SHARE_REQUEST
} from "../../../../../lib/member-cost-share";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/member-cost-share/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/member-cost-share/tasks", () => {
  it("splits a mixed claim → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-mcs-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_COST_SHARE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.memberResponsibility).toBe(1200);
    expect(body.result.metadata.agentFabric.planPaid).toBe(2800);
    expect(body.result.metadata.agentFabric.costShareBenefitSourced).toBe(true);
    expect(body.result.metadata.agentFabric.costShareMathConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.costShareNoAutonomousCharge).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("costshare.receive-claim");
    expect(ops).toContain("costshare.load-benefits");
    expect(ops).toContain("costshare.compute-cost-share");
    expect(ops).toContain("costshare.log-audit");
    const computeSpan = spans.find((s) => s.operation === "costshare.compute-cost-share");
    expect(computeSpan?.agentId).toBe("member-cost-share-agent");
    expect(computeSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("caps the member at the OOP maximum", async () => {
    const taskId = "test-mcs-oop-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_COST_SHARE_OOP_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.memberResponsibility).toBe(500);
    expect(body.result.metadata.agentFabric.oopCapReduction).toBe(500);
  });

  it("puts the whole allowed on the member when no deductible is met", async () => {
    const taskId = "test-mcs-deductible-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_COST_SHARE_DEDUCTIBLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.memberResponsibility).toBe(800);
    expect(body.result.metadata.agentFabric.planPaid).toBe(0);
  });

  it("blocks a cost-share computed from an off-catalog plan (benefit-design-sourced)", async () => {
    const taskId = "test-mcs-offcatalog-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_COST_SHARE_REQUEST,
                determination: {
                  claimRef: "claim-4471",
                  memberRef: "member-8842",
                  planId: "plan.we-made-up",
                  allowedAmount: 4000,
                  deductibleApplied: 500,
                  coinsuranceApplied: 700,
                  oopCapReduction: 0,
                  memberResponsibility: 1200,
                  planPaid: 2800,
                  coinsuranceRate: 0.2,
                  requiresAdjudicationReview: true,
                  autoPostedCharge: false
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
    expect(ids).toContain("policy.costshare.benefit-design-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "costshare.compute-cost-share.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "costshare.log-audit")).toBe(false);
  });

  it("blocks a split that doesn't add up (math-consistent)", async () => {
    const taskId = "test-mcs-badmath-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_COST_SHARE_REQUEST,
                determination: {
                  claimRef: "claim-4471",
                  memberRef: "member-8842",
                  planId: "plan.silver-ppo",
                  allowedAmount: 4000,
                  deductibleApplied: 500,
                  coinsuranceApplied: 700,
                  oopCapReduction: 0,
                  memberResponsibility: 1200,
                  planPaid: 2000,
                  coinsuranceRate: 0.2,
                  requiresAdjudicationReview: true,
                  autoPostedCharge: false
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
    expect(ids).toContain("policy.costshare.math-consistent");
  });

  it("blocks an autonomously-posted member charge (no-autonomous-member-charge)", async () => {
    const taskId = "test-mcs-postedcharge-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_COST_SHARE_REQUEST,
                determination: {
                  claimRef: "claim-4471",
                  memberRef: "member-8842",
                  planId: "plan.silver-ppo",
                  allowedAmount: 4000,
                  deductibleApplied: 500,
                  coinsuranceApplied: 700,
                  oopCapReduction: 0,
                  memberResponsibility: 1200,
                  planPaid: 2800,
                  coinsuranceRate: 0.2,
                  requiresAdjudicationReview: false,
                  autoPostedCharge: true
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
    expect(ids).toContain("policy.costshare.no-autonomous-member-charge");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/member-cost-share/tasks", {
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
      new Request("http://localhost/api/agents/member-cost-share/tasks", {
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
