import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_INTERACTION_REQUEST,
  DEMO_NON_FORMULARY_REQUEST,
  DEMO_PREFERRED_REQUEST,
  DEMO_QUANTITY_LIMIT_REQUEST,
  DEMO_STEP_THERAPY_REQUEST
} from "../../../../../lib/formulary-review";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/formulary-review/tasks", {
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

describe("POST /api/agents/formulary-review/tasks", () => {
  it("preferred-approves a Tier 1 in-quantity request with no interactions", async () => {
    const taskId = "test-formulary-preferred-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_PREFERRED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.formularyDecision).toBe(
      "preferred-approved"
    );
    expect(body.result.metadata.agentFabric.rulesTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.stepTherapyIsHonored).toBe(true);
    expect(body.result.metadata.agentFabric.exceptionRequiresClinicianCosign).toBe(true);
  });

  it("pends step-therapy when no documented trial is on file", async () => {
    const taskId = "test-formulary-step-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_STEP_THERAPY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.formularyDecision).toBe("pend-step-therapy");
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.PF-200");
    expect(body.result.metadata.agentFabric.requiresClinicianCosign).toBe(true);
    // Step-therapy signal is trivially satisfied because the produced
    // decision is pend-step-therapy (agent isn't CLAIMING step therapy).
    expect(body.result.metadata.agentFabric.stepTherapyIsHonored).toBe(true);
  });

  it("pends quantity-limit when the requested amount exceeds the plan limit", async () => {
    const taskId = "test-formulary-quantity-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_QUANTITY_LIMIT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.formularyDecision).toBe("pend-quantity-limit");
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.PF-201");
    expect(body.result.metadata.agentFabric.routedTo).toBe("clinician-review");
  });

  it("pends drug-drug interaction; routes to pharmacist-review", async () => {
    const taskId = "test-formulary-interaction-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_INTERACTION_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.formularyDecision).toBe(
      "pend-interaction-review"
    );
    expect(body.result.metadata.agentFabric.routedTo).toBe("pharmacist-review");
  });

  it("pends non-formulary for a non-formulary-tier drug", async () => {
    const taskId = "test-formulary-nonform-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_NON_FORMULARY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.formularyDecision).toBe(
      "pend-non-formulary"
    );
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.PF-203");
    expect(body.result.metadata.agentFabric.requiresClinicianCosign).toBe(true);

    const data = dataPart(body).data as {
      result: {
        decision: { cosigned: boolean; requiresClinicianCosign: boolean };
      };
    };
    expect(data.result.decision.cosigned).toBe(false);
    expect(data.result.decision.requiresClinicianCosign).toBe(true);
  });

  it("blocks a decision with an off-catalog rule (formulary.catalog-sourced)", async () => {
    const taskId = "test-formulary-offcat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_PREFERRED_REQUEST,
                decisionOverride: {
                  requestRef: DEMO_PREFERRED_REQUEST.requestRef,
                  memberRef: DEMO_PREFERRED_REQUEST.memberRef,
                  asOfDate: DEMO_PREFERRED_REQUEST.asOfDate,
                  proposedDrugId: DEMO_PREFERRED_REQUEST.proposedDrugId,
                  proposedDrugLabel: "Estradiol",
                  tier: 1,
                  decision: "pend-non-formulary",
                  appliedRules: [
                    {
                      ruleId: "rule.made-up",
                      ruleLabel: "Fake rule",
                      reasonCode: "reason.PF-203",
                      reasonLabel: "Non-formulary",
                      detail: "fabricated"
                    }
                  ],
                  primaryReasonCode: "reason.PF-203",
                  primaryReasonLabel: "Non-formulary",
                  routedTo: "clinician-review",
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
    expect(violationIds).toContain("policy.formulary.catalog-sourced");
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "formulary.review.blocked")).toBe(true);
  });

  it("blocks an approval on undocumented step-therapy history (step-therapy-honored)", async () => {
    const taskId = "test-formulary-step-lied-001";
    const res = await POST(
      rpc({
        id: taskId,
        // Step-therapy demo (patch, only self-reported oral trial) but the
        // caller-asserted decision claims preferred-approved.
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_STEP_THERAPY_REQUEST,
                decisionOverride: {
                  requestRef: DEMO_STEP_THERAPY_REQUEST.requestRef,
                  memberRef: DEMO_STEP_THERAPY_REQUEST.memberRef,
                  asOfDate: DEMO_STEP_THERAPY_REQUEST.asOfDate,
                  proposedDrugId: DEMO_STEP_THERAPY_REQUEST.proposedDrugId,
                  proposedDrugLabel: "Estradiol patch",
                  tier: 2,
                  decision: "preferred-approved",
                  appliedRules: [],
                  primaryReasonCode: "reason.PF-100",
                  primaryReasonLabel: "Preferred approval",
                  routedTo: "auto-approved",
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
    expect(violationIds).toContain("policy.formulary.step-therapy-honored");
  });

  it("blocks an autonomously-cosigned override (no-autonomous-override)", async () => {
    const taskId = "test-formulary-autocosign-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_NON_FORMULARY_REQUEST,
                decisionOverride: {
                  requestRef: DEMO_NON_FORMULARY_REQUEST.requestRef,
                  memberRef: DEMO_NON_FORMULARY_REQUEST.memberRef,
                  asOfDate: DEMO_NON_FORMULARY_REQUEST.asOfDate,
                  proposedDrugId: DEMO_NON_FORMULARY_REQUEST.proposedDrugId,
                  proposedDrugLabel: "Fezolinetant",
                  tier: "non-formulary",
                  decision: "pend-non-formulary",
                  appliedRules: [
                    {
                      ruleId: "rule.non-formulary",
                      ruleLabel: "Non-formulary",
                      reasonCode: "reason.PF-203",
                      reasonLabel: "Non-formulary",
                      detail: "non-formulary"
                    }
                  ],
                  primaryReasonCode: "reason.PF-203",
                  primaryReasonLabel: "Non-formulary",
                  routedTo: "clinician-review",
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
    expect(violationIds).toContain("policy.formulary.no-autonomous-override");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/formulary-review/tasks", {
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
      new Request("http://localhost/api/agents/formulary-review/tasks", {
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
