import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  ACCESS_ANOMALY_PRESETS,
  accessAnomalyViewFromTask,
  buildAccessAnomalyRequestBody,
  runAccessAnomalyTask
} from "./access-anomaly-panel";
import { DEMO_ACCESS_ANOMALY_REQUEST } from "../lib/access-anomaly";

describe("ACCESS_ANOMALY_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(ACCESS_ANOMALY_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of ACCESS_ANOMALY_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = ACCESS_ANOMALY_PRESETS.map((p) => p.id);
    expect(ids).toContain("fabricated-peak-block");
    expect(ids).toContain("bad-count-block");
    expect(ids).toContain("auto-action-block");
  });
});

describe("buildAccessAnomalyRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildAccessAnomalyRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_ACCESS_ANOMALY_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_ACCESS_ANOMALY_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildAccessAnomalyRequestBody({
      taskId: "t2",
      determination: { autoLockedAccount: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoLockedAccount: true });
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

describe("runAccessAnomalyTask", () => {
  it("POSTs to the access-anomaly route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runAccessAnomalyTask(
      { taskId: "t", request: DEMO_ACCESS_ANOMALY_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/access-anomaly/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runAccessAnomalyTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("accessAnomalyViewFromTask", () => {
  it("lifts a resolved finding from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "AccessAnomalyDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  requestRef: "aad-001",
                  determination: {
                    requestRef: "aad-001",
                    actorRef: "actor-3391",
                    disposition: "anomalous-access-volume",
                    windowMinutes: 60,
                    threshold: 20,
                    peakWindow: {
                      startTime: "2025-01-15T09:00:00Z",
                      endTime: "2025-01-15T09:46:00Z",
                      startEpochMs: 0,
                      endEpochMs: 0,
                      count: 24,
                      distinctPatients: 24,
                      eventIds: []
                    },
                    totalEvents: 24,
                    distinctPatientsTotal: 24,
                    hasAnomaly: true,
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
          accessEventsSourced: true,
          accessWindowCountConsistent: true,
          accessNoAutonomousAction: true
        }
      }
    };
    const view = accessAnomalyViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("anomalous-access-volume");
      expect(view.peakWindow.count).toBe(24);
      expect(view.hasAnomaly).toBe(true);
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
          policiesEvaluated: ["policy.access.window-count-consistent"],
          violations: [
            { policyId: "policy.access.window-count-consistent", reason: "miscounted peak" }
          ]
        }
      }
    };
    const view = accessAnomalyViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.access.window-count-consistent");
      expect(view.policiesEvaluated).toContain("policy.access.window-count-consistent");
    }
  });
});
