import { describe, expect, it } from "vitest";

import { POST } from "./route";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/assessment/tasks", {
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

describe("POST /api/agents/assessment/tasks", () => {
  it("scores a validated instrument and returns the structured result + intake signal", async () => {
    const taskId = "test-assessment-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                assessment: {
                  instrument: "mrs",
                  responses: [3, 3, 3, 2, 2, 2, 1, 1, 1, 1, 2]
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.nextAgent).toBe("agentforce-intake");
    expect(body.result.metadata.agentFabric.intakeSeverity).toBe("severe");

    const data = dataPart(body).data as {
      result: { instrument: string; total: number; severityBand: string };
      intakeSignal: { severity: string; redFlagsAcknowledged: string };
    };
    expect(data.result.instrument).toBe("mrs");
    expect(data.result.total).toBe(21);
    expect(data.result.severityBand).toBe("severe");
    expect(data.intakeSignal).toEqual({
      severity: "severe",
      redFlagsAcknowledged: "no"
    });

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("assessment.score");
    expect(spans.every((s) => s.agentId === "assessment-agent")).toBe(true);
    const score = spans.find((s) => s.operation === "assessment.score");
    expect(score?.attributes?.validatedInstrument).toBe(true);
    expect(score?.attributes?.scoringMethod).toBe("deterministic");
  });

  it("records a red-flag escalation span for PHQ-9 item 9", async () => {
    const taskId = "test-assessment-redflag-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                assessment: {
                  instrument: "phq-9",
                  responses: [0, 0, 0, 0, 0, 0, 0, 0, 2]
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    // A red flag forces the intake severity to severe even at a minimal band.
    expect(body.result.metadata.agentFabric.intakeSeverity).toBe("severe");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const escalate = spans.find(
      (s) => s.operation === "assessment.red-flag.escalate"
    );
    expect(escalate).toBeDefined();
    expect(escalate!.status).toBe("error");
    expect(escalate!.attributes?.redFlags).toContain("phq9-item9-self-harm");
  });

  it("blocks an instrument outside the validated allow-list", async () => {
    const taskId = "test-assessment-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                assessment: { instrument: "gad-7", responses: [0, 0, 0, 0, 0, 0, 0] }
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
    expect(violationIds).toContain("policy.assessment.validated-instrument-only");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "assessment.score.blocked")).toBe(true);
    // No scoring happened.
    expect(spans.some((s) => s.operation === "assessment.score")).toBe(false);
  });

  it("fails a well-formed request with a malformed response vector", async () => {
    const taskId = "test-assessment-invalid-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { assessment: { instrument: "phq-9", responses: [0, 1, 2] } }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    expect(body.result.metadata.agentFabric.error).toMatch(/expects 9 responses/);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "assessment.score.invalid")).toBe(true);
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/assessment/tasks", {
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
      new Request("http://localhost/api/agents/assessment/tasks", {
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
