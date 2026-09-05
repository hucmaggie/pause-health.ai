import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_SUBROGATION_COMMONFUND_REQUEST,
  DEMO_SUBROGATION_MADEWHOLE_REQUEST,
  DEMO_SUBROGATION_NONE_REQUEST,
  DEMO_SUBROGATION_REQUEST
} from "../../../../../lib/subrogation";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/subrogation/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/subrogation/tasks", () => {
  it("fully recovers what the plan paid → completed, with a parented trace", async () => {
    const taskId = "test-subro-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_SUBROGATION_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.eligible).toBe(true);
    expect(body.result.metadata.agentFabric.recoverableAmount).toBe(42000);
    expect(body.result.metadata.agentFabric.disposition).toBe("assert-lien-with-review");
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(true);
    expect(body.result.metadata.agentFabric.subrogationBasisSourced).toBe(true);
    expect(body.result.metadata.agentFabric.subrogationRecoverableWithinPaid).toBe(true);
    expect(body.result.metadata.agentFabric.subrogationNoAutonomousLien).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("subrogation.receive-case");
    expect(ops).toContain("subrogation.assess-eligibility");
    expect(ops).toContain("subrogation.compute-recoverable");
    expect(ops).toContain("subrogation.log-audit");
    const computeSpan = spans.find((s) => s.operation === "subrogation.compute-recoverable");
    expect(computeSpan?.agentId).toBe("subrogation-agent");
    expect(computeSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("reduces recovery by the common-fund attorney-fee share", async () => {
    const taskId = "test-subro-commonfund-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_SUBROGATION_COMMONFUND_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.recoverableAmount).toBe(20100);
  });

  it("bars recovery under the made-whole doctrine", async () => {
    const taskId = "test-subro-madewhole-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_SUBROGATION_MADEWHOLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.recoverableAmount).toBe(0);
    expect(body.result.metadata.agentFabric.disposition).toBe("notify-made-whole-bar");
  });

  it("finds no interest for a non-injury claim", async () => {
    const taskId = "test-subro-none-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_SUBROGATION_NONE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.eligible).toBe(false);
    expect(body.result.metadata.agentFabric.disposition).toBe("no-subrogation-interest");
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(false);
  });

  it("blocks an off-catalog basis (basis-sourced)", async () => {
    const taskId = "test-subro-offcatalog-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_SUBROGATION_REQUEST,
                determination: {
                  caseRef: "subro-case-001",
                  basisId: "basis.we-made-up",
                  eligible: true,
                  planPaidAmount: 42000,
                  settlementAmount: 150000,
                  recoverableAmount: 42000,
                  disposition: "assert-lien-with-review",
                  requiresHumanReview: true,
                  autoAssertedLien: false
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
    expect(ids).toContain("policy.subrogation.basis-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "subrogation.compute-recoverable.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "subrogation.log-audit")).toBe(false);
  });

  it("blocks a recoverable exceeding the plan's paid amount (recoverable-within-paid)", async () => {
    const taskId = "test-subro-over-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_SUBROGATION_REQUEST,
                determination: {
                  caseRef: "subro-case-001",
                  basisId: "basis.erisa-plan-reimbursement",
                  eligible: true,
                  planPaidAmount: 42000,
                  settlementAmount: 150000,
                  recoverableAmount: 60000,
                  disposition: "assert-lien-with-review",
                  requiresHumanReview: true,
                  autoAssertedLien: false
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
    expect(ids).toContain("policy.subrogation.recoverable-within-paid");
  });

  it("blocks an autonomously-asserted lien (no-autonomous-lien)", async () => {
    const taskId = "test-subro-lien-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_SUBROGATION_REQUEST,
                determination: {
                  caseRef: "subro-case-001",
                  basisId: "basis.erisa-plan-reimbursement",
                  eligible: true,
                  planPaidAmount: 42000,
                  settlementAmount: 150000,
                  recoverableAmount: 42000,
                  disposition: "assert-lien-with-review",
                  requiresHumanReview: false,
                  autoAssertedLien: true
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
    expect(ids).toContain("policy.subrogation.no-autonomous-lien");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/subrogation/tasks", {
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
      new Request("http://localhost/api/agents/subrogation/tasks", {
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
