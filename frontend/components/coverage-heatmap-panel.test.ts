import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  COVERAGE_HEATMAP_PRESETS,
  buildCoverageHeatmapRequestBody,
  coverageHeatmapViewFromTask,
  runCoverageHeatmapTask
} from "./coverage-heatmap-panel";

describe("COVERAGE_HEATMAP_PRESETS", () => {
  it("has the three heatmap presets and the three governance-block presets", () => {
    const ids = COVERAGE_HEATMAP_PRESETS.map((p) => p.id);
    expect(ids).toContain("understaffed");
    expect(ids).toContain("fully-covered");
    expect(ids).toContain("spike");
    expect(ids).toContain("fabricated-coverage-block");
    expect(ids).toContain("mis-materialized-block");
    expect(ids).toContain("auto-staffed-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of COVERAGE_HEATMAP_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildCoverageHeatmapRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildCoverageHeatmapRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { scheduleRef: "s", slotCount: 12, requiredMin: 2, intervals: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { scheduleRef: string }).scheduleRef).toBe("s");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildCoverageHeatmapRequestBody({
      taskId: "t-2",
      determination: { disposition: "understaffed" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "understaffed" });
  });
});

describe("runCoverageHeatmapTask", () => {
  it("POSTs and returns the A2A task result", async () => {
    const task: A2ATask = {
      id: "t-9",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [], timestamp: "now" } }
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t-9", result: task }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const result = await runCoverageHeatmapTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runCoverageHeatmapTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("coverageHeatmapViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [], timestamp: "now" } },
      artifacts: [
        {
          name: "CoverageHeatmapDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  scheduleRef: "care-unit-coverage-2026-4408",
                  determination: {
                    scheduleRef: "care-unit-coverage-2026-4408",
                    disposition: "understaffed",
                    coverage: [2, 2, 3, 3, 3, 3, 1, 1, 3, 3, 2, 2],
                    understaffedSlots: [6, 7],
                    minCoverage: 1,
                    maxCoverage: 3,
                    requiredMin: 2,
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
          coverageSourcedSignal: true,
          coverageAccumulationExact: true,
          coverageNoAutonomousStaff: true
        }
      }
    };
    const view = coverageHeatmapViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("understaffed");
      expect(view.coverage).toHaveLength(12);
      expect(view.understaffedSlots).toEqual([6, 7]);
      expect(view.minCoverage).toBe(1);
      expect(view.coverageAccumulationExact).toBe(true);
    }
  });

  it("lifts a blocked view from a governance block", () => {
    const task: A2ATask = {
      id: "t-2",
      status: {
        state: "failed",
        timestamp: "now",
        message: { role: "agent", parts: [{ type: "text", text: "blocked" }], timestamp: "now" }
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: ["policy.coverageheat.accumulation-exact"],
          violations: [{ policyId: "policy.coverageheat.accumulation-exact", reason: "mis-materialized" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = coverageHeatmapViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.coverageheat.accumulation-exact");
    }
  });

  it("lifts an invalid view from a non-block failure", () => {
    const task: A2ATask = {
      id: "t-3",
      status: {
        state: "failed",
        timestamp: "now",
        message: { role: "agent", parts: [{ type: "text", text: "nope" }], timestamp: "now" }
      },
      metadata: { agentFabric: { decision: "invalid", traceTaskId: "t-3" } }
    };
    const view = coverageHeatmapViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
