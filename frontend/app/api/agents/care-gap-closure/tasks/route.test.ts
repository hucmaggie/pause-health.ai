import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/care-gap-closure/tasks", {
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

describe("POST /api/agents/care-gap-closure/tasks", () => {
  it("detects care gaps, drafts outreach, and hands off to engagement", async () => {
    const taskId = "test-caregap-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                detectionContext: {
                  asOf: AS_OF,
                  ageBand: "51-55",
                  cycleStatus: "stopped>=12mo",
                  primarySymptom: "hot_flashes",
                  onHrt: true,
                  measureHistory: {}
                },
                patientPrefs: { channel: "email", hasContactConsent: true }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    // Drafted outreach is handed to the Engagement Agent.
    expect(body.result.metadata.agentFabric.nextAgent).toBe("engagement-agent");
    expect(body.result.metadata.agentFabric.gapsTraceToClinicalMeasure).toBe(true);
    expect(body.result.metadata.agentFabric.gapsDetected).toBeGreaterThan(0);

    const data = dataPart(body).data as {
      gaps: { measureId: string; status: string }[];
      drafts: { measureId: string; requiresHumanApproval: boolean; sent: boolean }[];
    };
    expect(data.gaps.length).toBeGreaterThan(0);
    // Every detected gap references a catalog measure id.
    for (const g of data.gaps) {
      expect(g.measureId).toMatch(/^measure\./);
    }
    // One draft per gap, all human-approval-gated and unsent.
    expect(data.drafts).toHaveLength(data.gaps.length);
    for (const d of data.drafts) {
      expect(d.requiresHumanApproval).toBe(true);
      expect(d.sent).toBe(false);
    }

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("data360.grounding");
    expect(ops).toContain("caregap.detect");
    expect(ops).toContain("caregap.outreach.draft");
    // The engagement handoff span is recorded on the same task.
    const handoff = spans.find(
      (s) => s.operation === "engagement.outreach.handoff"
    );
    expect(handoff?.agentId).toBe("engagement-agent");
    const detect = spans.find((s) => s.operation === "caregap.detect");
    expect(detect?.agentId).toBe("care-gap-closure-agent");
    expect(detect?.attributes?.gapsTraceToClinicalMeasure).toBe(true);
  });

  it("reads a bare data object as the detection context", async () => {
    const taskId = "test-caregap-bare-001";
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
                ageBand: "51-55",
                cycleStatus: "stopped>=12mo",
                onHrt: false
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

  it("blocks a caller-asserted off-catalog (fabricated) gap", async () => {
    const taskId = "test-caregap-offcatalog-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                gaps: [
                  {
                    measureId: "measure.totally-invented",
                    measureLabel: "Invented measure",
                    status: "overdue",
                    lastDone: null,
                    priority: "urgent",
                    rationale: "fabricated"
                  }
                ]
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
    expect(violationIds).toContain("policy.caregap.clinical-measure-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "caregap.detect.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "caregap.detect")).toBe(false);
  });

  it("blocks outreach when the patient has no contact consent", async () => {
    const taskId = "test-caregap-noconsent-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                detectionContext: {
                  asOf: AS_OF,
                  ageBand: "51-55",
                  cycleStatus: "stopped>=12mo",
                  onHrt: true
                },
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
      new Request("http://localhost/api/agents/care-gap-closure/tasks", {
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
      new Request("http://localhost/api/agents/care-gap-closure/tasks", {
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
