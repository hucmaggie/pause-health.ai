import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_LIST_RECONCILIATION_CHANGED_REQUEST,
  DEMO_LIST_RECONCILIATION_MATCH_REQUEST,
  DEMO_LIST_RECONCILIATION_REQUEST,
  evaluateListReconciliation
} from "../../../../../lib/list-reconciliation";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/list-reconciliation/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateListReconciliation(DEMO_LIST_RECONCILIATION_REQUEST);

describe("POST /api/agents/list-reconciliation/tasks", () => {
  it("changed list → completed, with a parented PHI trace", async () => {
    const taskId = "test-lr-changed-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_LIST_RECONCILIATION_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("changes-present");
    expect(body.result.metadata.agentFabric.lcsLength).toBe(3);
    expect(body.result.metadata.agentFabric.listDiffSourced).toBe(true);
    expect(body.result.metadata.agentFabric.listDiffLcsOptimal).toBe(true);
    expect(body.result.metadata.agentFabric.listDiffNoAutonomousUpdate).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("listdiff.receive-lists");
    expect(ops).toContain("listdiff.diff-lcs");
    expect(ops).toContain("listdiff.classify-disposition");
    expect(ops).toContain("listdiff.log-audit");
    const diffSpan = spans.find((s) => s.operation === "listdiff.diff-lcs");
    expect(diffSpan?.agentId).toBe("list-reconciliation-agent");
    expect(diffSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("identical lists → completed (lists-match)", async () => {
    const res = await POST(
      rpc({
        id: "test-lr-match-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_LIST_RECONCILIATION_MATCH_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("lists-match");
    expect(body.result.metadata.agentFabric.removedCount).toBe(0);
    expect(body.result.metadata.agentFabric.addedCount).toBe(0);
  });

  it("problem list with several changes → completed", async () => {
    const res = await POST(
      rpc({
        id: "test-lr-problem-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_LIST_RECONCILIATION_CHANGED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.lcsLength).toBe(2);
  });

  it("blocks a fabricated / reordered retained list (diff-sourced)", async () => {
    const taskId = "test-lr-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_LIST_RECONCILIATION_REQUEST,
                determination: { ...VALID_DETERMINATION, retained: ["metformin", "aspirin", "atorvastatin"] }
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
    expect(ids).toContain("policy.listdiff.diff-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "listdiff.diff-lcs.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "listdiff.log-audit")).toBe(false);
  });

  it("blocks a sub-optimal common subsequence (lcs-optimal)", async () => {
    const res = await POST(
      rpc({
        id: "test-lr-suboptimal-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_LIST_RECONCILIATION_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  retained: ["metformin", "aspirin"],
                  removed: ["lisinopril", "atorvastatin"],
                  added: ["atorvastatin", "estradiol"],
                  lcsLength: 2
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
    expect(ids).toContain("policy.listdiff.lcs-optimal");
  });

  it("blocks an autonomous update (no-autonomous-update)", async () => {
    const res = await POST(
      rpc({
        id: "test-lr-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_LIST_RECONCILIATION_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresClinicianReview: false,
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
    expect(ids).toContain("policy.listdiff.no-autonomous-update");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/list-reconciliation/tasks", {
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
      new Request("http://localhost/api/agents/list-reconciliation/tasks", {
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
