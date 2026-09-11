import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  NETWORK_BUILDOUT_PRESETS,
  buildNetworkBuildoutRequestBody,
  networkBuildoutViewFromTask,
  runNetworkBuildoutTask
} from "./network-buildout-panel";

describe("NETWORK_BUILDOUT_PRESETS", () => {
  it("has the three build presets and the three governance-block presets", () => {
    const ids = NETWORK_BUILDOUT_PRESETS.map((p) => p.id);
    expect(ids).toContain("connected");
    expect(ids).toContain("partitioned");
    expect(ids).toContain("triangle");
    expect(ids).toContain("fabricated-link-block");
    expect(ids).toContain("sub-optimal-block");
    expect(ids).toContain("auto-provisioned-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of NETWORK_BUILDOUT_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildNetworkBuildoutRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildNetworkBuildoutRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { networkRef: "n", sites: [], links: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { networkRef: string }).networkRef).toBe("n");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildNetworkBuildoutRequestBody({
      taskId: "t-2",
      determination: { disposition: "connected" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "connected" });
  });
});

describe("runNetworkBuildoutTask", () => {
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
    const result = await runNetworkBuildoutTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runNetworkBuildoutTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("networkBuildoutViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "NetworkBuildoutDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  networkRef: "network-buildout-hub-4501",
                  determination: {
                    networkRef: "network-buildout-hub-4501",
                    disposition: "connected",
                    chosenLinks: [
                      { a: "hub", b: "north", cost: 3 },
                      { a: "hub", b: "south", cost: 5 }
                    ],
                    totalCost: 18,
                    componentCount: 1,
                    siteCount: 5,
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
          networkTreeSourced: true,
          networkTreeCostOptimal: true,
          networkNoAutonomousProvision: true
        }
      }
    };
    const view = networkBuildoutViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("connected");
      expect(view.totalCost).toBe(18);
      expect(view.componentCount).toBe(1);
      expect(view.chosenLinks).toHaveLength(2);
      expect(view.networkTreeCostOptimal).toBe(true);
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
          policiesEvaluated: ["policy.netbuildout.cost-optimal"],
          violations: [{ policyId: "policy.netbuildout.cost-optimal", reason: "sub-optimal" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = networkBuildoutViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.netbuildout.cost-optimal");
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
    const view = networkBuildoutViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
