import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  LIST_RECONCILIATION_PRESETS,
  buildListReconciliationRequestBody,
  listReconciliationViewFromTask,
  runListReconciliationTask
} from "./list-reconciliation-panel";

describe("LIST_RECONCILIATION_PRESETS", () => {
  it("has the three reconciliation presets and the three governance-block presets", () => {
    const ids = LIST_RECONCILIATION_PRESETS.map((p) => p.id);
    expect(ids).toContain("changed");
    expect(ids).toContain("match");
    expect(ids).toContain("problem-list");
    expect(ids).toContain("phantom-retained-block");
    expect(ids).toContain("suboptimal-block");
    expect(ids).toContain("auto-applied-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of LIST_RECONCILIATION_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildListReconciliationRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildListReconciliationRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: { recordRef: "r", prior: ["a"], current: ["a"] }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { recordRef: string }).recordRef).toBe("r");
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildListReconciliationRequestBody({
      taskId: "t-2",
      determination: { disposition: "changes-present" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "changes-present" });
  });
});

describe("runListReconciliationTask", () => {
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
    const result = await runListReconciliationTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runListReconciliationTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("listReconciliationViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "ListReconciliationDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  recordRef: "med-list-mrn-4821",
                  determination: {
                    recordRef: "med-list-mrn-4821",
                    disposition: "changes-present",
                    retained: ["metformin", "atorvastatin", "aspirin"],
                    added: ["estradiol"],
                    removed: ["lisinopril"],
                    lcsLength: 3,
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
          listDiffSourced: true,
          listDiffLcsOptimal: true,
          listDiffNoAutonomousUpdate: true
        }
      }
    };
    const view = listReconciliationViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("changes-present");
      expect(view.lcsLength).toBe(3);
      expect(view.retained).toHaveLength(3);
      expect(view.removed).toEqual(["lisinopril"]);
      expect(view.listDiffLcsOptimal).toBe(true);
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
          policiesEvaluated: ["policy.listdiff.lcs-optimal"],
          violations: [{ policyId: "policy.listdiff.lcs-optimal", reason: "sub-optimal" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = listReconciliationViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.listdiff.lcs-optimal");
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
    const view = listReconciliationViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
