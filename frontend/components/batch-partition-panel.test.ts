import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  BATCH_PARTITION_PRESETS,
  batchPartitionViewFromTask,
  buildBatchPartitionRequestBody,
  runBatchPartitionTask
} from "./batch-partition-panel";

describe("BATCH_PARTITION_PRESETS", () => {
  it("has the three partition presets and the three governance-block presets", () => {
    const ids = BATCH_PARTITION_PRESETS.map((p) => p.id);
    expect(ids).toContain("divisible");
    expect(ids).toContain("item-bound");
    expect(ids).toContain("even");
    expect(ids).toContain("reordered-cover-block");
    expect(ids).toContain("sub-optimal-block");
    expect(ids).toContain("auto-assigned-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of BATCH_PARTITION_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildBatchPartitionRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildBatchPartitionRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { worklistRef: "w", items: [], batchCount: 2 }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { worklistRef: string }).worklistRef).toBe("w");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildBatchPartitionRequestBody({
      taskId: "t-2",
      determination: { disposition: "divisible" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "divisible" });
  });
});

describe("runBatchPartitionTask", () => {
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
    const result = await runBatchPartitionTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runBatchPartitionTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("batchPartitionViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "BatchPartitionDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  worklistRef: "chart-review-backlog-2231",
                  determination: {
                    worklistRef: "chart-review-backlog-2231",
                    disposition: "divisible",
                    batches: [
                      { items: [{ label: "chart-8801", weight: 5 }], load: 5 },
                      { items: [{ label: "chart-8805", weight: 6 }, { label: "chart-8806", weight: 4 }], load: 10 }
                    ],
                    maxBatchLoad: 10,
                    totalWeight: 24,
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
          batchPartitionSourced: true,
          batchPartitionLoadOptimal: true,
          batchPartitionNoAutonomousAssign: true
        }
      }
    };
    const view = batchPartitionViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("divisible");
      expect(view.maxBatchLoad).toBe(10);
      expect(view.totalWeight).toBe(24);
      expect(view.batches).toHaveLength(2);
      expect(view.batchPartitionLoadOptimal).toBe(true);
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
          policiesEvaluated: ["policy.batchpartition.load-optimal"],
          violations: [{ policyId: "policy.batchpartition.load-optimal", reason: "sub-optimal" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = batchPartitionViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.batchpartition.load-optimal");
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
    const view = batchPartitionViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
