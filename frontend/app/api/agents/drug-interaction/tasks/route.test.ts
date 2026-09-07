import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_DRUG_INTERACTION_CONTRA_REQUEST,
  DEMO_DRUG_INTERACTION_NONE_REQUEST,
  DEMO_DRUG_INTERACTION_REQUEST
} from "../../../../../lib/drug-interaction";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/drug-interaction/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/drug-interaction/tasks", () => {
  it("major interaction → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-ddi-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DRUG_INTERACTION_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.overallSeverity).toBe("major");
    expect(body.result.metadata.agentFabric.disposition).toBe("review-required");
    expect(body.result.metadata.agentFabric.ddiInteractionSourced).toBe(true);
    expect(body.result.metadata.agentFabric.ddiSeverityConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.ddiNoAutonomousHoldOrOverride).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("ddi.receive-order");
    expect(ops).toContain("ddi.match-interactions");
    expect(ops).toContain("ddi.rank-severity");
    expect(ops).toContain("ddi.log-audit");
    const rankSpan = spans.find((s) => s.operation === "ddi.rank-severity");
    expect(rankSpan?.agentId).toBe("drug-interaction-agent");
    expect(rankSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("contraindicated combination → do-not-coadminister", async () => {
    const taskId = "test-ddi-contra-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DRUG_INTERACTION_CONTRA_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.overallSeverity).toBe("contraindicated");
    expect(body.result.metadata.agentFabric.disposition).toBe("do-not-coadminister-needs-review");
  });

  it("no interaction → no-interaction-detected", async () => {
    const taskId = "test-ddi-none-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DRUG_INTERACTION_NONE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.overallSeverity).toBe("none");
    expect(body.result.metadata.agentFabric.disposition).toBe("no-interaction-detected");
  });

  it("blocks a fabricated interaction (interaction-sourced)", async () => {
    const taskId = "test-ddi-offcatalog-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DRUG_INTERACTION_REQUEST,
                determination: {
                  requestRef: "ddi-001",
                  detectedInteractions: [
                    { interactionId: "ddi.we-made-up", severity: "major" }
                  ],
                  overallSeverity: "major",
                  disposition: "review-required",
                  requiresClinicianReview: true,
                  autoHeldOrder: false,
                  autoOverrodeAlert: false
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.ddi.interaction-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "ddi.match-interactions.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "ddi.log-audit")).toBe(false);
  });

  it("blocks an inflated overall severity (severity-consistent)", async () => {
    const taskId = "test-ddi-inflated-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DRUG_INTERACTION_REQUEST,
                determination: {
                  requestRef: "ddi-003",
                  detectedInteractions: [{ interactionId: "ddi.estradiol-rifampin" }],
                  overallSeverity: "contraindicated",
                  disposition: "do-not-coadminister-needs-review",
                  requiresClinicianReview: true,
                  autoHeldOrder: false,
                  autoOverrodeAlert: false
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.ddi.severity-consistent");
  });

  it("blocks an autonomously-held order (no-autonomous-hold-or-override)", async () => {
    const taskId = "test-ddi-autohold-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DRUG_INTERACTION_CONTRA_REQUEST,
                determination: {
                  requestRef: "ddi-002",
                  detectedInteractions: [{ interactionId: "ddi.sildenafil-nitroglycerin" }],
                  overallSeverity: "contraindicated",
                  disposition: "do-not-coadminister-needs-review",
                  requiresClinicianReview: false,
                  autoHeldOrder: true,
                  autoOverrodeAlert: false
                }
              }
            }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.ddi.no-autonomous-hold-or-override");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/drug-interaction/tasks", {
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
      new Request("http://localhost/api/agents/drug-interaction/tasks", {
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
