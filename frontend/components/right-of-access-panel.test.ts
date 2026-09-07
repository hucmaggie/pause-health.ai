import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  RIGHT_OF_ACCESS_PRESETS,
  buildRightOfAccessRequestBody,
  rightOfAccessViewFromTask,
  runRightOfAccessTask
} from "./right-of-access-panel";
import { DEMO_ACCESS_REQUEST } from "../lib/right-of-access";

describe("RIGHT_OF_ACCESS_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(RIGHT_OF_ACCESS_PRESETS.length).toBeGreaterThanOrEqual(7);
    for (const p of RIGHT_OF_ACCESS_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = RIGHT_OF_ACCESS_PRESETS.map((p) => p.id);
    expect(ids).toContain("off-catalog-ground-block");
    expect(ids).toContain("bad-deadline-block");
    expect(ids).toContain("auto-released-block");
  });
});

describe("buildRightOfAccessRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildRightOfAccessRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_ACCESS_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_ACCESS_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildRightOfAccessRequestBody({
      taskId: "t2",
      determination: { autoReleased: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoReleased: true });
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

describe("runRightOfAccessTask", () => {
  it("POSTs to the right-of-access route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runRightOfAccessTask(
      { taskId: "t", request: DEMO_ACCESS_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/right-of-access/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runRightOfAccessTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("rightOfAccessViewFromTask", () => {
  it("lifts a resolved determination from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "AccessDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  requestRef: "access-001",
                  determination: {
                    requestRef: "access-001",
                    patientRef: "patient-8842",
                    requestType: "copy",
                    inDesignatedRecordSet: true,
                    exceptionId: "",
                    exceptionType: "none",
                    extensionInvoked: false,
                    responseDeadline: "2026-09-19",
                    daysUntilDeadline: 12,
                    disposition: "grant-in-full",
                    accessGranted: true,
                    autoReleased: false,
                    requiresHumanReview: true,
                    reason: "ok",
                    synthetic: true,
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
          accessGroundSourced: true,
          accessDeadlineComputed: true,
          accessNoAutonomousDenialOrRelease: true
        }
      }
    };
    const view = rightOfAccessViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("grant-in-full");
      expect(view.responseDeadline).toBe("2026-09-19");
      expect(view.accessDeadlineComputed).toBe(true);
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
          policiesEvaluated: ["policy.access.ground-sourced"],
          violations: [{ policyId: "policy.access.ground-sourced", reason: "off-catalog" }]
        }
      }
    };
    const view = rightOfAccessViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.access.ground-sourced");
      expect(view.policiesEvaluated).toContain("policy.access.ground-sourced");
    }
  });
});
