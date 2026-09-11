import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  QUALITY_SHIFT_PRESETS,
  buildQualityShiftRequestBody,
  qualityShiftViewFromTask,
  runQualityShiftTask
} from "./quality-shift-panel";

describe("QUALITY_SHIFT_PRESETS", () => {
  it("has the three detection presets and the three governance-block presets", () => {
    const ids = QUALITY_SHIFT_PRESETS.map((p) => p.id);
    expect(ids).toContain("shift-up");
    expect(ids).toContain("in-control");
    expect(ids).toContain("shift-down");
    expect(ids).toContain("phantom-point-block");
    expect(ids).toContain("mis-charted-block");
    expect(ids).toContain("auto-actioned-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of QUALITY_SHIFT_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildQualityShiftRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildQualityShiftRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { measureRef: "m", target: 50, slack: 2, threshold: 8, observations: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { measureRef: string }).measureRef).toBe("m");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildQualityShiftRequestBody({
      taskId: "t-2",
      determination: { signal: "shift-up-detected" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ signal: "shift-up-detected" });
  });
});

describe("runQualityShiftTask", () => {
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
    const result = await runQualityShiftTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runQualityShiftTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("qualityShiftViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "QualityShiftDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  measureRef: "measure-x",
                  determination: {
                    measureRef: "measure-x",
                    signal: "shift-up-detected",
                    alarmIndex: 5,
                    alarmDirection: "up",
                    target: 50,
                    threshold: 8,
                    peakHigh: 15,
                    peakLow: 0,
                    points: [
                      { index: 0, value: 50, cusumHigh: 0, cusumLow: 0, alarm: false },
                      { index: 5, value: 57, cusumHigh: 9, cusumLow: 0, alarm: true }
                    ],
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
          qualityObservationsSourced: true,
          qualityCusumConsistent: true,
          qualityNoAutonomousIntervention: true
        }
      }
    };
    const view = qualityShiftViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.signal).toBe("shift-up-detected");
      expect(view.alarmIndex).toBe(5);
      expect(view.points).toHaveLength(2);
      expect(view.qualityCusumConsistent).toBe(true);
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
          policiesEvaluated: ["policy.quality.cusum-consistent"],
          violations: [{ policyId: "policy.quality.cusum-consistent", reason: "mis-charted" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = qualityShiftViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.quality.cusum-consistent");
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
    const view = qualityShiftViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
