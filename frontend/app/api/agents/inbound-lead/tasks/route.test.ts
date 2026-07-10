import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/inbound-lead/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

const consentedLead = {
  source: "web-chat",
  ageBand: "46-50",
  primarySymptom: "vasomotor",
  consentOptIn: true
};

describe("POST /api/agents/inbound-lead/tasks", () => {
  it("captures a consented lead and hands off to qualification", async () => {
    const taskId = "test-inbound-ok-001";
    const res = await POST(
      rpc({ id: taskId, message: { role: "user", parts: [{ type: "data", data: { lead: consentedLead } }] } })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.nextAgent).toBe("qualification-agent");

    const data = body.result.artifacts[0].parts.find((p: { type: string }) => p.type === "data").data;
    expect(data.screen.icpMatch).toBe(true);
    expect(data.unifiedPatientId).toBeTruthy();

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("lead.capture");
    expect(ops).toContain("lead.identity.resolve");
    expect(ops).toContain("lead.route.handoff");
    // every span attributed to the inbound-lead agent
    expect(spans.every((s) => s.agentId === "inbound-lead-agent")).toBe(true);
  });

  it("blocks a lead with no consent (explicit-opt-in policy)", async () => {
    const taskId = "test-inbound-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: { role: "user", parts: [{ type: "data", data: { lead: { ...consentedLead, consentOptIn: false } } }] }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const violationIds = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(violationIds).toContain("policy.lead.explicit-optin-and-source-required");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/inbound-lead/tasks", {
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
      new Request("http://localhost/api/agents/inbound-lead/tasks", {
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
