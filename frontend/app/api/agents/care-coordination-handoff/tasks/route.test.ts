import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_HANDOFF_ACCEPTED,
  DEMO_HANDOFF_ED_TO_PCP,
  DEMO_HANDOFF_NO_CONSENT,
  DEMO_HANDOFF_SBAR_INCOMPLETE,
  DEMO_HANDOFF_UNCREDENTIALED
} from "../../../../../lib/care-coordination-handoff";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/care-coordination-handoff/tasks", {
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

describe("POST /api/agents/care-coordination-handoff/tasks", () => {
  it("accepts a complete-SBAR handoff and records a parented trace", async () => {
    const taskId = "test-ho-accept-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_HANDOFF_ACCEPTED } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.handoffDecision).toBe("handoff-accepted");
    expect(body.result.metadata.agentFabric.sbarIsComplete).toBe(true);
    expect(body.result.metadata.agentFabric.receivingClinicianIsCredentialed).toBe(true);
    expect(body.result.metadata.agentFabric.handoffHasConsent).toBe(true);
  });

  it("pends an incomplete-SBAR handoff to sending-clinician-completion", async () => {
    const taskId = "test-ho-pend-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_HANDOFF_SBAR_INCOMPLETE } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.handoffDecision).toBe("pend-sbar-incomplete");
    expect(body.result.metadata.agentFabric.primaryReasonCode).toBe("reason.HO-200");
    expect(body.result.metadata.agentFabric.routedTo).toBe("sending-clinician-completion");
  });

  it("blocks a handoff to an uncredentialed receiving clinician", async () => {
    const taskId = "test-ho-uncred-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_HANDOFF_UNCREDENTIALED } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.handoffDecision).toBe(
      "blocked-clinician-not-credentialed"
    );
    expect(body.result.metadata.agentFabric.routedTo).toBe("credentialing-remediation");
  });

  it("blocks a consent-required transition without transfer consent", async () => {
    const taskId = "test-ho-noconsent-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_HANDOFF_NO_CONSENT } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.handoffDecision).toBe("blocked-no-consent");
    expect(body.result.metadata.agentFabric.routedTo).toBe("consent-capture");

    const data = dataPart(body).data as {
      result: { decision: { decision: string } };
    };
    expect(data.result.decision.decision).toBe("blocked-no-consent");
  });

  it("accepts an ED→PCP handoff without transfer consent (not required)", async () => {
    const taskId = "test-ho-ed-pcp-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_HANDOFF_ED_TO_PCP } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.metadata.agentFabric.handoffDecision).toBe("handoff-accepted");
  });

  it("blocks an accepted-handoff claim with missing SBAR (sbar-completeness)", async () => {
    const taskId = "test-ho-sbarlie-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_HANDOFF_ACCEPTED,
                decisionOverride: {
                  requestRef: DEMO_HANDOFF_ACCEPTED.requestRef,
                  patientRef: DEMO_HANDOFF_ACCEPTED.patientRef,
                  transitionTypeId: DEMO_HANDOFF_ACCEPTED.transitionTypeId,
                  transitionTypeLabel: "Hospital → SNF",
                  receivingClinicianRef: DEMO_HANDOFF_ACCEPTED.receivingClinicianRef,
                  receivingClinicianCredentialing: "current-unsanctioned",
                  transferConsentOnFile: true,
                  asOfDate: DEMO_HANDOFF_ACCEPTED.asOfDate,
                  decision: "handoff-accepted",
                  appliedRules: [],
                  missingSbarSections: ["recommendation"], // caller lies — SBAR incomplete
                  primaryReasonCode: "reason.HO-100",
                  primaryReasonLabel: "Accepted",
                  routedTo: "receiving-clinician-inbox",
                  requiresReceivingClinicianCosign: true,
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
    expect(violationIds).toContain("policy.handoff.sbar-completeness");
    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(
      spans.some((s) => s.operation === "care-coordination-handoff.evaluate.blocked")
    ).toBe(true);
  });

  it("blocks an accepted-handoff claim to an expired clinician (receiving-clinician-credentialed)", async () => {
    const taskId = "test-ho-credlie-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_HANDOFF_ACCEPTED,
                decisionOverride: {
                  requestRef: DEMO_HANDOFF_ACCEPTED.requestRef,
                  patientRef: DEMO_HANDOFF_ACCEPTED.patientRef,
                  transitionTypeId: DEMO_HANDOFF_ACCEPTED.transitionTypeId,
                  transitionTypeLabel: "Hospital → SNF",
                  receivingClinicianRef: DEMO_HANDOFF_ACCEPTED.receivingClinicianRef,
                  receivingClinicianCredentialing: "expired", // caller lies
                  transferConsentOnFile: true,
                  asOfDate: DEMO_HANDOFF_ACCEPTED.asOfDate,
                  decision: "handoff-accepted",
                  appliedRules: [],
                  missingSbarSections: [],
                  primaryReasonCode: "reason.HO-100",
                  primaryReasonLabel: "Accepted",
                  routedTo: "receiving-clinician-inbox",
                  requiresReceivingClinicianCosign: true,
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
    expect(violationIds).toContain("policy.handoff.receiving-clinician-credentialed");
  });

  it("blocks an accepted-handoff claim without transfer consent on a consent-required transition (consent-on-file)", async () => {
    const taskId = "test-ho-consentlie-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              // Caller asserts handoff-accepted for hospice transfer without consent.
              data: {
                request: {
                  ...DEMO_HANDOFF_NO_CONSENT,
                  transferConsentOnFile: false
                },
                decisionOverride: {
                  requestRef: DEMO_HANDOFF_NO_CONSENT.requestRef,
                  patientRef: DEMO_HANDOFF_NO_CONSENT.patientRef,
                  transitionTypeId: DEMO_HANDOFF_NO_CONSENT.transitionTypeId,
                  transitionTypeLabel: "Home → Hospice",
                  receivingClinicianRef: DEMO_HANDOFF_NO_CONSENT.receivingClinicianRef,
                  receivingClinicianCredentialing: "current-unsanctioned",
                  transferConsentOnFile: false,
                  asOfDate: DEMO_HANDOFF_NO_CONSENT.asOfDate,
                  decision: "handoff-accepted",
                  appliedRules: [],
                  missingSbarSections: [],
                  primaryReasonCode: "reason.HO-100",
                  primaryReasonLabel: "Accepted",
                  routedTo: "receiving-clinician-inbox",
                  requiresReceivingClinicianCosign: true,
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
    expect(violationIds).toContain("policy.handoff.consent-on-file");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/care-coordination-handoff/tasks", {
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
      new Request("http://localhost/api/agents/care-coordination-handoff/tasks", {
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
