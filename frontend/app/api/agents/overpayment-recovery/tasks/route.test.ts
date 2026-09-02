import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/overpayment-recovery/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

function dataPart(body: {
  result: { artifacts: { parts: { type: string; data?: unknown }[] }[] };
}) {
  return body.result.artifacts[0].parts.find(
    (p: { type: string }) => p.type === "data"
  ) as { type: "data"; data: Record<string, unknown> };
}

const RECOVERABLE_REQUEST = {
  claimId: "recovery-claim-001",
  memberRef: "recovery-member-001",
  providerRef: "recovery-provider-001",
  paidAmount: 1200,
  correctAmount: 600,
  reasonId: "reason.recovery.duplicate-payment",
  paidDate: "2025-10-01",
  asOfDate: "2026-03-01T00:00:00Z"
};

const PAST_WINDOW_REQUEST = {
  claimId: "recovery-claim-003",
  memberRef: "recovery-member-003",
  providerRef: "recovery-provider-003",
  paidAmount: 800,
  correctAmount: 0,
  reasonId: "reason.recovery.retroactive-termination",
  paidDate: "2023-01-01",
  asOfDate: "2026-03-01T00:00:00Z"
};

describe("POST /api/agents/overpayment-recovery/tasks", () => {
  it("evaluates a recoverable overpayment → completed, with a parented trace", async () => {
    const taskId = "test-recovery-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: RECOVERABLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.overpaymentAmount).toBe(600);
    expect(body.result.metadata.agentFabric.recoverable).toBe("recoverable");
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(true);
    expect(body.result.metadata.agentFabric.recoveryWithinLookback).toBe(true);
    expect(body.result.metadata.agentFabric.recoveryReasonCited).toBe(true);
    expect(body.result.metadata.agentFabric.recoveryClawbackHumanReviewed).toBe(true);

    const data = dataPart(body).data as {
      result: { determination: { recoverable: string; recoveryReasonId: string } };
    };
    expect(data.result.determination.recoverable).toBe("recoverable");
    expect(data.result.determination.recoveryReasonId).toBe(
      "reason.recovery.duplicate-payment"
    );

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("recovery.receive-claim");
    expect(ops).toContain("recovery.evaluate");
    expect(ops).toContain("recovery.recommend");
    expect(ops).toContain("recovery.log-audit");
    const evalSpan = spans.find((s) => s.operation === "recovery.evaluate");
    expect(evalSpan?.agentId).toBe("overpayment-recovery-agent");
    expect(evalSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("classifies an overpayment past its lookback window as not recoverable (a completed allow)", async () => {
    const taskId = "test-recovery-pastwindow-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: PAST_WINDOW_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.recoverable).toBe(
      "not-recoverable-within-window"
    );
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(false);
  });

  it("blocks a clawback asserted past the statutory lookback window (within-lookback-window)", async () => {
    const taskId = "test-recovery-window-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: PAST_WINDOW_REQUEST,
                determination: {
                  claimId: "recovery-claim-003",
                  recoveryReasonId: "reason.recovery.retroactive-termination",
                  overpaymentAmount: 800,
                  recoverable: "recoverable",
                  withinLookbackWindow: false,
                  requiresHumanReview: true
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
    expect(ids).toContain("policy.recovery.within-lookback-window");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "recovery.evaluate.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "recovery.recommend")).toBe(false);
  });

  it("blocks an ad-hoc recovery with no cited reason (reason-catalog-sourced)", async () => {
    const taskId = "test-recovery-noreason-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: RECOVERABLE_REQUEST,
                determination: {
                  claimId: "recovery-claim-001",
                  recoveryReasonId: "reason.recovery.we-just-decided",
                  overpaymentAmount: 600,
                  recoverable: "recoverable",
                  withinLookbackWindow: true,
                  requiresHumanReview: true
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
    expect(ids).toContain("policy.recovery.reason-catalog-sourced");
  });

  it("blocks an autonomous clawback not gated on human review (no-autonomous-clawback)", async () => {
    const taskId = "test-recovery-autonomous-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: RECOVERABLE_REQUEST,
                determination: {
                  claimId: "recovery-claim-001",
                  recoveryReasonId: "reason.recovery.duplicate-payment",
                  overpaymentAmount: 600,
                  recoverable: "recoverable",
                  withinLookbackWindow: true,
                  requiresHumanReview: false
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
    expect(ids).toContain("policy.recovery.no-autonomous-clawback");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/overpayment-recovery/tasks", {
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
      new Request("http://localhost/api/agents/overpayment-recovery/tasks", {
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
