import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  REFERRAL_THROUGHPUT_PRESETS,
  buildReferralThroughputRequestBody,
  referralThroughputViewFromTask,
  runReferralThroughputTask
} from "./referral-throughput-panel";

describe("REFERRAL_THROUGHPUT_PRESETS", () => {
  it("has the three throughput presets and the three governance-block presets", () => {
    const ids = REFERRAL_THROUGHPUT_PRESETS.map((p) => p.id);
    expect(ids).toContain("bottlenecked");
    expect(ids).toContain("unconstrained");
    expect(ids).toContain("diamond");
    expect(ids).toContain("over-capacity-block");
    expect(ids).toContain("sub-maximal-block");
    expect(ids).toContain("auto-routed-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of REFERRAL_THROUGHPUT_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildReferralThroughputRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildReferralThroughputRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { networkRef: "n", source: "s", sink: "t", edges: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { networkRef: string }).networkRef).toBe("n");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildReferralThroughputRequestBody({
      taskId: "t-2",
      determination: { disposition: "bottlenecked" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "bottlenecked" });
  });
});

describe("runReferralThroughputTask", () => {
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
    const result = await runReferralThroughputTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runReferralThroughputTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("referralThroughputViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "ReferralThroughputDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  networkRef: "referral-network-menoclinic-5510",
                  determination: {
                    networkRef: "referral-network-menoclinic-5510",
                    disposition: "bottlenecked",
                    flows: [{ from: "intake", to: "pool-a", flow: 4 }],
                    maxFlow: 8,
                    totalDemand: 12,
                    minCutEdges: [{ from: "gyn", to: "slots", capacity: 4 }],
                    minCutCapacity: 8,
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
          referralFlowSourced: true,
          referralThroughputOptimal: true,
          referralNoAutonomousRoute: true
        }
      }
    };
    const view = referralThroughputViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("bottlenecked");
      expect(view.maxFlow).toBe(8);
      expect(view.totalDemand).toBe(12);
      expect(view.minCutEdges).toHaveLength(1);
      expect(view.referralThroughputOptimal).toBe(true);
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
          policiesEvaluated: ["policy.referralflow.throughput-optimal"],
          violations: [{ policyId: "policy.referralflow.throughput-optimal", reason: "sub-maximal" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = referralThroughputViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.referralflow.throughput-optimal");
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
    const view = referralThroughputViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
