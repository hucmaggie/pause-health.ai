import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  PCP_MATCHING_PRESETS,
  buildPcpMatchingRequestBody,
  pcpMatchingViewFromTask,
  runPcpMatchingTask
} from "./pcp-matching-panel";

describe("PCP_MATCHING_PRESETS", () => {
  it("has the three matching presets and the three governance-block presets", () => {
    const ids = PCP_MATCHING_PRESETS.map((p) => p.id);
    expect(ids).toContain("all-matched");
    expect(ids).toContain("partial-match");
    expect(ids).toContain("capacity");
    expect(ids).toContain("phantom-assignment-block");
    expect(ids).toContain("unstable-block");
    expect(ids).toContain("auto-assigned-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of PCP_MATCHING_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildPcpMatchingRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildPcpMatchingRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { panelRef: "p", members: [], providers: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { panelRef: string }).panelRef).toBe("p");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildPcpMatchingRequestBody({
      taskId: "t-2",
      determination: { disposition: "all-matched" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "all-matched" });
  });
});

describe("runPcpMatchingTask", () => {
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
    const result = await runPcpMatchingTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runPcpMatchingTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("pcpMatchingViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "PcpMatchingDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  panelRef: "pcp-panel-001",
                  determination: {
                    panelRef: "pcp-panel-001",
                    members: [],
                    providers: [],
                    assignments: [
                      { memberId: "m1", label: "Member 1", providerId: "p2", memberRank: 2 }
                    ],
                    providerLoads: [],
                    matchedCount: 1,
                    unmatchedCount: 0,
                    total: 1,
                    disposition: "all-matched",
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
          matchingSourced: true,
          matchingStable: true,
          pcpNoAutonomousAssignment: true
        }
      }
    };
    const view = pcpMatchingViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("all-matched");
      expect(view.assignments).toHaveLength(1);
      expect(view.matchingStable).toBe(true);
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
          policiesEvaluated: ["policy.pcp.matching-stable"],
          violations: [{ policyId: "policy.pcp.matching-stable", reason: "blocking pair" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = pcpMatchingViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.pcp.matching-stable");
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
    const view = pcpMatchingViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
