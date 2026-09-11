import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  RESOURCE_SCHEDULING_PRESETS,
  buildResourceSchedulingRequestBody,
  resourceSchedulingViewFromTask,
  runResourceSchedulingTask
} from "./resource-scheduling-panel";

describe("RESOURCE_SCHEDULING_PRESETS", () => {
  it("has the three schedule presets and the three governance-block presets", () => {
    const ids = RESOURCE_SCHEDULING_PRESETS.map((p) => p.id);
    expect(ids).toContain("contended");
    expect(ids).toContain("all-scheduled");
    expect(ids).toContain("weight-over-count");
    expect(ids).toContain("phantom-block-block");
    expect(ids).toContain("suboptimal-block");
    expect(ids).toContain("auto-booked-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of RESOURCE_SCHEDULING_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildResourceSchedulingRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildResourceSchedulingRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { resourceRef: "r", requests: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { resourceRef: string }).resourceRef).toBe("r");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildResourceSchedulingRequestBody({
      taskId: "t-2",
      determination: { disposition: "contended" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "contended" });
  });
});

describe("runResourceSchedulingTask", () => {
  it("POSTs and returns the A2A task result", async () => {
    const task: A2ATask = {
      id: "t-9",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } }
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t-9", result: task }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const result = await runResourceSchedulingTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runResourceSchedulingTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("resourceSchedulingViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "BlockScheduleDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  resourceRef: "infusion-chair-3",
                  determination: {
                    resourceRef: "infusion-chair-3",
                    disposition: "contended",
                    requests: [
                      { requestId: "infusion-1101", start: 0, end: 3, weight: 5 },
                      { requestId: "infusion-1104", start: 6, end: 9, weight: 6 }
                    ],
                    selected: ["infusion-1101", "infusion-1104"],
                    totalWeight: 11,
                    scheduledCount: 2,
                    contendedCount: 3,
                    total: 5,
                    reason: "r",
                    note: "n"
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
          traceTaskId: "t-1",
          blockScheduleSourced: true,
          blockScheduleOptimal: true,
          blockScheduleNoAutonomousBooking: true
        }
      }
    };
    const view = resourceSchedulingViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("contended");
      expect(view.totalWeight).toBe(11);
      expect(view.selected).toHaveLength(2);
      expect(view.blockScheduleOptimal).toBe(true);
    }
  });

  it("lifts a blocked view from a governance block", () => {
    const task: A2ATask = {
      id: "t-2",
      status: {
        state: "failed",
        timestamp: "now",
        message: { role: "agent", parts: [{ type: "text", text: "blocked" }] }
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: ["policy.block-schedule.schedule-optimal"],
          violations: [
            { policyId: "policy.block-schedule.schedule-optimal", reason: "sub-optimal" }
          ],
          traceTaskId: "t-2"
        }
      }
    };
    const view = resourceSchedulingViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.block-schedule.schedule-optimal");
    }
  });

  it("lifts an invalid view from a non-block failure", () => {
    const task: A2ATask = {
      id: "t-3",
      status: {
        state: "failed",
        timestamp: "now",
        message: { role: "agent", parts: [{ type: "text", text: "nope" }] }
      },
      metadata: { agentFabric: { decision: "invalid", traceTaskId: "t-3" } }
    };
    const view = resourceSchedulingViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
