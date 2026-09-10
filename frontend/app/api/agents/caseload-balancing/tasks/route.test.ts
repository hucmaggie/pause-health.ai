import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_CASELOAD_BALANCING_BALANCED_REQUEST,
  DEMO_CASELOAD_BALANCING_REQUEST,
  DEMO_CASELOAD_BALANCING_WAITLIST_REQUEST
} from "../../../../../lib/caseload-balancing";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/caseload-balancing/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the fully-assigned demo — the base for the block cases. */
const VALID_DETERMINATION = {
  requestRef: "cbl-001",
  panelRef: "panel-4821",
  disposition: "fully-assigned",
  assignments: [
    { memberId: "m1", managerId: "mgr-a", acuity: 5 },
    { memberId: "m2", managerId: "mgr-b", acuity: 4 },
    { memberId: "m3", managerId: "mgr-c", acuity: 4 },
    { memberId: "m4", managerId: "mgr-a", acuity: 3 },
    { memberId: "m5", managerId: "mgr-b", acuity: 3 },
    { memberId: "m6", managerId: "mgr-a", acuity: 2 }
  ],
  managerLoads: [
    { managerId: "mgr-a", capacity: 10, assignedAcuity: 10, remainingCapacity: 0, memberCount: 3, memberIds: ["m1", "m4", "m6"] },
    { managerId: "mgr-b", capacity: 8, assignedAcuity: 7, remainingCapacity: 1, memberCount: 2, memberIds: ["m2", "m5"] },
    { managerId: "mgr-c", capacity: 6, assignedAcuity: 4, remainingCapacity: 2, memberCount: 1, memberIds: ["m3"] }
  ],
  waitlisted: [],
  members: [
    { memberId: "m1", acuity: 5 },
    { memberId: "m2", acuity: 4 },
    { memberId: "m3", acuity: 4 },
    { memberId: "m4", acuity: 3 },
    { memberId: "m5", acuity: 3 },
    { memberId: "m6", acuity: 2 }
  ],
  invalidMembers: [],
  invalidManagers: [],
  totalMembers: 6,
  assignedCount: 6,
  waitlistedCount: 0,
  totalCapacity: 24,
  totalAssignedAcuity: 21,
  requiresCareLeadReview: true,
  autoAssigned: false
};

describe("POST /api/agents/caseload-balancing/tasks", () => {
  it("fully assigned → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-caseload-full-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CASELOAD_BALANCING_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("fully-assigned");
    expect(body.result.metadata.agentFabric.assignedCount).toBe(6);
    expect(body.result.metadata.agentFabric.waitlistedCount).toBe(0);
    expect(body.result.metadata.agentFabric.caseloadAssignmentComplete).toBe(true);
    expect(body.result.metadata.agentFabric.caseloadCapacityRespected).toBe(true);
    expect(body.result.metadata.agentFabric.caseloadNoAutonomousAssignment).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("caseload.receive-panel");
    expect(ops).toContain("caseload.allocate");
    expect(ops).toContain("caseload.check-capacity");
    expect(ops).toContain("caseload.log-audit");
    const allocateSpan = spans.find((s) => s.operation === "caseload.allocate");
    expect(allocateSpan?.agentId).toBe("caseload-balancing-agent");
    expect(allocateSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("over capacity → completed, partial + waitlist", async () => {
    const taskId = "test-caseload-waitlist-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CASELOAD_BALANCING_WAITLIST_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("partially-assigned-waitlist");
    expect(body.result.metadata.agentFabric.waitlistedCount).toBe(2);
  });

  it("equal members → completed, evenly balanced", async () => {
    const taskId = "test-caseload-balanced-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CASELOAD_BALANCING_BALANCED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("fully-assigned");
    expect(body.result.metadata.agentFabric.assignedCount).toBe(4);
  });

  it("blocks a dropped member (assignment-complete)", async () => {
    const taskId = "test-caseload-dropped-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CASELOAD_BALANCING_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  assignments: VALID_DETERMINATION.assignments.filter((a) => a.memberId !== "m6"),
                  managerLoads: VALID_DETERMINATION.managerLoads.map((l) =>
                    l.managerId === "mgr-a"
                      ? { ...l, assignedAcuity: 8, remainingCapacity: 2, memberCount: 2, memberIds: ["m1", "m4"] }
                      : l
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
    expect(ids).toContain("policy.caseload.assignment-complete");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "caseload.allocate.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "caseload.log-audit")).toBe(false);
  });

  it("blocks an over-capacity manager (capacity-respected)", async () => {
    const taskId = "test-caseload-overcap-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CASELOAD_BALANCING_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  managerLoads: VALID_DETERMINATION.managerLoads.map((l) =>
                    l.managerId === "mgr-c" ? { ...l, capacity: 3, remainingCapacity: -1 } : l
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
    expect(ids).toContain("policy.caseload.capacity-respected");
  });

  it("blocks an autonomous assignment (no-autonomous-assignment)", async () => {
    const taskId = "test-caseload-autoassign-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CASELOAD_BALANCING_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresCareLeadReview: false,
                  autoAssigned: true
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
    expect(ids).toContain("policy.caseload.no-autonomous-assignment");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/caseload-balancing/tasks", {
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
      new Request("http://localhost/api/agents/caseload-balancing/tasks", {
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
