import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/qualification/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/qualification/tasks", () => {
  it("qualifies a ready lead and routes it to intake", async () => {
    const taskId = "test-qual-intake-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                lead: {
                  source: "web-chat",
                  ageBand: "46-50",
                  primarySymptom: "vasomotor",
                  consentOptIn: true
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    const decision = body.result.artifacts[0].parts.find(
      (p: { type: string }) => p.type === "data"
    ).data.decision;
    expect(decision.decision).toBe("qualified");
    expect(decision.route).toBe("intake");
    expect(body.result.metadata.agentFabric.nextAgent).toBe("agentforce-intake");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "qualification.decide")).toBe(true);
  });

  it("disqualifies an out-of-ICP lead and enqueues human review", async () => {
    const taskId = "test-qual-dq-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { lead: { source: "web-chat", ageBand: "<40", primarySymptom: "vasomotor", consentOptIn: true } }
            }
          ]
        }
      })
    );
    const body = await res.json();
    const decision = body.result.artifacts[0].parts.find(
      (p: { type: string }) => p.type === "data"
    ).data.decision;
    expect(decision.decision).toBe("disqualified");
    expect(decision.route).toBe("none");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "qualification.human-review.enqueue")).toBe(true);
  });
});
