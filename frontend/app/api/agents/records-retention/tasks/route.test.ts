import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/records-retention/tasks", {
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

const RETAIN_RECORD = {
  recordId: "retention-record-001",
  patientRef: "retention-patient-001",
  recordType: "clinical-record",
  createdAt: "2024-01-10",
  lastTouchedAt: "2025-06-15",
  atTime: "2026-03-01T00:00:00Z"
};

const PURGE_ELIGIBLE_RECORD = {
  recordId: "retention-record-002",
  patientRef: "retention-patient-002",
  recordType: "billing-claim",
  createdAt: "2015-02-01",
  lastTouchedAt: "2016-03-01",
  atTime: "2026-03-01T00:00:00Z"
};

const LEGAL_HOLD_RECORD = {
  recordId: "retention-record-003",
  patientRef: "retention-patient-003",
  recordType: "clinical-record",
  createdAt: "2010-01-01",
  lastTouchedAt: "2011-01-01",
  legalHold: { active: true, holdId: "hold-litigation-001" },
  atTime: "2026-03-01T00:00:00Z"
};

describe("POST /api/agents/records-retention/tasks", () => {
  it("retains a record within its retention period → completed, and records a parented trace", async () => {
    const taskId = "test-retention-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { record: RETAIN_RECORD } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.recommendation).toBe("retain");
    expect(body.result.metadata.agentFabric.retentionRuleId).toBe(
      "rule.retention.clinical-record-7y"
    );
    expect(body.result.metadata.agentFabric.underLegalHold).toBe(false);
    expect(body.result.metadata.agentFabric.requiresHumanApproval).toBe(false);
    expect(body.result.metadata.agentFabric.retentionRespectsLegalHold).toBe(true);
    expect(body.result.metadata.agentFabric.retentionRuleCited).toBe(true);
    expect(body.result.metadata.agentFabric.purgeHumanApproved).toBe(true);

    const data = dataPart(body).data as {
      result: { disposition: { recommendation: string; retentionExpiresAt: string } };
    };
    expect(data.result.disposition.recommendation).toBe("retain");
    expect(data.result.disposition.retentionExpiresAt).toBe("2032-06-15T00:00:00.000Z");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("retention.receive-record");
    expect(ops).toContain("retention.evaluate");
    expect(ops).toContain("retention.recommend");
    expect(ops).toContain("retention.log-audit");
    const recommend = spans.find((s) => s.operation === "retention.recommend");
    expect(recommend?.agentId).toBe("records-retention-agent");
    expect(recommend?.attributes?.phiAccessed).toBe(true);
  });

  it("recommends eligible-for-purge past expiry but still COMPLETES (a recommendation, not a block)", async () => {
    const taskId = "test-retention-purge-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { record: PURGE_ELIGIBLE_RECORD } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    // An eligible-for-purge recommendation is NOT a governance block.
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.recommendation).toBe("eligible-for-purge");
    // A purge is only ever a recommendation requiring human approval.
    expect(body.result.metadata.agentFabric.requiresHumanApproval).toBe(true);
  });

  it("holds a past-expiry record under an active legal hold (the hold overrides the purge)", async () => {
    const taskId = "test-retention-hold-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { record: LEGAL_HOLD_RECORD } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.recommendation).toBe("hold");
    expect(body.result.metadata.agentFabric.underLegalHold).toBe(true);
  });

  it("blocks a purge asserted while under an active legal hold (legal-hold-overrides-purge)", async () => {
    const taskId = "test-retention-holdpurge-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                record: LEGAL_HOLD_RECORD,
                disposition: {
                  recommendation: "eligible-for-purge",
                  underLegalHold: true,
                  retentionRuleId: "rule.retention.clinical-record-7y",
                  requiresHumanApproval: true
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.retention.legal-hold-overrides-purge");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "retention.evaluate.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "retention.recommend")).toBe(false);
  });

  it("blocks an ad-hoc disposition with no cited retention schedule (schedule-sourced)", async () => {
    const taskId = "test-retention-adhoc-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                record: RETAIN_RECORD,
                disposition: {
                  recommendation: "retain",
                  underLegalHold: false,
                  retentionRuleId: "rule.retention.we-just-decided",
                  requiresHumanApproval: false
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.retention.schedule-sourced");
  });

  it("blocks an autonomous / unapproved purge (no-autonomous-purge)", async () => {
    const taskId = "test-retention-autopurge-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                record: PURGE_ELIGIBLE_RECORD,
                disposition: {
                  recommendation: "eligible-for-purge",
                  underLegalHold: false,
                  retentionRuleId: "rule.retention.billing-claim-7y",
                  requiresHumanApproval: false
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.retention.no-autonomous-purge");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/records-retention/tasks", {
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
      new Request("http://localhost/api/agents/records-retention/tasks", {
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
