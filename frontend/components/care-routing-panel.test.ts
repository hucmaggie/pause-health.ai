import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  CARE_ROUTE_PRESETS,
  buildCareRouteRequestBody,
  careRouteViewFromTask,
  runCareRouteTask
} from "./care-routing-panel";

describe("CARE_ROUTE_PRESETS", () => {
  it("has the three route presets and the three governance-block presets", () => {
    const ids = CARE_ROUTE_PRESETS.map((p) => p.id);
    expect(ids).toContain("multi-hop");
    expect(ids).toContain("direct");
    expect(ids).toContain("no-route");
    expect(ids).toContain("phantom-edge-block");
    expect(ids).toContain("sub-optimal-block");
    expect(ids).toContain("auto-routed-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of CARE_ROUTE_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildCareRouteRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildCareRouteRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { routeRef: "r", start: "a", goal: "b", edges: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { routeRef: string }).routeRef).toBe("r");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildCareRouteRequestBody({
      taskId: "t-2",
      determination: { disposition: "route-found" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "route-found" });
  });
});

describe("runCareRouteTask", () => {
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
    const result = await runCareRouteTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runCareRouteTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("careRouteViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "CareRouteDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  routeRef: "care-route-001",
                  determination: {
                    routeRef: "care-route-001",
                    disposition: "route-found",
                    start: "hospital",
                    goal: "home",
                    path: ["hospital", "snf", "home-health", "home"],
                    totalCost: 7,
                    hops: 3,
                    reachable: true,
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
          routePathSourced: true,
          routeOptimal: true,
          routeNoAutonomousRouting: true
        }
      }
    };
    const view = careRouteViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("route-found");
      expect(view.path).toEqual(["hospital", "snf", "home-health", "home"]);
      expect(view.totalCost).toBe(7);
      expect(view.routeOptimal).toBe(true);
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
          policiesEvaluated: ["policy.route.route-optimal"],
          violations: [{ policyId: "policy.route.route-optimal", reason: "sub-optimal" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = careRouteViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.route.route-optimal");
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
    const view = careRouteViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
