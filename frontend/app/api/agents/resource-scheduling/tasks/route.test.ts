import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_BLOCK_SCHEDULE_ALL_REQUEST,
  DEMO_BLOCK_SCHEDULE_REQUEST,
  DEMO_BLOCK_SCHEDULE_WEIGHTED_REQUEST,
  evaluateBlockSchedule
} from "../../../../../lib/resource-scheduling";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/resource-scheduling/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the contended demo — the block base. */
const VALID_DETERMINATION = evaluateBlockSchedule(DEMO_BLOCK_SCHEDULE_REQUEST);

describe("POST /api/agents/resource-scheduling/tasks", () => {
  it("contended resource → completed, with a parented PHI trace", async () => {
    const taskId = "test-rs-contended-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_BLOCK_SCHEDULE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("contended");
    expect(body.result.metadata.agentFabric.totalWeight).toBe(11);
    expect(body.result.metadata.agentFabric.scheduledCount).toBe(2);
    expect(body.result.metadata.agentFabric.blockScheduleSourced).toBe(true);
    expect(body.result.metadata.agentFabric.blockScheduleOptimal).toBe(true);
    expect(body.result.metadata.agentFabric.blockScheduleNoAutonomousBooking).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("schedule.receive-requests");
    expect(ops).toContain("schedule.optimize-selection");
    expect(ops).toContain("schedule.classify-disposition");
    expect(ops).toContain("schedule.log-audit");
    const optSpan = spans.find((s) => s.operation === "schedule.optimize-selection");
    expect(optSpan?.agentId).toBe("resource-scheduling-agent");
    expect(optSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("all-scheduled resource → completed", async () => {
    const res = await POST(
      rpc({
        id: "test-rs-all-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_BLOCK_SCHEDULE_ALL_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("all-scheduled");
    expect(body.result.metadata.agentFabric.contendedCount).toBe(0);
  });

  it("weight-over-count resource → completed (picks the long high-weight block)", async () => {
    const res = await POST(
      rpc({
        id: "test-rs-weighted-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_BLOCK_SCHEDULE_WEIGHTED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.totalWeight).toBe(10);
  });

  it("blocks a fabricated block (selection-sourced)", async () => {
    const taskId = "test-rs-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_BLOCK_SCHEDULE_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  selected: VALID_DETERMINATION.selected.map((id) =>
                    id === "infusion-1104" ? "phantom-block" : id
                  )
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
    expect(ids).toContain("policy.block-schedule.selection-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "schedule.optimize-selection.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "schedule.log-audit")).toBe(false);
  });

  it("blocks a sub-optimal schedule (schedule-optimal)", async () => {
    const res = await POST(
      rpc({
        id: "test-rs-suboptimal-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_BLOCK_SCHEDULE_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  selected: ["infusion-1101", "infusion-1103"],
                  totalWeight: 8,
                  scheduledCount: 2,
                  contendedCount: 3,
                  disposition: "contended"
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
    expect(ids).toContain("policy.block-schedule.schedule-optimal");
  });

  it("blocks an autonomous booking (no-autonomous-booking)", async () => {
    const res = await POST(
      rpc({
        id: "test-rs-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_BLOCK_SCHEDULE_REQUEST,
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
    expect(ids).toContain("policy.block-schedule.no-autonomous-booking");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/resource-scheduling/tasks", {
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
      new Request("http://localhost/api/agents/resource-scheduling/tasks", {
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
