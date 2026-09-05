import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_AUDIT_LOG_GAP_REQUEST,
  DEMO_AUDIT_LOG_REQUEST,
  DEMO_AUDIT_LOG_TAMPERED_REQUEST
} from "../../../../../lib/audit-log-integrity";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/audit-log-integrity/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/audit-log-integrity/tasks", () => {
  it("verifies an intact log → completed, with a parented trace", async () => {
    const taskId = "test-al-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AUDIT_LOG_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.verified).toBe(true);
    expect(body.result.metadata.agentFabric.brokenLinks).toBe(0);
    expect(body.result.metadata.agentFabric.sequenceGaps).toBe(0);
    expect(body.result.metadata.agentFabric.requiresForensicReview).toBe(false);
    expect(body.result.metadata.agentFabric.auditLogHashChainVerified).toBe(true);
    expect(body.result.metadata.agentFabric.auditLogSequenceComplete).toBe(true);
    expect(body.result.metadata.agentFabric.auditLogNoAutonomousRedaction).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("auditlog.receive-log");
    expect(ops).toContain("auditlog.verify");
    expect(ops).toContain("auditlog.attest");
    expect(ops).toContain("auditlog.log-audit");
    const verifySpan = spans.find((s) => s.operation === "auditlog.verify");
    expect(verifySpan?.agentId).toBe("audit-log-integrity-agent");
    expect(verifySpan?.attributes?.phiAccessed).toBe(true);
  });

  it("flags a tampered log for forensic review (still completed)", async () => {
    const taskId = "test-al-tampered-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AUDIT_LOG_TAMPERED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.verified).toBe(false);
    expect(body.result.metadata.agentFabric.brokenLinks).toBeGreaterThanOrEqual(1);
    expect(body.result.metadata.agentFabric.requiresForensicReview).toBe(true);
    // Honest output: not verified over a broken chain → the signal stays true.
    expect(body.result.metadata.agentFabric.auditLogHashChainVerified).toBe(true);
  });

  it("flags a deleted entry as a sequence gap (still completed)", async () => {
    const taskId = "test-al-gap-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AUDIT_LOG_GAP_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.verified).toBe(false);
    expect(body.result.metadata.agentFabric.sequenceGaps).toBeGreaterThanOrEqual(1);
  });

  it("blocks a verified label over a broken chain (hash-chain-verified)", async () => {
    const taskId = "test-al-break-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_AUDIT_LOG_REQUEST,
                determination: {
                  logRef: "audit-log-002",
                  verified: true,
                  hashChainIntact: false,
                  sequenceComplete: true,
                  repaired: false
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
    expect(ids).toContain("policy.auditlog.hash-chain-verified");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "auditlog.verify.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "auditlog.log-audit")).toBe(false);
  });

  it("blocks a verified label over a sequence gap (sequence-complete)", async () => {
    const taskId = "test-al-gap-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_AUDIT_LOG_REQUEST,
                determination: {
                  logRef: "audit-log-003",
                  verified: true,
                  hashChainIntact: true,
                  sequenceComplete: false,
                  repaired: false
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
    expect(ids).toContain("policy.auditlog.sequence-complete");
  });

  it("blocks an autonomous redaction / repair (no-autonomous-redaction)", async () => {
    const taskId = "test-al-repair-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_AUDIT_LOG_REQUEST,
                determination: {
                  logRef: "audit-log-001",
                  verified: false,
                  hashChainIntact: false,
                  sequenceComplete: true,
                  repaired: true
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
    expect(ids).toContain("policy.auditlog.no-autonomous-redaction");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/audit-log-integrity/tasks", {
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
      new Request("http://localhost/api/agents/audit-log-integrity/tasks", {
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
