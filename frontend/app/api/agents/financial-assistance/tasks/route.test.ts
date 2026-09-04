import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/financial-assistance/tasks", {
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

const FULL_CHARITY_REQUEST = {
  patientRef: "finassist-patient-001",
  householdSize: 3,
  annualIncome: 30000,
  fplYear: 2025,
  applicationComplete: true,
  ecaRequested: false
};

const NOT_ELIGIBLE_REQUEST = {
  patientRef: "finassist-patient-004",
  householdSize: 1,
  annualIncome: 70000,
  fplYear: 2025,
  applicationComplete: true,
  ecaRequested: false
};

describe("POST /api/agents/financial-assistance/tasks", () => {
  it("grants full charity → completed, with a parented trace", async () => {
    const taskId = "test-finassist-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: FULL_CHARITY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.assistanceTier).toBe("full-charity");
    expect(body.result.metadata.agentFabric.discountPct).toBe(100);
    expect(body.result.metadata.agentFabric.ecaGatedOnScreening).toBe(true);
    expect(body.result.metadata.agentFabric.finAssistScheduleCited).toBe(true);
    expect(body.result.metadata.agentFabric.finAssistHumanReviewed).toBe(true);

    const data = dataPart(body).data as {
      result: { determination: { assistanceTier: string; tierId: string } };
    };
    expect(data.result.determination.assistanceTier).toBe("full-charity");
    expect(data.result.determination.tierId).toBe("fap.tier.full-charity");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("finassist.receive-application");
    expect(ops).toContain("finassist.evaluate");
    expect(ops).toContain("finassist.recommend");
    expect(ops).toContain("finassist.log-audit");
    const evalSpan = spans.find((s) => s.operation === "finassist.evaluate");
    expect(evalSpan?.agentId).toBe("financial-assistance-agent");
    expect(evalSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("returns a not-eligible denial requiring human review (a completed allow)", async () => {
    const taskId = "test-finassist-denial-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: NOT_ELIGIBLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.assistanceTier).toBe("not-eligible");
    expect(body.result.metadata.agentFabric.requiresHumanReview).toBe(true);
  });

  it("blocks a collection action asserted before screening is complete (no-eca-before-screening)", async () => {
    const taskId = "test-finassist-eca-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: NOT_ELIGIBLE_REQUEST,
                determination: {
                  patientRef: "finassist-patient-004",
                  tierId: "fap.tier.not-eligible",
                  assistanceTier: "not-eligible",
                  screeningComplete: false,
                  ecaAllowed: true,
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
    expect(ids).toContain("policy.finassist.no-eca-before-screening");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "finassist.evaluate.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "finassist.recommend")).toBe(false);
  });

  it("blocks an ad-hoc eligibility decision with no cited FAP tier (fap-schedule-sourced)", async () => {
    const taskId = "test-finassist-notier-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: FULL_CHARITY_REQUEST,
                determination: {
                  patientRef: "finassist-patient-001",
                  tierId: "fap.tier.we-just-decided",
                  assistanceTier: "full-charity",
                  screeningComplete: true,
                  ecaAllowed: false,
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
    expect(ids).toContain("policy.finassist.fap-schedule-sourced");
  });

  it("blocks an autonomous denial not gated on human review (no-autonomous-denial)", async () => {
    const taskId = "test-finassist-autonomous-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: NOT_ELIGIBLE_REQUEST,
                determination: {
                  patientRef: "finassist-patient-004",
                  tierId: "fap.tier.not-eligible",
                  assistanceTier: "not-eligible",
                  screeningComplete: true,
                  ecaAllowed: false,
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
    expect(ids).toContain("policy.finassist.no-autonomous-denial");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/financial-assistance/tasks", {
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
      new Request("http://localhost/api/agents/financial-assistance/tasks", {
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
