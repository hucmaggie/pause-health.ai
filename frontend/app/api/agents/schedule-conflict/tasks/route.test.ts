import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_SCHEDULE_CONFLICT_MAXIMIZE_REQUEST,
  DEMO_SCHEDULE_CONFLICT_REQUEST,
  DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST
} from "../../../../../lib/schedule-conflict";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/schedule-conflict/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

const D = "2026-03-03T";
const ms = (t: string) => Date.parse(`${D}${t}:00Z`);

/** A valid, produced determination over the waitlist demo — the base for the block cases. */
const VALID_DETERMINATION = {
  requestRef: "scr-002",
  resourceRef: "provider-mscp-day-2026-03-03",
  disposition: "conflicts-waitlisted",
  scheduled: [
    { requestId: "r1", memberId: "m1", startMs: ms("09:00"), endMs: ms("10:00") },
    { requestId: "r3", memberId: "m3", startMs: ms("10:00"), endMs: ms("11:00") }
  ],
  conflicts: [
    { requestId: "r2", memberId: "m2", startMs: ms("09:30"), endMs: ms("10:30"), conflictsWith: "r1" },
    { requestId: "r4", memberId: "m4", startMs: ms("09:45"), endMs: ms("10:15"), conflictsWith: "r1" }
  ],
  intervals: [
    { requestId: "r1", memberId: "m1", startMs: ms("09:00"), endMs: ms("10:00") },
    { requestId: "r2", memberId: "m2", startMs: ms("09:30"), endMs: ms("10:30") },
    { requestId: "r3", memberId: "m3", startMs: ms("10:00"), endMs: ms("11:00") },
    { requestId: "r4", memberId: "m4", startMs: ms("09:45"), endMs: ms("10:15") }
  ],
  invalidRequests: [],
  totalRequests: 4,
  scheduledCount: 2,
  conflictCount: 2,
  requiresSchedulerReview: true,
  autoBooked: false
};

describe("POST /api/agents/schedule-conflict/tasks", () => {
  it("conflict-free → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-schedule-free-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_SCHEDULE_CONFLICT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("conflict-free");
    expect(body.result.metadata.agentFabric.scheduledCount).toBe(3);
    expect(body.result.metadata.agentFabric.scheduleIntervalsSourced).toBe(true);
    expect(body.result.metadata.agentFabric.scheduleConflictFree).toBe(true);
    expect(body.result.metadata.agentFabric.scheduleNoAutonomousBooking).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("schedule.receive-requests");
    expect(ops).toContain("schedule.select-intervals");
    expect(ops).toContain("schedule.check-conflicts");
    expect(ops).toContain("schedule.log-audit");
    const selectSpan = spans.find((s) => s.operation === "schedule.select-intervals");
    expect(selectSpan?.agentId).toBe("schedule-conflict-agent");
    expect(selectSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("overlapping → completed, partial + waitlist", async () => {
    const taskId = "test-schedule-waitlist-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("conflicts-waitlisted");
    expect(body.result.metadata.agentFabric.conflictCount).toBe(2);
  });

  it("maximize → completed, two scheduled", async () => {
    const taskId = "test-schedule-max-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_SCHEDULE_CONFLICT_MAXIMIZE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.scheduledCount).toBe(2);
  });

  it("blocks a fabricated appointment (intervals-sourced)", async () => {
    const taskId = "test-schedule-fab-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  scheduled: [
                    { requestId: "r1", memberId: "m-ghost", startMs: ms("09:00"), endMs: ms("10:00") },
                    { requestId: "r3", memberId: "m3", startMs: ms("10:00"), endMs: ms("11:00") }
                  ]
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.schedule.intervals-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "schedule.select-intervals.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "schedule.log-audit")).toBe(false);
  });

  it("blocks a double-booked resource (conflict-free)", async () => {
    const taskId = "test-schedule-double-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  scheduled: [
                    { requestId: "r1", memberId: "m1", startMs: ms("09:00"), endMs: ms("10:00") },
                    { requestId: "r2", memberId: "m2", startMs: ms("09:30"), endMs: ms("10:30") },
                    { requestId: "r3", memberId: "m3", startMs: ms("10:00"), endMs: ms("11:00") }
                  ],
                  conflicts: [
                    { requestId: "r4", memberId: "m4", startMs: ms("09:45"), endMs: ms("10:15"), conflictsWith: "r1" }
                  ],
                  scheduledCount: 3,
                  conflictCount: 1
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.schedule.conflict-free");
  });

  it("blocks an autonomous booking (no-autonomous-booking)", async () => {
    const taskId = "test-schedule-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresSchedulerReview: false,
                  autoBooked: true
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.schedule.no-autonomous-booking");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/schedule-conflict/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "x", method: "tasks/get" })
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("rejects unparseable JSON with -32700", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/schedule-conflict/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json"
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });
});
