import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  CASELOAD_BALANCING_PRESETS,
  buildCaseloadBalancingRequestBody,
  caseloadBalancingViewFromTask,
  runCaseloadBalancingTask
} from "./caseload-balancing-panel";
import { DEMO_CASELOAD_BALANCING_REQUEST } from "../lib/caseload-balancing";

describe("CASELOAD_BALANCING_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(CASELOAD_BALANCING_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of CASELOAD_BALANCING_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = CASELOAD_BALANCING_PRESETS.map((p) => p.id);
    expect(ids).toContain("dropped-member-block");
    expect(ids).toContain("over-capacity-block");
    expect(ids).toContain("auto-assigned-block");
  });
});

describe("buildCaseloadBalancingRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildCaseloadBalancingRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_CASELOAD_BALANCING_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_CASELOAD_BALANCING_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildCaseloadBalancingRequestBody({
      taskId: "t2",
      determination: { autoAssigned: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoAssigned: true });
  });
});

function okResponse(task: A2ATask): Response {
  const payload: A2ARpcResponse<A2ATask> = { jsonrpc: "2.0", id: "x", result: task };
  return {
    ok: true,
    status: 200,
    json: async () => payload
  } as unknown as Response;
}

describe("runCaseloadBalancingTask", () => {
  it("POSTs to the caseload-balancing route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runCaseloadBalancingTask(
      { taskId: "t", request: DEMO_CASELOAD_BALANCING_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/caseload-balancing/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runCaseloadBalancingTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("caseloadBalancingViewFromTask", () => {
  it("lifts a resolved allocation from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "CaseloadBalancingDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  requestRef: "cbl-001",
                  determination: {
                    requestRef: "cbl-001",
                    panelRef: "panel-4821",
                    disposition: "fully-assigned",
                    assignments: [{ memberId: "m1", managerId: "mgr-a", acuity: 5 }],
                    managerLoads: [
                      { managerId: "mgr-a", capacity: 10, assignedAcuity: 5, remainingCapacity: 5, memberCount: 1, memberIds: ["m1"] }
                    ],
                    waitlisted: [],
                    totalMembers: 1,
                    assignedCount: 1,
                    waitlistedCount: 0,
                    totalCapacity: 10,
                    totalAssignedAcuity: 5,
                    reason: "ok",
                    note: "note"
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
          traceTaskId: "trace-1",
          caseloadAssignmentComplete: true,
          caseloadCapacityRespected: true,
          caseloadNoAutonomousAssignment: true
        }
      }
    };
    const view = caseloadBalancingViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("fully-assigned");
      expect(view.managerLoads).toHaveLength(1);
      expect(view.totalAssignedAcuity).toBe(5);
      expect(view.traceTaskId).toBe("trace-1");
    }
  });

  it("lifts a blocked view from a failed task with a fabric block", () => {
    const task: A2ATask = {
      id: "t",
      status: {
        state: "failed",
        timestamp: new Date().toISOString(),
        message: { role: "agent", parts: [{ type: "text", text: "blocked" }] }
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: ["policy.caseload.capacity-respected"],
          violations: [{ policyId: "policy.caseload.capacity-respected", reason: "over capacity" }]
        }
      }
    };
    const view = caseloadBalancingViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.caseload.capacity-respected");
      expect(view.policiesEvaluated).toContain("policy.caseload.capacity-respected");
    }
  });
});
