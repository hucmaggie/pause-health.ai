import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  MEMBER_COST_SHARE_PRESETS,
  buildMemberCostShareRequestBody,
  memberCostShareViewFromTask,
  runMemberCostShareTask
} from "./member-cost-share-panel";
import { DEMO_COST_SHARE_REQUEST } from "../lib/member-cost-share";

describe("MEMBER_COST_SHARE_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(MEMBER_COST_SHARE_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of MEMBER_COST_SHARE_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = MEMBER_COST_SHARE_PRESETS.map((p) => p.id);
    expect(ids).toContain("off-catalog-plan-block");
    expect(ids).toContain("bad-math-block");
    expect(ids).toContain("posted-charge-block");
  });
});

describe("buildMemberCostShareRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildMemberCostShareRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_COST_SHARE_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_COST_SHARE_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildMemberCostShareRequestBody({
      taskId: "t2",
      determination: { autoPostedCharge: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoPostedCharge: true });
  });
});

function okResponse(task: A2ATask): Response {
  const payload: A2ARpcResponse<A2ATask> = { jsonrpc: "2.0", id: "x", result: task };
  return {
    ok: true,
    status: 200,
    json: async () => payload
  } as unknown as Response;
}

describe("runMemberCostShareTask", () => {
  it("POSTs to the member-cost-share route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runMemberCostShareTask(
      { taskId: "t", request: DEMO_COST_SHARE_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/member-cost-share/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runMemberCostShareTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("memberCostShareViewFromTask", () => {
  it("lifts a resolved determination from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "CostShareDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  claimRef: "claim-4471",
                  determination: {
                    claimRef: "claim-4471",
                    memberRef: "member-8842",
                    planId: "plan.silver-ppo",
                    planName: "Silver PPO (individual)",
                    allowedAmount: 4000,
                    deductibleApplied: 500,
                    coinsuranceApplied: 700,
                    oopCapReduction: 0,
                    memberResponsibility: 1200,
                    planPaid: 2800,
                    coinsuranceRate: 0.2,
                    deductibleRemainingAfter: 0,
                    oopRemainingAfter: 3800,
                    requiresAdjudicationReview: true,
                    autoPostedCharge: false,
                    reason: "ok",
                    synthetic: true,
                    note: "note"
                  }
                }
              }
            }
          ]
        }
      ],
      metadata: {
        agentFabric: {
          decision: "allow",
          traceTaskId: "trace-1",
          costShareBenefitSourced: true,
          costShareMathConsistent: true,
          costShareNoAutonomousCharge: true
        }
      }
    };
    const view = memberCostShareViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.memberResponsibility).toBe(1200);
      expect(view.planPaid).toBe(2800);
      expect(view.costShareMathConsistent).toBe(true);
      expect(view.traceTaskId).toBe("trace-1");
    }
  });

  it("lifts a blocked view from a failed task with a fabric block", () => {
    const task: A2ATask = {
      id: "t",
      status: {
        state: "failed",
        timestamp: new Date().toISOString(),
        message: { role: "agent", parts: [{ type: "text", text: "blocked" }] }
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: ["policy.costshare.math-consistent"],
          violations: [{ policyId: "policy.costshare.math-consistent", reason: "doesn't add up" }]
        }
      }
    };
    const view = memberCostShareViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.costshare.math-consistent");
      expect(view.policiesEvaluated).toContain("policy.costshare.math-consistent");
    }
  });
});
