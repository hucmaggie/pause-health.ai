import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/member-service/tasks", {
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

describe("POST /api/agents/member-service/tasks", () => {
  it("answers an in-scope billing question, citing a claim record, with trace spans", async () => {
    const taskId = "test-member-service-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                query: "what is the status of my claim?",
                memberId: "member-test-a"
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    // The honesty invariant: every billing answer traces to a claim record.
    expect(body.result.metadata.agentFabric.billingTracesToClaim).toBe(true);
    expect(body.result.metadata.agentFabric.routeToHuman).toBe(false);

    const data = dataPart(body).data as {
      answer: {
        kind: string;
        citedClaims: { claimId: string; synthetic: boolean }[];
        source: { synthetic: boolean };
      };
    };
    expect(data.answer.kind).toBe("billing-answer");
    expect(data.answer.citedClaims.length).toBeGreaterThan(0);
    for (const c of data.answer.citedClaims) {
      expect(c.claimId).toMatch(/^clm-/);
      expect(c.synthetic).toBe(true);
    }
    expect(data.answer.source.synthetic).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("billing.claim.lookup");
    expect(ops).toContain("billing.answer");
    // No handoff span on an in-scope answer.
    expect(ops).not.toContain("billing.route-to-human");
    const answerSpan = spans.find((s) => s.operation === "billing.answer");
    expect(answerSpan?.agentId).toBe("member-service-agent");
    expect(answerSpan?.attributes?.billingTracesToClaim).toBe(true);
  });

  it("routes an out-of-scope request to a human with a route-to-human span", async () => {
    const taskId = "test-member-service-route-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { query: "can I reschedule my appointment?" }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.routeToHuman).toBe(true);
    expect(body.result.metadata.agentFabric.nextAgent).toBe(
      "member-services-human"
    );

    const data = dataPart(body).data as {
      answer: { kind: string; routeToHuman: { required: boolean; queue: string } };
    };
    expect(data.answer.kind).toBe("route-to-human");
    expect(data.answer.routeToHuman.required).toBe(true);
    expect(data.answer.routeToHuman.queue).toBe("member-services-billing");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "billing.route-to-human")).toBe(
      true
    );
  });

  it("falls back to the demo query when none is provided", async () => {
    const taskId = "test-member-service-default-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: { role: "user", parts: [{ type: "data", data: {} }] }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.billingTracesToClaim).toBe(true);
  });

  it("blocks a caller-asserted billing answer that cites no claim (fabricated)", async () => {
    const taskId = "test-member-service-fabricated-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                answer: {
                  intent: "patient-responsibility",
                  kind: "billing-answer",
                  answer: "You owe $500.",
                  citedClaims: [],
                  source: {
                    synthetic: true,
                    system: "asserted",
                    note: "asserted"
                  },
                  routeToHuman: {
                    required: false,
                    reason: "",
                    queue: "member-services-billing",
                    contextBundle: {
                      intent: "patient-responsibility",
                      citedClaimIds: [],
                      claimCount: 0,
                      synthetic: true
                    }
                  }
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
    expect(violationIds).toContain("policy.billing.claim-data-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "billing.answer.blocked")).toBe(
      true
    );
    expect(spans.some((s) => s.operation === "billing.answer")).toBe(false);
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/member-service/tasks", {
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
      new Request("http://localhost/api/agents/member-service/tasks", {
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
