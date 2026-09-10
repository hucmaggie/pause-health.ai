import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  MLR_REBATE_PRESETS,
  buildMlrRebateRequestBody,
  mlrRebateViewFromTask,
  runMlrRebateTask
} from "./mlr-rebate-panel";
import { DEMO_MLR_REBATE_REQUEST } from "../lib/mlr-rebate";

describe("MLR_REBATE_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(MLR_REBATE_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of MLR_REBATE_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = MLR_REBATE_PRESETS.map((p) => p.id);
    expect(ids).toContain("off-catalog-standard-block");
    expect(ids).toContain("inconsistent-apportionment-block");
    expect(ids).toContain("auto-disbursed-block");
  });
});

describe("buildMlrRebateRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildMlrRebateRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_MLR_REBATE_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_MLR_REBATE_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildMlrRebateRequestBody({
      taskId: "t2",
      determination: { autoDisbursed: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoDisbursed: true });
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

describe("runMlrRebateTask", () => {
  it("POSTs to the mlr-rebate route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runMlrRebateTask(
      { taskId: "t", request: DEMO_MLR_REBATE_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/mlr-rebate/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runMlrRebateTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("mlrRebateViewFromTask", () => {
  it("lifts a resolved determination from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "MlrRebateDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  requestRef: "mlr-001",
                  determination: {
                    requestRef: "mlr-001",
                    planRef: "plan-ind-2025",
                    market: "individual",
                    standard: 0.8,
                    mlr: 0.7789,
                    meetsStandard: false,
                    totalRebate: 21100,
                    allocations: [
                      { subscriberRef: "sub-A", premiumPaid: 400000, rebate: 8440 },
                      { subscriberRef: "sub-B", premiumPaid: 350000, rebate: 7385 },
                      { subscriberRef: "sub-C", premiumPaid: 250000, rebate: 5275 }
                    ],
                    reason: "ok",
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
          mlrInputsSourced: true,
          mlrAllocationConsistent: true,
          mlrNoAutonomousDisbursement: true
        }
      }
    };
    const view = mlrRebateViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.totalRebate).toBe(21100);
      expect(view.allocations).toHaveLength(3);
      expect(view.mlr).toBe(0.7789);
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
          policiesEvaluated: ["policy.mlr.allocation-consistent"],
          violations: [{ policyId: "policy.mlr.allocation-consistent", reason: "pennies lost" }]
        }
      }
    };
    const view = mlrRebateViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.mlr.allocation-consistent");
      expect(view.policiesEvaluated).toContain("policy.mlr.allocation-consistent");
    }
  });
});
