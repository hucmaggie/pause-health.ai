import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_PCP_MATCHING_CAPACITY_REQUEST,
  DEMO_PCP_MATCHING_PARTIAL_REQUEST,
  DEMO_PCP_MATCHING_REQUEST
} from "../../../../../lib/pcp-matching";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/pcp-matching/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the all-matched demo — the block base. */
const VALID_DETERMINATION = {
  panelRef: "pcp-panel-001",
  members: DEMO_PCP_MATCHING_REQUEST.members,
  providers: DEMO_PCP_MATCHING_REQUEST.providers,
  assignments: [
    { memberId: "m1", label: "Member 1", providerId: "p2", memberRank: 2 },
    { memberId: "m2", label: "Member 2", providerId: "p1", memberRank: 1 },
    { memberId: "m3", label: "Member 3", providerId: "p3", memberRank: 3 }
  ],
  providerLoads: [
    { providerId: "p1", capacity: 1, assignedCount: 1 },
    { providerId: "p2", capacity: 1, assignedCount: 1 },
    { providerId: "p3", capacity: 1, assignedCount: 1 }
  ],
  matchedCount: 3,
  unmatchedCount: 0,
  total: 3,
  disposition: "all-matched",
  requiresCoordinatorReview: true,
  autoAssigned: false
};

describe("POST /api/agents/pcp-matching/tasks", () => {
  it("all-matched → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-pcp-all-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_PCP_MATCHING_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("all-matched");
    expect(body.result.metadata.agentFabric.matchedCount).toBe(3);
    expect(body.result.metadata.agentFabric.matchingSourced).toBe(true);
    expect(body.result.metadata.agentFabric.matchingStable).toBe(true);
    expect(body.result.metadata.agentFabric.pcpNoAutonomousAssignment).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("pcp.receive-panel");
    expect(ops).toContain("pcp.run-deferred-acceptance");
    expect(ops).toContain("pcp.classify-disposition");
    expect(ops).toContain("pcp.log-audit");
    const matchSpan = spans.find((s) => s.operation === "pcp.run-deferred-acceptance");
    expect(matchSpan?.agentId).toBe("pcp-matching-agent");
    expect(matchSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("partial-match → completed", async () => {
    const taskId = "test-pcp-partial-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_PCP_MATCHING_PARTIAL_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("partial-match");
    expect(body.result.metadata.agentFabric.unmatchedCount).toBe(1);
  });

  it("capacity-2 provider → completed, all-matched", async () => {
    const taskId = "test-pcp-cap-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_PCP_MATCHING_CAPACITY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("all-matched");
    expect(body.result.metadata.agentFabric.matchedCount).toBe(3);
  });

  it("blocks a phantom member assignment (matching-sourced)", async () => {
    const taskId = "test-pcp-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_PCP_MATCHING_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  assignments: [
                    ...VALID_DETERMINATION.assignments,
                    { memberId: "m9", label: "Phantom", providerId: "p1", memberRank: 1 }
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
    expect(ids).toContain("policy.pcp.matching-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "pcp.run-deferred-acceptance.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "pcp.log-audit")).toBe(false);
  });

  it("blocks an unstable matching (matching-stable)", async () => {
    const taskId = "test-pcp-unstable-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_PCP_MATCHING_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  assignments: [
                    { memberId: "m1", label: "Member 1", providerId: "p3", memberRank: 3 },
                    { memberId: "m2", label: "Member 2", providerId: "p1", memberRank: 1 },
                    { memberId: "m3", label: "Member 3", providerId: "p2", memberRank: 1 }
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
    expect(ids).toContain("policy.pcp.matching-stable");
  });

  it("blocks an autonomous assignment (no-autonomous-assignment)", async () => {
    const taskId = "test-pcp-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_PCP_MATCHING_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresCoordinatorReview: false,
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
    expect(ids).toContain("policy.pcp.no-autonomous-assignment");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/pcp-matching/tasks", {
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
      new Request("http://localhost/api/agents/pcp-matching/tasks", {
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
