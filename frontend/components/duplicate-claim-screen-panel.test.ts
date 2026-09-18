import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  DUPLICATE_SCREEN_PRESETS,
  buildDuplicateScreenRequestBody,
  duplicateScreenViewFromTask,
  runDuplicateScreenTask
} from "./duplicate-claim-screen-panel";

describe("DUPLICATE_SCREEN_PRESETS", () => {
  it("has the three screen presets and the three governance-block presets", () => {
    const ids = DUPLICATE_SCREEN_PRESETS.map((p) => p.id);
    expect(ids).toContain("possible-duplicates");
    expect(ids).toContain("all-clear");
    expect(ids).toContain("saturated");
    expect(ids).toContain("fabricated-array-block");
    expect(ids).toContain("false-negative-block");
    expect(ids).toContain("auto-rejected-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of DUPLICATE_SCREEN_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildDuplicateScreenRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildDuplicateScreenRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { batchRef: "b", bitSize: 64, hashCount: 3, processedIds: [], incomingIds: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { batchRef: string }).batchRef).toBe("b");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildDuplicateScreenRequestBody({
      taskId: "t-2",
      determination: { disposition: "all-clear" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "all-clear" });
  });
});

describe("runDuplicateScreenTask", () => {
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
    const result = await runDuplicateScreenTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runDuplicateScreenTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("duplicateScreenViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [], timestamp: "now" } },
      artifacts: [
        {
          name: "DuplicateScreenDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  batchRef: "claims-batch-2026-09-1180",
                  determination: {
                    batchRef: "claims-batch-2026-09-1180",
                    disposition: "possible-duplicates",
                    results: [
                      { id: "CLM-88002", verdict: "possibly-duplicate" },
                      { id: "CLM-90010", verdict: "definitely-new" }
                    ],
                    possibleDuplicateCount: 3,
                    definitelyNewCount: 2,
                    setBitCount: 16,
                    estimatedFalsePositiveRate: 0.014735,
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
          dupScreenFilterSourced: true,
          dupScreenMembershipExact: true,
          dupScreenNoAutonomousReject: true
        }
      }
    };
    const view = duplicateScreenViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("possible-duplicates");
      expect(view.possibleDuplicateCount).toBe(3);
      expect(view.definitelyNewCount).toBe(2);
      expect(view.results).toHaveLength(2);
      expect(view.dupScreenMembershipExact).toBe(true);
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
          policiesEvaluated: ["policy.dupscreen.membership-exact"],
          violations: [{ policyId: "policy.dupscreen.membership-exact", reason: "false negative" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = duplicateScreenViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.dupscreen.membership-exact");
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
    const view = duplicateScreenViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
