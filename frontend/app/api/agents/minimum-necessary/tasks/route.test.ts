import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/minimum-necessary/tasks", {
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

const PAYMENT_REQUEST = {
  requestRef: "mn-request-001",
  requestorRole: "billing-specialist",
  purposeId: "purpose.payment",
  recordScope: "single-patient",
  requestedFields: [
    { name: "patient.demographics", category: "demographics" },
    { name: "patient.insurance", category: "insurance" },
    { name: "claim.procedures", category: "procedures" },
    { name: "encounter.clinicalNote", category: "clinical-notes" }
  ]
};

describe("POST /api/agents/minimum-necessary/tasks", () => {
  it("narrows an over-scope payment request → completed, with a parented trace", async () => {
    const taskId = "test-mn-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: PAYMENT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.releasedCount).toBe(3);
    expect(body.result.metadata.agentFabric.withheldCount).toBe(1);
    expect(body.result.metadata.agentFabric.minimumNecessary).toBe(false);
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(true);
    expect(body.result.metadata.agentFabric.minNecPurposeSourced).toBe(true);
    expect(body.result.metadata.agentFabric.minNecScoped).toBe(true);
    expect(body.result.metadata.agentFabric.minNecNoAutonomousOverDisclosure).toBe(true);

    const data = dataPart(body).data as {
      result: { determination: { withheldCount: number } };
    };
    expect(data.result.determination.withheldCount).toBe(1);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("minnec.receive-request");
    expect(ops).toContain("minnec.scope");
    expect(ops).toContain("minnec.decide");
    expect(ops).toContain("minnec.log-audit");
    const scopeSpan = spans.find((s) => s.operation === "minnec.scope");
    expect(scopeSpan?.agentId).toBe("minimum-necessary-agent");
    expect(scopeSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("releases everything for an exempt treatment purpose", async () => {
    const taskId = "test-mn-treatment-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: {
                  requestRef: "mn-request-003",
                  requestorRole: "treating-clinician",
                  purposeId: "purpose.treatment",
                  recordScope: "single-patient",
                  requestedFields: [
                    { name: "encounter.clinicalNote", category: "clinical-notes" },
                    { name: "labs.results", category: "lab-results" }
                  ]
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.exempt).toBe(true);
    expect(body.result.metadata.agentFabric.withheldCount).toBe(0);
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(false);
  });

  it("blocks an un-sourced purpose (purpose-of-use-sourced)", async () => {
    const taskId = "test-mn-nopurpose-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: PAYMENT_REQUEST,
                determination: {
                  requestRef: "mn-request-001",
                  purposeId: "purpose.we-made-up",
                  fieldDecisions: [
                    { name: "patient.ssn", category: "ssn", decision: "release" }
                  ],
                  minimumNecessary: true,
                  bulk: false,
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
    expect(ids).toContain("policy.minnec.purpose-of-use-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "minnec.scope.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "minnec.decide")).toBe(false);
  });

  it("blocks an out-of-scope released field (minimum-necessary-scoped)", async () => {
    const taskId = "test-mn-overscope-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: PAYMENT_REQUEST,
                determination: {
                  requestRef: "mn-request-001",
                  purposeId: "purpose.payment",
                  fieldDecisions: [
                    { name: "encounter.psychNote", category: "psychotherapy-notes", decision: "release" }
                  ],
                  minimumNecessary: true,
                  bulk: false,
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
    expect(ids).toContain("policy.minnec.minimum-necessary-scoped");
  });

  it("blocks an over-scope disclosure auto-approved without review (no-autonomous-over-disclosure)", async () => {
    const taskId = "test-mn-autonomous-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: PAYMENT_REQUEST,
                determination: {
                  requestRef: "mn-request-001",
                  purposeId: "purpose.payment",
                  fieldDecisions: [
                    { name: "patient.demographics", category: "demographics", decision: "release" }
                  ],
                  minimumNecessary: false,
                  bulk: false,
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
    expect(ids).toContain("policy.minnec.no-autonomous-over-disclosure");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/minimum-necessary/tasks", {
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
      new Request("http://localhost/api/agents/minimum-necessary/tasks", {
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
