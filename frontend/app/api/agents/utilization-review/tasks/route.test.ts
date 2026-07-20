import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_UR_APPROVE,
  DEMO_UR_NON_COVERED,
  DEMO_UR_P2P,
  DEMO_UR_PEND
} from "../../../../../lib/utilization-review";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/utilization-review/tasks", {
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

describe("POST /api/agents/utilization-review/tasks", () => {
  it("approves-meets-criteria for a full-evidence case and records a parented trace", async () => {
    const taskId = "test-ur-approve-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_UR_APPROVE } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.urDecision).toBe("approves-meets-criteria");
    expect(body.result.metadata.agentFabric.slaWindowHours).toBe(72);
    expect(body.result.metadata.agentFabric.criteriaTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.denialRequiresClinicianCosign).toBe(true);
    expect(body.result.metadata.agentFabric.slaTracesToCatalog).toBe(true);
  });

  it("pends missing-criterion case for clinical reviewer with SLA deadline", async () => {
    const taskId = "test-ur-pend-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_UR_PEND } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.urDecision).toBe("pend-for-clinical-review");
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.UR-200");
    expect(body.result.metadata.agentFabric.routedTo).toBe("clinical-reviewer-queue");
    expect(body.result.metadata.agentFabric.requiresClinicianCosign).toBe(true);
    expect(typeof body.result.metadata.agentFabric.slaDeadline).toBe("string");
  });

  it("escalates to peer-to-peer when provider requests it and partial met", async () => {
    const taskId = "test-ur-p2p-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_UR_P2P } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.urDecision).toBe("require-peer-to-peer");
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.UR-201");
    expect(body.result.metadata.agentFabric.slaWindowHours).toBe(24);
  });

  it("blocks a non-covered service at first pass", async () => {
    const taskId = "test-ur-noncovered-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_UR_NON_COVERED } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.urDecision).toBe("blocked-non-covered");
    expect(body.result.metadata.agentFabric.routedTo).toBe("blocked-non-covered-appeal");

    const data = dataPart(body).data as {
      result: { decision: { decision: string } };
    };
    expect(data.result.decision.decision).toBe("blocked-non-covered");
  });

  it("blocks a decision with an off-catalog service (criteria-catalog-sourced)", async () => {
    const taskId = "test-ur-offcat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_UR_APPROVE,
                decisionOverride: {
                  requestRef: DEMO_UR_APPROVE.requestRef,
                  memberRef: DEMO_UR_APPROVE.memberRef,
                  serviceTypeId: "service.made-up",
                  serviceTypeLabel: "Fake",
                  urgency: "standard",
                  asOfDate: DEMO_UR_APPROVE.asOfDate,
                  decision: "approves-meets-criteria",
                  appliedRules: [
                    {
                      ruleId: "rule.all-required-met",
                      ruleLabel: "Standard",
                      reasonCode: "reason.UR-100",
                      reasonLabel: "Standard",
                      detail: "override"
                    }
                  ],
                  criteriaMet: [],
                  criteriaMissing: [],
                  primaryReasonCode: "reason.UR-100",
                  primaryReasonLabel: "Standard",
                  routedTo: "auto-approve",
                  slaDeadline: "2026-07-08T14:00:00.000Z",
                  slaWindowHours: 72,
                  requiresClinicianCosign: false,
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
    expect(violationIds).toContain("policy.ur.criteria-catalog-sourced");
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "utilization-review.evaluate.blocked")).toBe(true);
  });

  it("blocks an autonomously-cosigned pend (no-autonomous-denial)", async () => {
    const taskId = "test-ur-autocosign-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_UR_PEND,
                decisionOverride: {
                  requestRef: DEMO_UR_PEND.requestRef,
                  memberRef: DEMO_UR_PEND.memberRef,
                  serviceTypeId: DEMO_UR_PEND.serviceTypeId,
                  serviceTypeLabel: "Hysterectomy",
                  urgency: "standard",
                  asOfDate: DEMO_UR_PEND.asOfDate,
                  decision: "pend-for-clinical-review",
                  appliedRules: [
                    {
                      ruleId: "rule.missing-required-criterion",
                      ruleLabel: "Missing",
                      reasonCode: "reason.UR-200",
                      reasonLabel: "Missing",
                      detail: "override"
                    }
                  ],
                  criteriaMet: ["criterion.hyst.bleed-pattern-documented"],
                  criteriaMissing: ["criterion.hyst.first-line-failed"],
                  primaryReasonCode: "reason.UR-200",
                  primaryReasonLabel: "Missing",
                  routedTo: "clinical-reviewer-queue",
                  slaDeadline: "2026-07-08T14:00:00.000Z",
                  slaWindowHours: 72,
                  requiresClinicianCosign: false,
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
    expect(violationIds).toContain("policy.ur.no-autonomous-denial");
  });

  it("blocks a silently-extended SLA deadline (sla-integrity)", async () => {
    const taskId = "test-ur-sla-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_UR_PEND,
                decisionOverride: {
                  requestRef: DEMO_UR_PEND.requestRef,
                  memberRef: DEMO_UR_PEND.memberRef,
                  serviceTypeId: DEMO_UR_PEND.serviceTypeId,
                  serviceTypeLabel: "Hysterectomy",
                  urgency: "standard",
                  asOfDate: DEMO_UR_PEND.asOfDate,
                  decision: "pend-for-clinical-review",
                  appliedRules: [
                    {
                      ruleId: "rule.missing-required-criterion",
                      ruleLabel: "Missing",
                      reasonCode: "reason.UR-200",
                      reasonLabel: "Missing",
                      detail: "override"
                    }
                  ],
                  criteriaMet: ["criterion.hyst.bleed-pattern-documented"],
                  criteriaMissing: ["criterion.hyst.first-line-failed"],
                  primaryReasonCode: "reason.UR-200",
                  primaryReasonLabel: "Missing",
                  routedTo: "clinical-reviewer-queue",
                  slaDeadline: "2027-01-01T00:00:00.000Z", // silently extended past window
                  slaWindowHours: 168 as unknown as number,
                  requiresClinicianCosign: true,
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
    expect(violationIds).toContain("policy.ur.sla-integrity");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/utilization-review/tasks", {
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
      new Request("http://localhost/api/agents/utilization-review/tasks", {
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
