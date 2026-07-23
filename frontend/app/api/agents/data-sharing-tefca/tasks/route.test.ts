import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_DS_NON_TPO_CONSENTED,
  DEMO_DS_NON_TPO_NO_CONSENT,
  DEMO_DS_PATIENT_ACCESS,
  DEMO_DS_TPO_TREATMENT,
  DEMO_DS_UNVERIFIED_PARTICIPANT
} from "../../../../../lib/data-sharing-tefca";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/data-sharing-tefca/tasks", {
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

describe("POST /api/agents/data-sharing-tefca/tasks", () => {
  it("authorizes a TPO treatment release and records a parented trace", async () => {
    const taskId = "test-ds-tpo-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DS_TPO_TREATMENT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.dataSharingDecision).toBe("release-authorized");
    expect(body.result.metadata.agentFabric.isTpo).toBe(true);
    expect(body.result.metadata.agentFabric.purposesTraceToCatalog).toBe(true);
    expect(body.result.metadata.agentFabric.releaseHonorsNonTpoConsent).toBe(true);
    expect(body.result.metadata.agentFabric.participantIdentityVerified).toBe(true);
  });

  it("authorizes a non-TPO consented release (research)", async () => {
    const taskId = "test-ds-nontpo-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DS_NON_TPO_CONSENTED } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.dataSharingDecision).toBe("release-authorized");
    expect(body.result.metadata.agentFabric.isTpo).toBe(false);
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.DS-101");
  });

  it("blocks a non-TPO release without consent", async () => {
    const taskId = "test-ds-nontpo-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DS_NON_TPO_NO_CONSENT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.dataSharingDecision).toBe(
      "blocked-consent-required-non-tpo"
    );
    expect(body.result.metadata.agentFabric.routedTo).toBe("consent-capture");
  });

  it("blocks an unverified participant", async () => {
    const taskId = "test-ds-unv-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DS_UNVERIFIED_PARTICIPANT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.dataSharingDecision).toBe(
      "blocked-participant-unverified"
    );
    expect(body.result.metadata.agentFabric.routedTo).toBe("participant-registry-verification");
  });

  it("authorizes patient right of access when consent scope on file", async () => {
    const taskId = "test-ds-pat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DS_PATIENT_ACCESS } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.dataSharingDecision).toBe("release-authorized");

    const data = dataPart(body).data as { result: { decision: { isTpo: boolean } } };
    expect(data.result.decision.isTpo).toBe(false);
  });

  it("blocks a decision claiming an off-catalog purpose (purpose-catalog-sourced)", async () => {
    const taskId = "test-ds-offcat-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DS_TPO_TREATMENT,
                decisionOverride: {
                  requestRef: DEMO_DS_TPO_TREATMENT.requestRef,
                  patientRef: DEMO_DS_TPO_TREATMENT.patientRef,
                  requesterRef: DEMO_DS_TPO_TREATMENT.requesterRef,
                  networkId: DEMO_DS_TPO_TREATMENT.networkId,
                  networkLabel: "TEFCA",
                  purposeId: "purpose.made-up",
                  purposeLabel: "Fake",
                  isTpo: true,
                  asOfDate: DEMO_DS_TPO_TREATMENT.asOfDate,
                  requesterIdentityVerified: true,
                  consentedPurposeIds: [],
                  decision: "release-authorized",
                  appliedRules: [
                    {
                      ruleId: "rule.tpo-release-authorized",
                      ruleLabel: "TPO",
                      reasonCode: "reason.DS-100",
                      reasonLabel: "TPO",
                      detail: "override"
                    }
                  ],
                  primaryReasonCode: "reason.DS-100",
                  primaryReasonLabel: "TPO",
                  routedTo: "auto-release",
                  requiresPrivacyOfficerCosign: false,
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
    expect(violationIds).toContain("policy.data-sharing.purpose-catalog-sourced");
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "data-sharing-tefca.evaluate.blocked")).toBe(true);
  });

  it("blocks a release-authorized non-TPO claim without consent (no-autonomous-non-tpo-release)", async () => {
    const taskId = "test-ds-nontpo-lie-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DS_NON_TPO_NO_CONSENT,
                decisionOverride: {
                  requestRef: DEMO_DS_NON_TPO_NO_CONSENT.requestRef,
                  patientRef: DEMO_DS_NON_TPO_NO_CONSENT.patientRef,
                  requesterRef: DEMO_DS_NON_TPO_NO_CONSENT.requesterRef,
                  networkId: DEMO_DS_NON_TPO_NO_CONSENT.networkId,
                  networkLabel: "Carequality",
                  purposeId: DEMO_DS_NON_TPO_NO_CONSENT.purposeId,
                  purposeLabel: "Research",
                  isTpo: false,
                  asOfDate: DEMO_DS_NON_TPO_NO_CONSENT.asOfDate,
                  requesterIdentityVerified: true,
                  consentedPurposeIds: [],
                  decision: "release-authorized",
                  appliedRules: [
                    {
                      ruleId: "rule.non-tpo-consented-release",
                      ruleLabel: "Ok",
                      reasonCode: "reason.DS-101",
                      reasonLabel: "Ok",
                      detail: "override"
                    }
                  ],
                  primaryReasonCode: "reason.DS-101",
                  primaryReasonLabel: "Ok",
                  routedTo: "auto-release",
                  requiresPrivacyOfficerCosign: false,
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
    expect(violationIds).toContain("policy.data-sharing.no-autonomous-non-tpo-release");
  });

  it("blocks a release-authorized claim with unverified requester (participant-verified)", async () => {
    const taskId = "test-ds-unv-lie-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DS_TPO_TREATMENT,
                decisionOverride: {
                  requestRef: DEMO_DS_TPO_TREATMENT.requestRef,
                  patientRef: DEMO_DS_TPO_TREATMENT.patientRef,
                  requesterRef: DEMO_DS_TPO_TREATMENT.requesterRef,
                  networkId: DEMO_DS_TPO_TREATMENT.networkId,
                  networkLabel: "TEFCA",
                  purposeId: DEMO_DS_TPO_TREATMENT.purposeId,
                  purposeLabel: "Treatment",
                  isTpo: true,
                  asOfDate: DEMO_DS_TPO_TREATMENT.asOfDate,
                  requesterIdentityVerified: false, // caller lies
                  consentedPurposeIds: [],
                  decision: "release-authorized",
                  appliedRules: [
                    {
                      ruleId: "rule.tpo-release-authorized",
                      ruleLabel: "TPO",
                      reasonCode: "reason.DS-100",
                      reasonLabel: "TPO",
                      detail: "override"
                    }
                  ],
                  primaryReasonCode: "reason.DS-100",
                  primaryReasonLabel: "TPO",
                  routedTo: "auto-release",
                  requiresPrivacyOfficerCosign: false,
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
    expect(violationIds).toContain("policy.data-sharing.participant-verified");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/data-sharing-tefca/tasks", {
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
      new Request("http://localhost/api/agents/data-sharing-tefca/tasks", {
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
