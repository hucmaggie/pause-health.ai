import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/consent-management/tasks", {
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

describe("POST /api/agents/consent-management/tasks", () => {
  it("evaluates an ALLOW decision from the demo ledger and records a parented trace", async () => {
    const taskId = "test-consent-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { scope: "contact-outreach", channel: "sms", atTime: "2026-03-01T15:00:00Z" }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.consentAllowed).toBe(true);
    expect(body.result.metadata.agentFabric.consentTracesToRecord).toBe(true);
    expect(body.result.metadata.agentFabric.honorsRevocation).toBe(true);
    expect(body.result.metadata.agentFabric.respectsConsentScope).toBe(true);

    const data = dataPart(body).data as {
      decision: { allowed: boolean; matchedConsentEventId?: string; scope: string };
    };
    expect(data.decision.allowed).toBe(true);
    expect(data.decision.matchedConsentEventId).toBe("consent-evt-contact-001");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("consent.load-ledger");
    expect(ops).toContain("consent.evaluate");
    expect(ops).toContain("consent.decision");
    const decisionSpan = spans.find((s) => s.operation === "consent.decision");
    expect(decisionSpan?.agentId).toBe("consent-management-agent");
    expect(decisionSpan?.attributes?.phiAccessed).toBe(true);
    expect(decisionSpan?.attributes?.allowed).toBe(true);
  });

  it("DENIES a revoked scope but still completes (the safe answer, not a block)", async () => {
    const taskId = "test-consent-deny-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { scope: "marketing", channel: "email", atTime: "2026-03-01T15:00:00Z" }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.consentAllowed).toBe(false);
    // The service honored the revocation, so the run is NOT a governance block.
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.honorsRevocation).toBe(true);
  });

  it("blocks an asserted-but-unrecorded consent (recorded-source)", async () => {
    const taskId = "test-consent-unrecorded-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                scope: "contact-outreach",
                events: [
                  { scope: "contact-outreach", status: "granted", at: "2026-01-01T00:00:00Z", source: "" }
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
    expect(violationIds).toContain("policy.consent.recorded-source");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "consent.decision.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "consent.decision")).toBe(false);
  });

  it("blocks a decision that ALLOWS against a revoked/expired scope (honor-revocation)", async () => {
    const taskId = "test-consent-revoked-override-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                scope: "marketing",
                decisions: [
                  {
                    scope: "marketing",
                    channel: "email",
                    allowed: true,
                    reason: "override",
                    matchedConsentEventId: "consent-evt-marketing-001",
                    effectiveStatus: "revoked",
                    expired: false
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
    expect(violationIds).toContain("policy.consent.honor-revocation");
  });

  it("blocks a decision that overrides a withheld scope (no-scope-override)", async () => {
    const taskId = "test-consent-scope-override-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                scope: "research",
                decisions: [
                  {
                    scope: "research",
                    allowed: true,
                    reason: "override",
                    matchedConsentEventId: "consent-evt-research-001",
                    effectiveStatus: "withheld",
                    expired: false
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
    expect(violationIds).toContain("policy.consent.no-scope-override");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/consent-management/tasks", {
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
      new Request("http://localhost/api/agents/consent-management/tasks", {
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
