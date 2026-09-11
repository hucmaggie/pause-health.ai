import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  OUTREACH_PRESETS,
  buildOutreachRequestBody,
  outreachViewFromTask,
  runOutreachTask
} from "./outreach-prioritization-panel";

describe("OUTREACH_PRESETS", () => {
  it("has the three allocation presets and the three governance-block presets", () => {
    const ids = OUTREACH_PRESETS.map((p) => p.id);
    expect(ids).toContain("some-deferred");
    expect(ids).toContain("all-scheduled");
    expect(ids).toContain("tight");
    expect(ids).toContain("phantom-intervention-block");
    expect(ids).toContain("sub-optimal-block");
    expect(ids).toContain("auto-scheduled-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of OUTREACH_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildOutreachRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildOutreachRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { cycleRef: "c", capacity: 10, candidates: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { cycleRef: string }).cycleRef).toBe("c");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildOutreachRequestBody({
      taskId: "t-2",
      determination: { disposition: "some-deferred" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "some-deferred" });
  });
});

describe("runOutreachTask", () => {
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
    const result = await runOutreachTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runOutreachTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("outreachViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "OutreachDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  cycleRef: "outreach-cycle-001",
                  determination: {
                    cycleRef: "outreach-cycle-001",
                    disposition: "some-deferred",
                    capacity: 10,
                    totalCost: 10,
                    totalBenefit: 140,
                    remainingCapacity: 0,
                    selected: [{ id: "iv-hrt-titration", cost: 5, benefit: 60 }],
                    deferred: [{ id: "iv-sdoh-checkin", cost: 4, benefit: 40 }],
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
          outreachSelectionsSourced: true,
          outreachAllocationOptimal: true,
          outreachNoAutonomousSchedule: true
        }
      }
    };
    const view = outreachViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("some-deferred");
      expect(view.selected).toHaveLength(1);
      expect(view.deferred).toHaveLength(1);
      expect(view.totalBenefit).toBe(140);
      expect(view.outreachAllocationOptimal).toBe(true);
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
          policiesEvaluated: ["policy.outreach.allocation-optimal"],
          violations: [{ policyId: "policy.outreach.allocation-optimal", reason: "sub-optimal" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = outreachViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.outreach.allocation-optimal");
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
    const view = outreachViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
