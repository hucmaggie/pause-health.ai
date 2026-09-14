import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  INTERPRETER_ASSIGNMENT_PRESETS,
  buildInterpreterAssignmentRequestBody,
  interpreterAssignmentViewFromTask,
  runInterpreterAssignmentTask
} from "./interpreter-assignment-panel";

describe("INTERPRETER_ASSIGNMENT_PRESETS", () => {
  it("has the three assignment presets and the three governance-block presets", () => {
    const ids = INTERPRETER_ASSIGNMENT_PRESETS.map((p) => p.id);
    expect(ids).toContain("assignable");
    expect(ids).toContain("greedy-trap");
    expect(ids).toContain("infeasible");
    expect(ids).toContain("reused-interpreter-block");
    expect(ids).toContain("sub-optimal-block");
    expect(ids).toContain("auto-dispatched-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of INTERPRETER_ASSIGNMENT_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildInterpreterAssignmentRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildInterpreterAssignmentRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { rosterRef: "r", interpreters: [], appointments: [], costs: [] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { rosterRef: string }).rosterRef).toBe("r");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildInterpreterAssignmentRequestBody({
      taskId: "t-2",
      determination: { disposition: "assignable" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "assignable" });
  });
});

describe("runInterpreterAssignmentTask", () => {
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
    const result = await runInterpreterAssignmentTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runInterpreterAssignmentTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("interpreterAssignmentViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "InterpreterAssignmentDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  rosterRef: "lang-access-roster-2026-3310",
                  determination: {
                    rosterRef: "lang-access-roster-2026-3310",
                    disposition: "assignable",
                    assignments: [
                      { interpreter: "interp-ES", appointment: "appt-B-mandarin", cost: 2 },
                      { interpreter: "interp-ZH", appointment: "appt-A-spanish", cost: 4 }
                    ],
                    totalCost: 12,
                    unmatched: [],
                    feasible: true,
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
          interpAssignmentSourced: true,
          interpAssignmentOptimal: true,
          interpNoAutonomousDispatch: true
        }
      }
    };
    const view = interpreterAssignmentViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("assignable");
      expect(view.totalCost).toBe(12);
      expect(view.assignments).toHaveLength(2);
      expect(view.feasible).toBe(true);
      expect(view.interpAssignmentOptimal).toBe(true);
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
          policiesEvaluated: ["policy.interpasg.cost-optimal"],
          violations: [{ policyId: "policy.interpasg.cost-optimal", reason: "sub-optimal" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = interpreterAssignmentViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.interpasg.cost-optimal");
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
    const view = interpreterAssignmentViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
