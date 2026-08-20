import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/break-the-glass/tasks", {
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

const EMERGENCY_REQUEST = {
  requesterRole: "emergency-physician",
  requesterId: "btg-requester-001",
  patientRef: "btg-patient-001",
  purpose: "emergency-treatment",
  emergency: true,
  justification: "Unresponsive patient in the ED; need allergies, meds, problems, vitals.",
  atTime: "2026-03-01T02:30:00Z"
};

const NON_EMERGENCY_REQUEST = {
  ...EMERGENCY_REQUEST,
  requesterRole: "on-call-clinician",
  patientRef: "btg-patient-002",
  emergency: false,
  justification: "Routine chart review ahead of a scheduled visit."
};

describe("POST /api/agents/break-the-glass/tasks", () => {
  it("grants a time-boxed, minimum-necessary access → completed, and records a parented trace", async () => {
    const taskId = "test-btg-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: EMERGENCY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.granted).toBe(true);
    expect(body.result.metadata.agentFabric.grantedFieldCount).toBe(4);
    expect(body.result.metadata.agentFabric.durationMinutes).toBe(60);
    expect(body.result.metadata.agentFabric.requiresPostAccessReview).toBe(true);
    expect(body.result.metadata.agentFabric.accessHasJustification).toBe(true);
    expect(body.result.metadata.agentFabric.accessIsMinimumNecessaryTimeBoxed).toBe(true);
    expect(body.result.metadata.agentFabric.accessLoggedForReview).toBe(true);

    const data = dataPart(body).data as {
      result: { decision: { granted: boolean; grantedScope: string[]; expiresAt: string } };
    };
    expect(data.result.decision.granted).toBe(true);
    expect(data.result.decision.grantedScope).toEqual([
      "allergies",
      "medications",
      "problems",
      "vitals"
    ]);
    expect(data.result.decision.expiresAt).toBe("2026-03-01T03:30:00.000Z");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("btg.receive-request");
    expect(ops).toContain("btg.evaluate");
    expect(ops).toContain("btg.grant-scoped");
    expect(ops).toContain("btg.log-audit");
    const grant = spans.find((s) => s.operation === "btg.grant-scoped");
    expect(grant?.agentId).toBe("break-the-glass-agent");
    expect(grant?.attributes?.phiAccessed).toBe(true);
  });

  it("DENIES a non-emergency request but still COMPLETES (safe, not a block)", async () => {
    const taskId = "test-btg-deny-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: NON_EMERGENCY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    // A deny is NOT a governance block.
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.granted).toBe(false);
  });

  it("blocks a grant asserted with no recorded justification (justification-required)", async () => {
    const taskId = "test-btg-nojust-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: EMERGENCY_REQUEST,
                grant: {
                  granted: true,
                  justificationRecorded: false,
                  grantedScope: ["allergies", "medications"],
                  expiresAt: "2026-03-01T03:30:00.000Z",
                  durationMinutes: 60,
                  auditEventId: "btg-audit-x",
                  requiresPostAccessReview: true
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
    expect(violationIds).toContain("policy.btg.justification-required");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "btg.evaluate.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "btg.grant-scoped")).toBe(false);
  });

  it("blocks a standing / full-record / non-expiring grant (minimum-necessary-time-boxed)", async () => {
    const taskId = "test-btg-standing-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: EMERGENCY_REQUEST,
                grant: {
                  granted: true,
                  justificationRecorded: true,
                  grantedScope: ["full-chart"],
                  expiresAt: undefined,
                  durationMinutes: undefined,
                  auditEventId: "btg-audit-x",
                  requiresPostAccessReview: true
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
    expect(violationIds).toContain("policy.btg.minimum-necessary-time-boxed");
  });

  it("blocks an un-audited / un-reviewed grant (mandatory-audit-review)", async () => {
    const taskId = "test-btg-unaudited-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: EMERGENCY_REQUEST,
                grant: {
                  granted: true,
                  justificationRecorded: true,
                  grantedScope: ["allergies", "medications"],
                  expiresAt: "2026-03-01T03:30:00.000Z",
                  durationMinutes: 60,
                  auditEventId: "",
                  requiresPostAccessReview: false
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
    expect(violationIds).toContain("policy.btg.mandatory-audit-review");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/break-the-glass/tasks", {
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
      new Request("http://localhost/api/agents/break-the-glass/tasks", {
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
