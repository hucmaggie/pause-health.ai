import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_AE_DEATH_LIFE_THREATENING,
  DEMO_AE_MEDWATCH_DRUG,
  DEMO_AE_NON_SERIOUS,
  DEMO_AE_UNVERIFIED_REPORTER,
  DEMO_AE_VAERS_VACCINE
} from "../../../../../lib/adverse-event-reporting";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/adverse-event-reporting/tasks", {
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

describe("POST /api/agents/adverse-event-reporting/tasks", () => {
  it("drafts a MedWatch report for a serious drug ADR", async () => {
    const taskId = "test-ae-medwatch-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AE_MEDWATCH_DRUG } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.adverseEventDecision).toBe("draft-medwatch");
    expect(body.result.metadata.agentFabric.seriousnessTierId).toBe("seriousness.serious");
    expect(body.result.metadata.agentFabric.eventsTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.submissionRequiresRegulatoryTeamCosign).toBe(true);
    expect(body.result.metadata.agentFabric.reporterIdentityVerified).toBe(true);
  });

  it("drafts a VAERS report for a vaccine reaction", async () => {
    const taskId = "test-ae-vaers-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AE_VAERS_VACCINE } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.adverseEventDecision).toBe("draft-vaers");
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.AE-101");
    expect(body.result.metadata.agentFabric.routedTo).toBe("regulatory-team-vaers-queue");
  });

  it("computes life-threatening seriousness on the decision", async () => {
    const taskId = "test-ae-lifethreat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AE_DEATH_LIFE_THREATENING } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.seriousnessTierId).toBe(
      "seriousness.life-threatening"
    );
  });

  it("drafts MedWatch even for non-serious cases (voluntary 3500)", async () => {
    const taskId = "test-ae-nonserious-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AE_NON_SERIOUS } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.adverseEventDecision).toBe("draft-medwatch");
    expect(body.result.metadata.agentFabric.seriousnessTierId).toBe("seriousness.non-serious");

    const data = dataPart(body).data as {
      result: { decision: { decision: string } };
    };
    expect(data.result.decision.decision).toBe("draft-medwatch");
  });

  it("blocks an unverified reporter and records a parented trace", async () => {
    const taskId = "test-ae-unverified-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AE_UNVERIFIED_REPORTER } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.adverseEventDecision).toBe(
      "blocked-reporter-unverified"
    );
    expect(body.result.metadata.agentFabric.routedTo).toBe("blocked-hold");
  });

  it("blocks a decision claiming an off-catalog event (event-catalog-sourced)", async () => {
    const taskId = "test-ae-offcat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_AE_MEDWATCH_DRUG,
                decisionOverride: {
                  requestRef: DEMO_AE_MEDWATCH_DRUG.requestRef,
                  patientRef: DEMO_AE_MEDWATCH_DRUG.patientRef,
                  eventTypeId: "event.made-up",
                  eventTypeLabel: "Fake",
                  seriousnessTierId: "seriousness.serious",
                  seriousnessTierLabel: "Serious",
                  onsetDate: DEMO_AE_MEDWATCH_DRUG.onsetDate,
                  reportedDate: DEMO_AE_MEDWATCH_DRUG.reportedDate,
                  asOfDate: DEMO_AE_MEDWATCH_DRUG.asOfDate,
                  reporterType: "clinician",
                  reporterIdentityVerified: true,
                  decision: "draft-medwatch",
                  appliedRules: [
                    {
                      ruleId: "rule.medwatch-eligible",
                      ruleLabel: "Ok",
                      reasonCode: "reason.AE-100",
                      reasonLabel: "Ok",
                      detail: "override"
                    }
                  ],
                  primaryReasonCode: "reason.AE-100",
                  primaryReasonLabel: "Ok",
                  routedTo: "regulatory-team-medwatch-queue",
                  requiresRegulatoryTeamCosign: true,
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
    expect(violationIds).toContain("policy.adverse-event.event-catalog-sourced");
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(
      spans.some((s) => s.operation === "adverse-event-reporting.evaluate.blocked")
    ).toBe(true);
  });

  it("blocks an autonomously-cosigned draft (no-autonomous-submission)", async () => {
    const taskId = "test-ae-autocosign-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_AE_MEDWATCH_DRUG,
                decisionOverride: {
                  requestRef: DEMO_AE_MEDWATCH_DRUG.requestRef,
                  patientRef: DEMO_AE_MEDWATCH_DRUG.patientRef,
                  eventTypeId: DEMO_AE_MEDWATCH_DRUG.eventTypeId,
                  eventTypeLabel: "Drug ADR",
                  seriousnessTierId: "seriousness.serious",
                  seriousnessTierLabel: "Serious",
                  onsetDate: DEMO_AE_MEDWATCH_DRUG.onsetDate,
                  reportedDate: DEMO_AE_MEDWATCH_DRUG.reportedDate,
                  asOfDate: DEMO_AE_MEDWATCH_DRUG.asOfDate,
                  reporterType: "clinician",
                  reporterIdentityVerified: true,
                  decision: "draft-medwatch",
                  appliedRules: [
                    {
                      ruleId: "rule.medwatch-eligible",
                      ruleLabel: "Ok",
                      reasonCode: "reason.AE-100",
                      reasonLabel: "Ok",
                      detail: "override"
                    }
                  ],
                  primaryReasonCode: "reason.AE-100",
                  primaryReasonLabel: "Ok",
                  routedTo: "regulatory-team-medwatch-queue",
                  requiresRegulatoryTeamCosign: false,
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
    expect(violationIds).toContain("policy.adverse-event.no-autonomous-submission");
  });

  it("blocks a draft with unverified reporter claim (reporter-verified)", async () => {
    const taskId = "test-ae-repunver-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_AE_MEDWATCH_DRUG,
                decisionOverride: {
                  requestRef: DEMO_AE_MEDWATCH_DRUG.requestRef,
                  patientRef: DEMO_AE_MEDWATCH_DRUG.patientRef,
                  eventTypeId: DEMO_AE_MEDWATCH_DRUG.eventTypeId,
                  eventTypeLabel: "Drug ADR",
                  seriousnessTierId: "seriousness.serious",
                  seriousnessTierLabel: "Serious",
                  onsetDate: DEMO_AE_MEDWATCH_DRUG.onsetDate,
                  reportedDate: DEMO_AE_MEDWATCH_DRUG.reportedDate,
                  asOfDate: DEMO_AE_MEDWATCH_DRUG.asOfDate,
                  reporterType: "consumer",
                  reporterIdentityVerified: false, // caller lies
                  decision: "draft-medwatch",
                  appliedRules: [
                    {
                      ruleId: "rule.medwatch-eligible",
                      ruleLabel: "Ok",
                      reasonCode: "reason.AE-100",
                      reasonLabel: "Ok",
                      detail: "override"
                    }
                  ],
                  primaryReasonCode: "reason.AE-100",
                  primaryReasonLabel: "Ok",
                  routedTo: "regulatory-team-medwatch-queue",
                  requiresRegulatoryTeamCosign: true,
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
    expect(violationIds).toContain("policy.adverse-event.reporter-verified");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/adverse-event-reporting/tasks", {
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
      new Request("http://localhost/api/agents/adverse-event-reporting/tasks", {
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
