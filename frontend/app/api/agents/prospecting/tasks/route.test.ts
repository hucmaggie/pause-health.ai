import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/prospecting/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/prospecting/tasks", () => {
  it("drafts a nurture touch for a consented warming lead (never sends)", async () => {
    const taskId = "test-prospect-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            { type: "data", data: { lead: { source: "content-download", ageBand: "51-55", consentOptIn: true } } }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    const nurture = body.result.artifacts[0].parts.find(
      (p: { type: string }) => p.type === "data"
    ).data.nurture;
    expect(nurture.humanApprovalRequired).toBe(true);
    expect(nurture.sent).toBe(false);
  });

  it("blocks a nurture touch with no contact consent", async () => {
    const taskId = "test-prospect-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { lead: { source: "content-download", consentOptIn: false } } }]
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
});
