import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/sdoh-screening/tasks", {
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

/** An all-negative AHC-HRSN response set (safety items at their 1-min floor). */
function negativeResponses() {
  return {
    housing: [0, 0],
    food: [0, 0],
    transportation: [0],
    utilities: [0],
    safety: [1, 1, 1, 1]
  };
}

describe("POST /api/agents/sdoh-screening/tasks", () => {
  it("screens a multi-domain positive set and drafts consented community referrals", async () => {
    const taskId = "test-sdoh-ok-001";
    const responses = negativeResponses();
    responses.food = [1, 0];
    responses.transportation = [1];
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                screening: { screener: "ahc-hrsn", responses },
                patientConsent: true
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.socialNeedsIdentified).toBe(true);
    expect(body.result.metadata.agentFabric.positiveDomainCount).toBe(2);
    expect(body.result.metadata.agentFabric.safetyEscalation).toBe(false);
    expect(body.result.metadata.agentFabric.nextAgent).toBe("agentforce-intake");

    const data = dataPart(body).data as {
      result: { positiveDomains: string[]; positiveDomainCount: number };
      referrals: { resourceId: string; suppressedForNoConsent: boolean; sent: boolean }[];
      careSignal: { safetyEscalation: boolean };
    };
    expect(data.result.positiveDomains).toEqual(["food", "transportation"]);
    const resourceIds = data.referrals.map((r) => r.resourceId);
    expect(resourceIds).toContain("resource.food-bank");
    expect(resourceIds).toContain("resource.transportation-assistance");
    expect(resourceIds).toContain("resource.211-helpline");
    for (const r of data.referrals) {
      expect(r.suppressedForNoConsent).toBe(false);
      expect(r.sent).toBe(false);
    }

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("sdoh.screen");
    expect(ops).toContain("sdoh.refer");
    expect(spans.every((s) => s.agentId === "sdoh-screening-agent")).toBe(true);
    const screen = spans.find((s) => s.operation === "sdoh.screen");
    expect(screen?.attributes?.usesValidatedSdohScreener).toBe(true);
    expect(screen?.attributes?.phiAccessed).toBe(true);
  });

  it("escalates a positive interpersonal-safety screen to a human social worker", async () => {
    const taskId = "test-sdoh-safety-001";
    const responses = negativeResponses();
    responses.safety = [4, 4, 4, 4]; // HITS total 16 > 10
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                screening: { screener: "ahc-hrsn", responses },
                patientConsent: true
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.safetyEscalation).toBe(true);
    expect(body.result.metadata.agentFabric.nextAgent).toBe("human-social-worker");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const escalate = spans.find((s) => s.operation === "sdoh.safety.escalate");
    expect(escalate).toBeDefined();
    expect(escalate!.status).toBe("error");
    expect(escalate!.attributes?.redFlags).toContain(
      "ahc-hrsn-interpersonal-safety"
    );
    expect(escalate!.attributes?.handoffTo).toBe("social-worker");
  });

  it("blocks a community referral drafted without patient consent", async () => {
    const taskId = "test-sdoh-consent-block-001";
    const responses = negativeResponses();
    responses.food = [2, 0]; // positive food insecurity → a referral would be drafted
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                screening: { screener: "ahc-hrsn", responses },
                patientConsent: false
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
    expect(violationIds).toContain("policy.sdoh.consent-before-referral");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "sdoh.screen.blocked")).toBe(true);
    // No screening/referral happened.
    expect(spans.some((s) => s.operation === "sdoh.refer")).toBe(false);
  });

  it("allows an all-negative screen without consent (nothing to refer)", async () => {
    const taskId = "test-sdoh-negative-noconsent-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                screening: { screener: "ahc-hrsn", responses: negativeResponses() },
                patientConsent: false
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.socialNeedsIdentified).toBe(false);
    expect(body.result.metadata.agentFabric.referralsDrafted).toBe(0);
  });

  it("blocks a screener outside the validated allow-list", async () => {
    const taskId = "test-sdoh-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                screening: { screener: "prapare", responses: {} },
                patientConsent: true
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
    expect(violationIds).toContain("policy.sdoh.validated-screener-only");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "sdoh.screen.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "sdoh.screen")).toBe(false);
  });

  it("fails a well-formed request with a malformed response vector", async () => {
    const taskId = "test-sdoh-invalid-001";
    const responses = negativeResponses();
    responses.food = [0]; // Hunger Vital Sign expects 2 items
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                screening: { screener: "ahc-hrsn", responses },
                patientConsent: true
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    expect(body.result.metadata.agentFabric.error).toMatch(/expects 2 responses/);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "sdoh.screen.invalid")).toBe(true);
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/sdoh-screening/tasks", {
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
      new Request("http://localhost/api/agents/sdoh-screening/tasks", {
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
