import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  SCHEDULE_CONFLICT_PRESETS,
  buildScheduleConflictRequestBody,
  hhmm,
  runScheduleConflictTask,
  scheduleConflictViewFromTask
} from "./schedule-conflict-panel";
import { DEMO_SCHEDULE_CONFLICT_REQUEST } from "../lib/schedule-conflict";

describe("SCHEDULE_CONFLICT_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(SCHEDULE_CONFLICT_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of SCHEDULE_CONFLICT_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = SCHEDULE_CONFLICT_PRESETS.map((p) => p.id);
    expect(ids).toContain("fabricated-appointment-block");
    expect(ids).toContain("double-booked-block");
    expect(ids).toContain("auto-booked-block");
  });
});

describe("hhmm", () => {
  it("formats an epoch-ms as HH:MM UTC", () => {
    expect(hhmm(Date.parse("2026-03-02T09:30:00Z"))).toBe("09:30");
  });
});

describe("buildScheduleConflictRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildScheduleConflictRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_SCHEDULE_CONFLICT_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_SCHEDULE_CONFLICT_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildScheduleConflictRequestBody({
      taskId: "t2",
      determination: { autoBooked: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoBooked: true });
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

describe("runScheduleConflictTask", () => {
  it("POSTs to the schedule-conflict route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runScheduleConflictTask(
      { taskId: "t", request: DEMO_SCHEDULE_CONFLICT_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/schedule-conflict/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runScheduleConflictTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("scheduleConflictViewFromTask", () => {
  it("lifts a resolved schedule from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "ScheduleConflictDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  requestRef: "scr-001",
                  determination: {
                    requestRef: "scr-001",
                    resourceRef: "res",
                    disposition: "conflict-free",
                    scheduled: [{ requestId: "r1", memberId: "m1", startMs: 0, endMs: 10 }],
                    conflicts: [],
                    intervals: [{ requestId: "r1", memberId: "m1", startMs: 0, endMs: 10 }],
                    totalRequests: 1,
                    scheduledCount: 1,
                    conflictCount: 0,
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
          scheduleIntervalsSourced: true,
          scheduleConflictFree: true,
          scheduleNoAutonomousBooking: true
        }
      }
    };
    const view = scheduleConflictViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("conflict-free");
      expect(view.scheduled).toHaveLength(1);
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
          policiesEvaluated: ["policy.schedule.conflict-free"],
          violations: [{ policyId: "policy.schedule.conflict-free", reason: "double-booked" }]
        }
      }
    };
    const view = scheduleConflictViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.schedule.conflict-free");
    }
  });
});
