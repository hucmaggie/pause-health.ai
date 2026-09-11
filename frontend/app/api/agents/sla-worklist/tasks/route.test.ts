import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_WORKLIST_ALL_ON_TIME_REQUEST,
  DEMO_WORKLIST_REQUEST,
  DEMO_WORKLIST_TIGHT_REQUEST,
  evaluateWorklist
} from "../../../../../lib/sla-worklist";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/sla-worklist/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateWorklist(DEMO_WORKLIST_REQUEST);

describe("POST /api/agents/sla-worklist/tasks", () => {
  it("worklist with breaches → completed, with a parented PHI trace", async () => {
    const taskId = "test-wl-breach-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_WORKLIST_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("breaches-present");
    expect(body.result.metadata.agentFabric.lateCount).toBe(1);
    expect(body.result.metadata.agentFabric.worklistScheduleSourced).toBe(true);
    expect(body.result.metadata.agentFabric.worklistEdfOrdered).toBe(true);
    expect(body.result.metadata.agentFabric.worklistNoAutonomousDispatch).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("worklist.receive-cases");
    expect(ops).toContain("worklist.sequence-edf");
    expect(ops).toContain("worklist.classify-disposition");
    expect(ops).toContain("worklist.log-audit");
    const seqSpan = spans.find((s) => s.operation === "worklist.sequence-edf");
    expect(seqSpan?.agentId).toBe("sla-worklist-agent");
    expect(seqSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("all-on-time worklist → completed", async () => {
    const res = await POST(
      rpc({
        id: "test-wl-ontime-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_WORKLIST_ALL_ON_TIME_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("all-on-time");
    expect(body.result.metadata.agentFabric.lateCount).toBe(0);
  });

  it("over-committed worklist → completed (two breaches)", async () => {
    const res = await POST(
      rpc({
        id: "test-wl-tight-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_WORKLIST_TIGHT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.lateCount).toBe(2);
  });

  it("blocks a fabricated case (schedule-sourced)", async () => {
    const taskId = "test-wl-phantom-block-001";
    const scheduled = VALID_DETERMINATION.scheduled.map((s) =>
      s.taskId === "auth-503" ? { ...s, taskId: "phantom-case" } : s
    );
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_WORKLIST_REQUEST,
                determination: { ...VALID_DETERMINATION, scheduled }
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
    expect(ids).toContain("policy.worklist.schedule-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "worklist.sequence-edf.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "worklist.log-audit")).toBe(false);
  });

  it("blocks a non-EDF order (edf-ordered)", async () => {
    const scheduled = [
      { taskId: "auth-501", duration: 30, deadline: 60, startTime: 0, completionTime: 30, late: false, label: "Prior-auth review" },
      { taskId: "auth-502", duration: 20, deadline: 40, startTime: 30, completionTime: 50, late: true, label: "Urgent prior-auth" },
      { taskId: "auth-504", duration: 25, deadline: 70, startTime: 50, completionTime: 75, late: true, label: "Prior-auth review" },
      { taskId: "auth-503", duration: 40, deadline: 200, startTime: 75, completionTime: 115, late: false, label: "Concurrent review" }
    ];
    const res = await POST(
      rpc({
        id: "test-wl-order-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_WORKLIST_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  scheduled,
                  lateCount: 2,
                  onTimeCount: 2,
                  disposition: "breaches-present"
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
    expect(ids).toContain("policy.worklist.edf-ordered");
  });

  it("blocks an autonomous dispatch (no-autonomous-dispatch)", async () => {
    const res = await POST(
      rpc({
        id: "test-wl-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_WORKLIST_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresReviewerReview: false,
                  autoDispatched: true
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
    expect(ids).toContain("policy.worklist.no-autonomous-dispatch");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/sla-worklist/tasks", {
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
      new Request("http://localhost/api/agents/sla-worklist/tasks", {
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
