import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  ROLLING_CENSUS_PRESETS,
  buildRollingCensusRequestBody,
  rollingCensusViewFromTask,
  runRollingCensusTask
} from "./rolling-census-peak-panel";

describe("ROLLING_CENSUS_PRESETS", () => {
  it("has the three report presets and the three governance-block presets", () => {
    const ids = ROLLING_CENSUS_PRESETS.map((p) => p.id);
    expect(ids).toContain("over-capacity");
    expect(ids).toContain("within-capacity");
    expect(ids).toContain("spike");
    expect(ids).toContain("fabricated-max-block");
    expect(ids).toContain("mis-derived-block");
    expect(ids).toContain("auto-diverted-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of ROLLING_CENSUS_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildRollingCensusRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildRollingCensusRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { unitRef: "u", windowSize: 3, capacity: 18, readings: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { unitRef: string }).unitRef).toBe("u");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildRollingCensusRequestBody({
      taskId: "t-2",
      determination: { disposition: "over-capacity" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "over-capacity" });
  });
});

describe("runRollingCensusTask", () => {
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
    const result = await runRollingCensusTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runRollingCensusTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("rollingCensusViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [], timestamp: "now" } },
      artifacts: [
        {
          name: "RollingCensusDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  unitRef: "care-unit-census-2026-5501",
                  determination: {
                    unitRef: "care-unit-census-2026-5501",
                    disposition: "over-capacity",
                    windowMaxes: [15, 20, 20, 20, 19, 16, 17, 18],
                    overCapacityWindows: [1, 2, 3, 4],
                    peakCensus: 20,
                    capacity: 18,
                    windowSize: 3,
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
          censusWindowsSourced: true,
          censusDequeExact: true,
          censusNoAutonomousDivert: true
        }
      }
    };
    const view = rollingCensusViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("over-capacity");
      expect(view.windowMaxes).toHaveLength(8);
      expect(view.overCapacityWindows).toEqual([1, 2, 3, 4]);
      expect(view.peakCensus).toBe(20);
      expect(view.censusDequeExact).toBe(true);
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
          policiesEvaluated: ["policy.rollingcensus.deque-exact"],
          violations: [{ policyId: "policy.rollingcensus.deque-exact", reason: "mis-derived" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = rollingCensusViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.rollingcensus.deque-exact");
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
    const view = rollingCensusViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
