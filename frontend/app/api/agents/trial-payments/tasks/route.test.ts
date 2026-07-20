import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_EXTRA_PROCEDURE,
  DEMO_MISSED_VISIT,
  DEMO_NO_CONSENT,
  DEMO_STANDARD_PAYMENT,
  DEMO_TRAVEL_OUT_OF_RANGE
} from "../../../../../lib/trial-payments";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/trial-payments/tasks", {
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

describe("POST /api/agents/trial-payments/tasks", () => {
  it("schedule-approves a standard visit and records a parented trace", async () => {
    const taskId = "test-tp-approved-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_STANDARD_PAYMENT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.trialPaymentDecision).toBe("schedule-approved");
    expect(body.result.metadata.agentFabric.stipendAmountCents).toBe(15000);
    expect(body.result.metadata.agentFabric.paymentsTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.deviationRequiresCoordinatorCosign).toBe(true);
    expect(body.result.metadata.agentFabric.paymentHasParticipantConsent).toBe(true);
  });

  it("pends missed-visit for study-coordinator review", async () => {
    const taskId = "test-tp-missed-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_MISSED_VISIT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.trialPaymentDecision).toBe(
      "pend-coordinator-review"
    );
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.TP-200");
    expect(body.result.metadata.agentFabric.requiresCoordinatorCosign).toBe(true);
  });

  it("pends travel-out-of-range for study-coordinator review", async () => {
    const taskId = "test-tp-travel-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_TRAVEL_OUT_OF_RANGE } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.trialPaymentDecision).toBe(
      "pend-coordinator-review"
    );
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.TP-201");
  });

  it("pends extra-procedure comp request", async () => {
    const taskId = "test-tp-extra-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_EXTRA_PROCEDURE } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.TP-202");
  });

  it("blocks-no-consent when consent is missing", async () => {
    const taskId = "test-tp-noconsent-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_NO_CONSENT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.trialPaymentDecision).toBe("blocked-no-consent");
    expect(body.result.metadata.agentFabric.stipendAmountCents).toBe(0);
    expect(body.result.metadata.agentFabric.routedTo).toBe("blocked-hold");

    const data = dataPart(body).data as {
      result: { decision: { stipendAmountCents: number; travelReimbursementCents: number } };
    };
    expect(data.result.decision.stipendAmountCents).toBe(0);
    expect(data.result.decision.travelReimbursementCents).toBe(0);
  });

  it("blocks a decision with an off-catalog trial (schedule-catalog-sourced)", async () => {
    const taskId = "test-tp-offcat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_STANDARD_PAYMENT,
                decisionOverride: {
                  requestRef: DEMO_STANDARD_PAYMENT.requestRef,
                  participantRef: DEMO_STANDARD_PAYMENT.participantRef,
                  trialId: "trial.made-up",
                  trialLabel: "Fake",
                  visitTypeId: "visit.treatment",
                  visitTypeLabel: "Treatment",
                  asOfDate: DEMO_STANDARD_PAYMENT.asOfDate,
                  decision: "schedule-approved",
                  stipendAmountCents: 15000,
                  travelReimbursementCents: 0,
                  appliedRules: [
                    {
                      ruleId: "rule.standard-visit-completed",
                      ruleLabel: "Standard",
                      reasonCode: "reason.TP-100",
                      reasonLabel: "Standard",
                      detail: "override"
                    }
                  ],
                  primaryReasonCode: "reason.TP-100",
                  primaryReasonLabel: "Standard",
                  routedTo: "schedule-auto-pay",
                  requiresCoordinatorCosign: false,
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
    expect(violationIds).toContain("policy.trial-payments.schedule-catalog-sourced");
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "trial-payments.evaluate.blocked")).toBe(true);
  });

  it("blocks an autonomously-cosigned deviation (no-autonomous-irb-deviation)", async () => {
    const taskId = "test-tp-autocosign-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_MISSED_VISIT,
                decisionOverride: {
                  requestRef: DEMO_MISSED_VISIT.requestRef,
                  participantRef: DEMO_MISSED_VISIT.participantRef,
                  trialId: DEMO_MISSED_VISIT.trialId,
                  trialLabel: "Fez",
                  visitTypeId: DEMO_MISSED_VISIT.visitTypeId,
                  visitTypeLabel: "Follow-up",
                  asOfDate: DEMO_MISSED_VISIT.asOfDate,
                  decision: "pend-coordinator-review",
                  stipendAmountCents: 10000,
                  travelReimbursementCents: 0,
                  appliedRules: [
                    {
                      ruleId: "rule.missed-visit-partial-comp",
                      ruleLabel: "Missed",
                      reasonCode: "reason.TP-200",
                      reasonLabel: "Missed",
                      detail: "override"
                    }
                  ],
                  primaryReasonCode: "reason.TP-200",
                  primaryReasonLabel: "Missed",
                  routedTo: "study-coordinator-review",
                  requiresCoordinatorCosign: false,
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
    expect(violationIds).toContain("policy.trial-payments.no-autonomous-irb-deviation");
  });

  it("blocks a schedule-approved without consent (participant-consented)", async () => {
    const taskId = "test-tp-noconsent-lied-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_NO_CONSENT,
                decisionOverride: {
                  requestRef: DEMO_NO_CONSENT.requestRef,
                  participantRef: DEMO_NO_CONSENT.participantRef,
                  trialId: DEMO_NO_CONSENT.trialId,
                  trialLabel: "Fez",
                  visitTypeId: DEMO_NO_CONSENT.visitTypeId,
                  visitTypeLabel: "Treatment",
                  asOfDate: DEMO_NO_CONSENT.asOfDate,
                  decision: "schedule-approved",
                  stipendAmountCents: 15000,
                  travelReimbursementCents: 840,
                  appliedRules: [
                    {
                      ruleId: "rule.standard-visit-completed",
                      ruleLabel: "Standard",
                      reasonCode: "reason.TP-100",
                      reasonLabel: "Standard",
                      detail: "override"
                    }
                  ],
                  primaryReasonCode: "reason.TP-100",
                  primaryReasonLabel: "Standard",
                  routedTo: "schedule-auto-pay",
                  requiresCoordinatorCosign: false,
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
    expect(violationIds).toContain("policy.trial-payments.participant-consented");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/trial-payments/tasks", {
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
      new Request("http://localhost/api/agents/trial-payments/tasks", {
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
