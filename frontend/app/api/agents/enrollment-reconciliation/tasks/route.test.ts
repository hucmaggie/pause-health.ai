import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_ENROLLMENT_RECONCILIATION_CLEAN_REQUEST,
  DEMO_ENROLLMENT_RECONCILIATION_NEW_GROUP_REQUEST,
  DEMO_ENROLLMENT_RECONCILIATION_REQUEST
} from "../../../../../lib/enrollment-reconciliation";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/enrollment-reconciliation/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/enrollment-reconciliation/tasks", () => {
  it("drifted rosters → completed, one of each action, with a parented PHI-bearing trace", async () => {
    const taskId = "test-recon-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ENROLLMENT_RECONCILIATION_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.totalMembers).toBe(4);
    expect(body.result.metadata.agentFabric.enroll).toBe(1);
    expect(body.result.metadata.agentFabric.terminate).toBe(1);
    expect(body.result.metadata.agentFabric.update).toBe(1);
    expect(body.result.metadata.agentFabric.noChange).toBe(1);
    expect(body.result.metadata.agentFabric.reconciliationComplete).toBe(true);
    expect(body.result.metadata.agentFabric.reconciliationActionsSourced).toBe(true);
    expect(body.result.metadata.agentFabric.reconciliationNoAutonomousChange).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("enrollment.receive-rosters");
    expect(ops).toContain("enrollment.diff-rosters");
    expect(ops).toContain("enrollment.classify-actions");
    expect(ops).toContain("enrollment.log-audit");
    const diffSpan = spans.find((s) => s.operation === "enrollment.diff-rosters");
    expect(diffSpan?.agentId).toBe("enrollment-reconciliation-agent");
    expect(diffSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("agreeing rosters → all no-change", async () => {
    const taskId = "test-recon-clean-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ENROLLMENT_RECONCILIATION_CLEAN_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.noChange).toBe(2);
    expect(body.result.metadata.agentFabric.update).toBe(0);
  });

  it("new group, empty carrier → all enroll", async () => {
    const taskId = "test-recon-new-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ENROLLMENT_RECONCILIATION_NEW_GROUP_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.enroll).toBe(2);
  });

  it("blocks an incomplete reconciliation (reconciliation-complete)", async () => {
    const taskId = "test-recon-dropped-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ENROLLMENT_RECONCILIATION_REQUEST,
                determination: {
                  requestRef: "recon-001",
                  groupRef: "group-4821",
                  comparedFields: ["name", "coverageTier", "planId", "status"],
                  totalMembers: 4,
                  actions: [
                    { memberId: "M1", action: "no-change" },
                    { memberId: "M2", action: "update", differingFields: [{ field: "coverageTier", sourceValue: "employee-only", carrierValue: "family" }] },
                    { memberId: "M3", action: "enroll" }
                  ],
                  counts: { enroll: 1, terminate: 0, update: 1, noChange: 1 },
                  requiresBenefitsAdminReview: true,
                  autoApplied: false
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
    expect(ids).toContain("policy.enrollment.reconciliation-complete");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "enrollment.diff-rosters.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "enrollment.log-audit")).toBe(false);
  });

  it("blocks a fabricated discrepancy (actions-sourced)", async () => {
    const taskId = "test-recon-fabricated-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ENROLLMENT_RECONCILIATION_REQUEST,
                determination: {
                  requestRef: "recon-001",
                  groupRef: "group-4821",
                  comparedFields: ["coverageTier"],
                  totalMembers: 1,
                  actions: [
                    { memberId: "M1", action: "update", differingFields: [{ field: "coverageTier", sourceValue: "family", carrierValue: "family" }] }
                  ],
                  counts: { enroll: 0, terminate: 0, update: 1, noChange: 0 },
                  requiresBenefitsAdminReview: true,
                  autoApplied: false
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
    expect(ids).toContain("policy.enrollment.actions-sourced");
  });

  it("blocks an autonomous enrollment change (no-autonomous-change)", async () => {
    const taskId = "test-recon-autoapply-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ENROLLMENT_RECONCILIATION_REQUEST,
                determination: {
                  requestRef: "recon-001",
                  groupRef: "group-4821",
                  comparedFields: ["name", "coverageTier", "planId", "status"],
                  totalMembers: 2,
                  actions: [
                    { memberId: "M3", action: "enroll" },
                    { memberId: "M4", action: "terminate" }
                  ],
                  counts: { enroll: 1, terminate: 1, update: 0, noChange: 0 },
                  requiresBenefitsAdminReview: false,
                  autoApplied: true
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
    expect(ids).toContain("policy.enrollment.no-autonomous-change");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/enrollment-reconciliation/tasks", {
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
      new Request("http://localhost/api/agents/enrollment-reconciliation/tasks", {
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
