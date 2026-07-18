import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/medication-adherence/tasks", {
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

const AS_OF = "2026-02-02";

describe("POST /api/agents/medication-adherence/tasks", () => {
  it("assesses adherence, drafts nudge-only outreach, and hands off to engagement", async () => {
    const taskId = "test-medadh-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                asOf: AS_OF,
                medications: [
                  { drug: "med.progesterone-oral", lastFilledDaysAgo: 29, onHrt: true },
                  { drug: "med.venlafaxine-snri", lastFilledDaysAgo: 63 }
                ],
                patientPrefs: { channel: "sms", hasContactConsent: true }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    // Drafted nudges are handed to the Engagement Agent.
    expect(body.result.metadata.agentFabric.nextAgent).toBe("engagement-agent");
    // The honesty invariant: refills are always human-approval-gated.
    expect(body.result.metadata.agentFabric.refillRequiresHumanApproval).toBe(true);
    expect(body.result.metadata.agentFabric.medicationsAssessed).toBe(2);
    expect(body.result.metadata.agentFabric.dropOffs).toBeGreaterThan(0);

    const data = dataPart(body).data as {
      assessments: { drug: string; status: string }[];
      nudges: {
        drug: string;
        requiresHumanApproval: boolean;
        sent: boolean;
        nudgeOnly: boolean;
      }[];
    };
    expect(data.assessments.length).toBe(2);
    for (const a of data.assessments) {
      expect(a.drug).toMatch(/^med\./);
    }
    // Every nudge is human-approval-gated, unsent, and nudge-only.
    expect(data.nudges.length).toBeGreaterThan(0);
    for (const n of data.nudges) {
      expect(n.requiresHumanApproval).toBe(true);
      expect(n.sent).toBe(false);
      expect(n.nudgeOnly).toBe(true);
    }

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("medication.adherence.assess");
    expect(ops).toContain("medication.nudge.draft");
    // The lapsed venlafaxine is flagged to the care team.
    const dropoff = spans.find((s) => s.operation === "medication.dropoff.flag");
    expect(dropoff?.attributes?.routedTo).toBe("care-team");
    // The engagement handoff span is recorded on the same task.
    const handoff = spans.find(
      (s) => s.operation === "engagement.outreach.handoff"
    );
    expect(handoff?.agentId).toBe("engagement-agent");
    const assess = spans.find((s) => s.operation === "medication.adherence.assess");
    expect(assess?.agentId).toBe("medication-adherence-agent");
    expect(assess?.attributes?.refillRequiresHumanApproval).toBe(true);
  });

  it("falls back to the demo medication panel when none is provided", async () => {
    const taskId = "test-medadh-default-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { asOf: AS_OF } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.medicationsAssessed).toBeGreaterThan(0);
  });

  it("blocks a caller-asserted autonomous refill (no human approval)", async () => {
    const taskId = "test-medadh-autonomous-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                asOf: AS_OF,
                refillAction: { kind: "submit-refill" }
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
    expect(violationIds).toContain("policy.medication.no-autonomous-refill");
    // An autonomous refill is also a clinical action without a clinician.
    expect(violationIds).toContain("policy.clinical.no-prescribing");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(
      spans.some((s) => s.operation === "medication.adherence.assess.blocked")
    ).toBe(true);
    expect(spans.some((s) => s.operation === "medication.adherence.assess")).toBe(
      false
    );
  });

  it("allows a human-approved refill submit", async () => {
    const taskId = "test-medadh-approved-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                asOf: AS_OF,
                refillAction: { kind: "submit-refill", humanApproved: true }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
  });

  it("blocks outreach when the patient has no contact consent", async () => {
    const taskId = "test-medadh-noconsent-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                asOf: AS_OF,
                patientPrefs: { hasContactConsent: false }
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
    expect(violationIds).toContain("policy.marketing.consent-to-contact-required");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/medication-adherence/tasks", {
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
      new Request("http://localhost/api/agents/medication-adherence/tasks", {
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
