import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  PEAK_WINDOW_PRESETS,
  buildPeakWindowRequestBody,
  peakWindowViewFromTask,
  runPeakWindowTask
} from "./peak-window-panel";

describe("PEAK_WINDOW_PRESETS", () => {
  it("has the three detection presets and the three governance-block presets", () => {
    const ids = PEAK_WINDOW_PRESETS.map((p) => p.id);
    expect(ids).toContain("positive");
    expect(ids).toContain("all-negative");
    expect(ids).toContain("all-positive");
    expect(ids).toContain("phantom-window-block");
    expect(ids).toContain("suboptimal-block");
    expect(ids).toContain("auto-actioned-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of PEAK_WINDOW_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildPeakWindowRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildPeakWindowRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { seriesRef: "s", series: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { seriesRef: string }).seriesRef).toBe("s");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildPeakWindowRequestBody({
      taskId: "t-2",
      determination: { disposition: "positive-window" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "positive-window" });
  });
});

describe("runPeakWindowTask", () => {
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
    const result = await runPeakWindowTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runPeakWindowTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("peakWindowViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "PeakWindowDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  seriesRef: "net-new-arr-2026",
                  determination: {
                    seriesRef: "net-new-arr-2026",
                    disposition: "positive-window",
                    series: [
                      { period: "Jan", net: 6 },
                      { period: "Feb", net: -9 }
                    ],
                    startIndex: 0,
                    endIndex: 0,
                    windowSum: 6,
                    windowLength: 1,
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
          peakWindowSourced: true,
          peakWindowOptimal: true,
          peakWindowNoAutonomousAction: true
        }
      }
    };
    const view = peakWindowViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("positive-window");
      expect(view.windowSum).toBe(6);
      expect(view.series).toHaveLength(2);
      expect(view.peakWindowOptimal).toBe(true);
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
          policiesEvaluated: ["policy.peak-window.window-optimal"],
          violations: [{ policyId: "policy.peak-window.window-optimal", reason: "sub-optimal" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = peakWindowViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.peak-window.window-optimal");
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
    const view = peakWindowViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
