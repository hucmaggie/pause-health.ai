import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  STATUS_TIMELINE_PRESETS,
  buildStatusTimelineRequestBody,
  runStatusTimelineTask,
  statusTimelineViewFromTask
} from "./status-timeline-rle-panel";

describe("STATUS_TIMELINE_PRESETS", () => {
  it("has the three encoding presets and the three governance-block presets", () => {
    const ids = STATUS_TIMELINE_PRESETS.map((p) => p.id);
    expect(ids).toContain("compressible");
    expect(ids).toContain("incompressible");
    expect(ids).toContain("stable");
    expect(ids).toContain("doesnt-decode-block");
    expect(ids).toContain("over-split-block");
    expect(ids).toContain("auto-written-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of STATUS_TIMELINE_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildStatusTimelineRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildStatusTimelineRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { streamRef: "s", statuses: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { streamRef: string }).streamRef).toBe("s");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildStatusTimelineRequestBody({
      taskId: "t-2",
      determination: { disposition: "compressible" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "compressible" });
  });
});

describe("runStatusTimelineTask", () => {
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
    const result = await runStatusTimelineTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runStatusTimelineTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("statusTimelineViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [], timestamp: "now" } },
      artifacts: [
        {
          name: "StatusTimelineDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  streamRef: "rpm-device-status-2026-6601",
                  determination: {
                    streamRef: "rpm-device-status-2026-6601",
                    disposition: "compressible",
                    runs: [
                      { value: "normal", length: 5 },
                      { value: "high", length: 3 }
                    ],
                    runCount: 5,
                    originalLength: 16,
                    compressionRatio: 3.2,
                    longestRun: 5,
                    dominantStatus: "normal",
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
          statusEncodingSourced: true,
          statusRunsCanonical: true,
          statusNoAutonomousWrite: true
        }
      }
    };
    const view = statusTimelineViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("compressible");
      expect(view.runCount).toBe(5);
      expect(view.compressionRatio).toBe(3.2);
      expect(view.dominantStatus).toBe("normal");
      expect(view.statusRunsCanonical).toBe(true);
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
          policiesEvaluated: ["policy.statusrle.runs-canonical"],
          violations: [{ policyId: "policy.statusrle.runs-canonical", reason: "over-split" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = statusTimelineViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.statusrle.runs-canonical");
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
    const view = statusTimelineViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
