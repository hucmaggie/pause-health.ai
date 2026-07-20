import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_CONTRACT_FFS,
  DEMO_CONTRACT_GOOD_STANDING,
  DEMO_CONTRACT_QUALITY_MISS,
  DEMO_CONTRACT_SPEND_DRIFT,
  DEMO_CONTRACT_TERM_CHANGE
} from "../../../../../lib/provider-contracting";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/provider-contracting/tasks", {
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

describe("POST /api/agents/provider-contracting/tasks", () => {
  it("in-good-standing for a VBC contract meeting quality + spend", async () => {
    const taskId = "test-pc-good-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONTRACT_GOOD_STANDING } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.contractingDecision).toBe("in-good-standing");
    expect(body.result.metadata.agentFabric.qualityGateMet).toBe(true);
    expect(body.result.metadata.agentFabric.contractsTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.contractChangeRequiresOwnerCosign).toBe(true);
    expect(body.result.metadata.agentFabric.benchmarksTraceToMethodology).toBe(true);
  });

  it("routes quality-miss to benchmark-drift-review", async () => {
    const taskId = "test-pc-qmiss-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONTRACT_QUALITY_MISS } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.contractingDecision).toBe("benchmark-drift-review");
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.PC-200");
    expect(body.result.metadata.agentFabric.routedTo).toBe("account-manager-drift-review");
  });

  it("routes spend-drift to benchmark-drift-review", async () => {
    const taskId = "test-pc-drift-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONTRACT_SPEND_DRIFT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.contractingDecision).toBe("benchmark-drift-review");
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.PC-201");
  });

  it("drafts a term change for account-owner cosign", async () => {
    const taskId = "test-pc-term-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONTRACT_TERM_CHANGE } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.contractingDecision).toBe("draft-term-change");
    expect(body.result.metadata.agentFabric.routedTo).toBe("account-owner-cosign");
    expect(body.result.metadata.agentFabric.requiresAccountOwnerCosign).toBe(true);
  });

  it("in-good-standing for a non-VBC FFS contract with no term change", async () => {
    const taskId = "test-pc-ffs-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONTRACT_FFS } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.contractingDecision).toBe("in-good-standing");

    const data = dataPart(body).data as {
      result: { decision: { qualityGateMet: boolean } };
    };
    expect(data.result.decision.qualityGateMet).toBe(true);
  });

  it("blocks a decision with an off-catalog contract type (contract-type-catalog-sourced)", async () => {
    const taskId = "test-pc-offcat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CONTRACT_GOOD_STANDING,
                decisionOverride: {
                  requestRef: DEMO_CONTRACT_GOOD_STANDING.requestRef,
                  providerRef: DEMO_CONTRACT_GOOD_STANDING.providerRef,
                  contractRef: DEMO_CONTRACT_GOOD_STANDING.contractRef,
                  contractTypeId: "contract-type.made-up",
                  contractTypeLabel: "Fake",
                  methodologyId: "methodology.ma-star-vbc-my2026",
                  methodologyLabel: "MA Star",
                  reportingPeriodStart: DEMO_CONTRACT_GOOD_STANDING.reportingPeriodStart,
                  reportingPeriodEnd: DEMO_CONTRACT_GOOD_STANDING.reportingPeriodEnd,
                  decision: "in-good-standing",
                  appliedRules: [],
                  qualityGateMet: true,
                  qualityMeasuresMetFraction: 0.9,
                  qualityGateThreshold: 0.75,
                  spendDriftFraction: 0.01,
                  spendDriftTolerance: 0.03,
                  benchmarkSpendCents: 100_00,
                  actualSpendCents: 100_00,
                  primaryReasonCode: "reason.PC-100",
                  primaryReasonLabel: "Good standing",
                  routedTo: "auto-continue",
                  requiresAccountOwnerCosign: false,
                  cosigned: false,
                  synthetic: true,
                  note: "override"
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
    expect(violationIds).toContain("policy.contracting.contract-type-catalog-sourced");
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "provider-contracting.evaluate.blocked")).toBe(true);
  });

  it("blocks an autonomously-cosigned term change (no-autonomous-term-change)", async () => {
    const taskId = "test-pc-autocosign-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CONTRACT_TERM_CHANGE,
                decisionOverride: {
                  requestRef: DEMO_CONTRACT_TERM_CHANGE.requestRef,
                  providerRef: DEMO_CONTRACT_TERM_CHANGE.providerRef,
                  contractRef: DEMO_CONTRACT_TERM_CHANGE.contractRef,
                  contractTypeId: DEMO_CONTRACT_TERM_CHANGE.contractTypeId,
                  contractTypeLabel: "MA VBC",
                  methodologyId: DEMO_CONTRACT_TERM_CHANGE.methodologyId,
                  methodologyLabel: "MA Star",
                  reportingPeriodStart: DEMO_CONTRACT_TERM_CHANGE.reportingPeriodStart,
                  reportingPeriodEnd: DEMO_CONTRACT_TERM_CHANGE.reportingPeriodEnd,
                  decision: "draft-term-change",
                  appliedRules: [
                    {
                      ruleId: "rule.term-change-requested",
                      ruleLabel: "Term change",
                      reasonCode: "reason.PC-300",
                      reasonLabel: "Term change",
                      detail: "override"
                    }
                  ],
                  qualityGateMet: true,
                  qualityMeasuresMetFraction: 0.8,
                  qualityGateThreshold: 0.75,
                  spendDriftFraction: -0.01,
                  spendDriftTolerance: 0.03,
                  benchmarkSpendCents: 100_00,
                  actualSpendCents: 99_00,
                  primaryReasonCode: "reason.PC-300",
                  primaryReasonLabel: "Term change",
                  routedTo: "account-owner-cosign",
                  requiresAccountOwnerCosign: false,
                  cosigned: true as unknown as false,
                  synthetic: true,
                  note: "override"
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
    expect(violationIds).toContain("policy.contracting.no-autonomous-term-change");
  });

  it("blocks an opaque / mismatched benchmark (benchmark-methodology-catalog-sourced)", async () => {
    const taskId = "test-pc-benchmark-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CONTRACT_GOOD_STANDING,
                decisionOverride: {
                  requestRef: DEMO_CONTRACT_GOOD_STANDING.requestRef,
                  providerRef: DEMO_CONTRACT_GOOD_STANDING.providerRef,
                  contractRef: DEMO_CONTRACT_GOOD_STANDING.contractRef,
                  contractTypeId: DEMO_CONTRACT_GOOD_STANDING.contractTypeId,
                  contractTypeLabel: "MA VBC",
                  methodologyId: DEMO_CONTRACT_GOOD_STANDING.methodologyId,
                  methodologyLabel: "MA Star",
                  reportingPeriodStart: DEMO_CONTRACT_GOOD_STANDING.reportingPeriodStart,
                  reportingPeriodEnd: DEMO_CONTRACT_GOOD_STANDING.reportingPeriodEnd,
                  decision: "in-good-standing",
                  appliedRules: [
                    {
                      ruleId: "rule.quality-and-spend-in-band",
                      ruleLabel: "Good standing",
                      reasonCode: "reason.PC-100",
                      reasonLabel: "Good standing",
                      detail: "override"
                    }
                  ],
                  qualityGateMet: true,
                  qualityMeasuresMetFraction: 0.5,
                  qualityGateThreshold: 0.5 as unknown as number, // catalog says 0.75
                  spendDriftFraction: 0.01,
                  spendDriftTolerance: 0.03,
                  benchmarkSpendCents: 100_00,
                  actualSpendCents: 100_00,
                  primaryReasonCode: "reason.PC-100",
                  primaryReasonLabel: "Good standing",
                  routedTo: "auto-continue",
                  requiresAccountOwnerCosign: false,
                  cosigned: false,
                  synthetic: true,
                  note: "override"
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
    expect(violationIds).toContain("policy.contracting.benchmark-methodology-catalog-sourced");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/provider-contracting/tasks", {
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
      new Request("http://localhost/api/agents/provider-contracting/tasks", {
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
