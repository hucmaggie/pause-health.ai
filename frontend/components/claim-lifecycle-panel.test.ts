import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  CLAIM_LIFECYCLE_PRESETS,
  buildClaimLifecycleRequestBody,
  claimLifecycleViewFromTask,
  runClaimLifecycleTask
} from "./claim-lifecycle-panel";

describe("CLAIM_LIFECYCLE_PRESETS", () => {
  it("has the three finding presets and the three governance-block presets", () => {
    const ids = CLAIM_LIFECYCLE_PRESETS.map((p) => p.id);
    expect(ids).toContain("transition-allowed");
    expect(ids).toContain("illegal-but-reachable");
    expect(ids).toContain("unreachable");
    expect(ids).toContain("fabricated-state-block");
    expect(ids).toContain("miscomputed-transition-block");
    expect(ids).toContain("auto-advanced-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of CLAIM_LIFECYCLE_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildClaimLifecycleRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildClaimLifecycleRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: {
        claimRef: "c",
        patientRef: "p",
        currentStatus: "draft",
        requestedStatus: "paid"
      }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { currentStatus: string }).currentStatus).toBe("draft");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildClaimLifecycleRequestBody({
      taskId: "t-2",
      determination: { disposition: "transition-allowed" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "transition-allowed" });
  });
});

describe("runClaimLifecycleTask", () => {
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
    const result = await runClaimLifecycleTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runClaimLifecycleTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("claimLifecycleViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "ClaimLifecycleDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  claimRef: "clm-002",
                  determination: {
                    claimRef: "clm-002",
                    patientRef: "patient-5528",
                    currentStatus: "draft",
                    requestedStatus: "paid",
                    disposition: "transition-illegal-but-reachable",
                    directEdge: false,
                    reachable: true,
                    allowedNextStates: ["submitted", "void"],
                    shortestPath: ["draft", "submitted", "acknowledged", "adjudicated", "paid"],
                    pathLength: 4,
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
          claimStatesSourced: true,
          claimTransitionConsistent: true,
          claimNoAutonomousAdvance: true
        }
      }
    };
    const view = claimLifecycleViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("transition-illegal-but-reachable");
      expect(view.pathLength).toBe(4);
      expect(view.shortestPath).toHaveLength(5);
      expect(view.claimStatesSourced).toBe(true);
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
          policiesEvaluated: ["policy.claim.transition-consistent"],
          violations: [{ policyId: "policy.claim.transition-consistent", reason: "bad logic" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = claimLifecycleViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.claim.transition-consistent");
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
    const view = claimLifecycleViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
