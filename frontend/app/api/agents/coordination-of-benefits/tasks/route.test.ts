import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/coordination-of-benefits/tasks", {
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

const SUBSCRIBER_REQUEST = {
  patientRef: "cob-patient-001",
  isDependentChild: false,
  coverages: [
    {
      coverageId: "coverage-own-ppo",
      payerName: "Acme Commercial PPO",
      planType: "commercial-group",
      role: "subscriber",
      activeEmployment: true,
      employerSize20Plus: true,
      coverageStartDate: "2020-01-01"
    },
    {
      coverageId: "coverage-spouse-hmo",
      payerName: "Beacon Spouse HMO",
      planType: "commercial-group",
      role: "dependent",
      activeEmployment: true,
      employerSize20Plus: true,
      coverageStartDate: "2019-06-01"
    }
  ],
  atTime: "2026-03-01T00:00:00Z"
};

const DECREE_REQUEST = {
  patientRef: "cob-patient-003",
  isDependentChild: true,
  custodyDecreePrimaryCoverageId: "coverage-dad-hmo",
  coverages: [
    {
      coverageId: "coverage-mom-ppo",
      payerName: "Acme Mom PPO",
      planType: "commercial-group",
      role: "dependent",
      activeEmployment: true,
      subscriberBirthday: "03-14"
    },
    {
      coverageId: "coverage-dad-hmo",
      payerName: "Beacon Dad HMO",
      planType: "commercial-group",
      role: "dependent",
      activeEmployment: true,
      subscriberBirthday: "06-20"
    }
  ],
  atTime: "2026-03-01T00:00:00Z"
};

describe("POST /api/agents/coordination-of-benefits/tasks", () => {
  it("orders a subscriber plan before a dependent plan → completed, with a parented trace", async () => {
    const taskId = "test-cob-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: { role: "user", parts: [{ type: "data", data: { request: SUBSCRIBER_REQUEST } }] }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.primaryCoverageId).toBe("coverage-own-ppo");
    expect(body.result.metadata.agentFabric.requiresHumanCosign).toBe(true);
    expect(body.result.metadata.agentFabric.cobDecreeHonored).toBe(true);
    expect(body.result.metadata.agentFabric.cobRuleCited).toBe(true);
    expect(body.result.metadata.agentFabric.cobHumanCosigned).toBe(true);

    const data = dataPart(body).data as {
      result: { determination: { orderedCoverages: { decidingRuleId: string }[] } };
    };
    expect(data.result.determination.orderedCoverages[0].decidingRuleId).toBe(
      "rule.cob.subscriber-before-dependent"
    );

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("cob.receive-coverages");
    expect(ops).toContain("cob.order-benefits");
    expect(ops).toContain("cob.recommend");
    expect(ops).toContain("cob.log-audit");
    const order = spans.find((s) => s.operation === "cob.order-benefits");
    expect(order?.agentId).toBe("coordination-of-benefits-agent");
    expect(order?.attributes?.phiAccessed).toBe(true);
  });

  it("lets a custody decree override the birthday rule (a completed allow)", async () => {
    const taskId = "test-cob-decree-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: { role: "user", parts: [{ type: "data", data: { request: DECREE_REQUEST } }] }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.primaryCoverageId).toBe("coverage-dad-hmo");
    expect(body.result.metadata.agentFabric.custodyDecreeApplied).toBe(true);
  });

  it("blocks an ordering that ignores an active custody decree (custody-decree-overrides-birthday)", async () => {
    const taskId = "test-cob-decree-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DECREE_REQUEST,
                determination: {
                  isDependentChild: true,
                  custodyDecreePrimaryCoverageId: "coverage-dad-hmo",
                  primaryCoverageId: "coverage-mom-ppo",
                  requiresHumanCosign: true,
                  orderedCoverages: [
                    { coverageId: "coverage-mom-ppo", rank: 1, decidingRuleId: "rule.cob.birthday-rule" },
                    { coverageId: "coverage-dad-hmo", rank: 2, decidingRuleId: "rule.cob.birthday-rule" }
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
    expect(ids).toContain("policy.cob.custody-decree-overrides-birthday");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "cob.order-benefits.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "cob.recommend")).toBe(false);
  });

  it("blocks an ad-hoc ordering with no cited COB rule (order-of-benefits-rule-sourced)", async () => {
    const taskId = "test-cob-norule-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: SUBSCRIBER_REQUEST,
                determination: {
                  isDependentChild: false,
                  primaryCoverageId: "coverage-own-ppo",
                  requiresHumanCosign: true,
                  orderedCoverages: [
                    { coverageId: "coverage-own-ppo", rank: 1, decidingRuleId: "rule.cob.we-just-picked" }
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
    expect(ids).toContain("policy.cob.order-of-benefits-rule-sourced");
  });

  it("blocks a determination that would autonomously adjudicate (no-autonomous-adjudication)", async () => {
    const taskId = "test-cob-autonomous-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: SUBSCRIBER_REQUEST,
                determination: {
                  isDependentChild: false,
                  primaryCoverageId: "coverage-own-ppo",
                  requiresHumanCosign: false,
                  orderedCoverages: [
                    { coverageId: "coverage-own-ppo", rank: 1, decidingRuleId: "rule.cob.subscriber-before-dependent" }
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
    expect(ids).toContain("policy.cob.no-autonomous-adjudication");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/coordination-of-benefits/tasks", {
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
      new Request("http://localhost/api/agents/coordination-of-benefits/tasks", {
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
