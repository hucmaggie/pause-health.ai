import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  ENROLLMENT_RECONCILIATION_PRESETS,
  buildEnrollmentReconciliationRequestBody,
  enrollmentReconciliationViewFromTask,
  runEnrollmentReconciliationTask
} from "./enrollment-reconciliation-panel";
import { DEMO_ENROLLMENT_RECONCILIATION_REQUEST } from "../lib/enrollment-reconciliation";

describe("ENROLLMENT_RECONCILIATION_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(ENROLLMENT_RECONCILIATION_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of ENROLLMENT_RECONCILIATION_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = ENROLLMENT_RECONCILIATION_PRESETS.map((p) => p.id);
    expect(ids).toContain("dropped-member-block");
    expect(ids).toContain("fabricated-discrepancy-block");
    expect(ids).toContain("auto-applied-block");
  });
});

describe("buildEnrollmentReconciliationRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildEnrollmentReconciliationRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_ENROLLMENT_RECONCILIATION_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_ENROLLMENT_RECONCILIATION_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildEnrollmentReconciliationRequestBody({
      taskId: "t2",
      determination: { autoApplied: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoApplied: true });
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

describe("runEnrollmentReconciliationTask", () => {
  it("POSTs to the enrollment-reconciliation route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runEnrollmentReconciliationTask(
      { taskId: "t", request: DEMO_ENROLLMENT_RECONCILIATION_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/enrollment-reconciliation/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runEnrollmentReconciliationTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("enrollmentReconciliationViewFromTask", () => {
  it("lifts a resolved reconciliation from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "EnrollmentReconciliationDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  requestRef: "recon-001",
                  determination: {
                    requestRef: "recon-001",
                    groupRef: "group-4821",
                    comparedFields: ["coverageTier"],
                    totalMembers: 4,
                    counts: { enroll: 1, terminate: 1, update: 1, noChange: 1 },
                    actions: [
                      { memberId: "M1", action: "no-change" },
                      { memberId: "M2", action: "update", differingFields: [{ field: "coverageTier", sourceValue: "employee-only", carrierValue: "family" }] },
                      { memberId: "M3", action: "enroll" },
                      { memberId: "M4", action: "terminate" }
                    ],
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
          reconciliationComplete: true,
          reconciliationActionsSourced: true,
          reconciliationNoAutonomousChange: true
        }
      }
    };
    const view = enrollmentReconciliationViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.totalMembers).toBe(4);
      expect(view.actions).toHaveLength(4);
      expect(view.counts.update).toBe(1);
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
          policiesEvaluated: ["policy.enrollment.reconciliation-complete"],
          violations: [{ policyId: "policy.enrollment.reconciliation-complete", reason: "dropped member" }]
        }
      }
    };
    const view = enrollmentReconciliationViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.enrollment.reconciliation-complete");
      expect(view.policiesEvaluated).toContain("policy.enrollment.reconciliation-complete");
    }
  });
});
