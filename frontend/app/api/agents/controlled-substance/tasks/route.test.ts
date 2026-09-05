import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST,
  DEMO_CONTROLLED_SUBSTANCE_OPIOID_BENZO_REQUEST,
  DEMO_CONTROLLED_SUBSTANCE_REQUEST
} from "../../../../../lib/controlled-substance";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/controlled-substance/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/controlled-substance/tasks", () => {
  it("classifies a low-risk screen → completed, with a parented trace", async () => {
    const taskId = "test-cs-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONTROLLED_SUBSTANCE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.riskLevel).toBe("low");
    expect(body.result.metadata.agentFabric.totalMmePerDay).toBe(30);
    expect(body.result.metadata.agentFabric.requiresPrescriberReview).toBe(false);
    expect(body.result.metadata.agentFabric.controlledSubstanceGuidelineSourced).toBe(true);
    expect(body.result.metadata.agentFabric.controlledSubstanceMmeComputed).toBe(true);
    expect(body.result.metadata.agentFabric.controlledSubstanceNoAutonomousDecision).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("controlledsubstance.receive-request");
    expect(ops).toContain("controlledsubstance.compute-mme");
    expect(ops).toContain("controlledsubstance.classify");
    expect(ops).toContain("controlledsubstance.log-audit");
    const computeSpan = spans.find((s) => s.operation === "controlledsubstance.compute-mme");
    expect(computeSpan?.agentId).toBe("controlled-substance-agent");
    expect(computeSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("classifies a stacked-opioid screen as high risk (still completed, review-gated)", async () => {
    const taskId = "test-cs-high-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.riskLevel).toBe("high");
    expect(body.result.metadata.agentFabric.totalMmePerDay).toBe(100);
    expect(body.result.metadata.agentFabric.requiresPrescriberReview).toBe(true);
  });

  it("flags a concurrent opioid + benzodiazepine (still completed)", async () => {
    const taskId = "test-cs-benzo-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            { type: "data", data: { request: DEMO_CONTROLLED_SUBSTANCE_OPIOID_BENZO_REQUEST } }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.concurrentOpioidBenzo).toBe(true);
    expect(body.result.metadata.agentFabric.riskLevel).toBe("high");
  });

  it("blocks an un-sourced guideline (guideline-sourced)", async () => {
    const taskId = "test-cs-unsourced-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CONTROLLED_SUBSTANCE_REQUEST,
                determination: {
                  requestRef: "cs-request-001",
                  guidelineId: "guideline.we-made-up",
                  proposedOpioidMmePerDay: 30,
                  concurrentOpioidMmePerDay: 0,
                  totalMmePerDay: 30,
                  riskLevel: "low",
                  requiresPrescriberReview: false,
                  autoDecision: false
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
    expect(ids).toContain("policy.controlledsubstance.guideline-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "controlledsubstance.classify.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "controlledsubstance.log-audit")).toBe(false);
  });

  it("blocks a guessed MME total (mme-computed)", async () => {
    const taskId = "test-cs-guessed-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST,
                determination: {
                  requestRef: "cs-request-002",
                  guidelineId: "guideline.cdc-2022-mme",
                  proposedOpioidMmePerDay: 60,
                  concurrentOpioidMmePerDay: 40,
                  totalMmePerDay: 30,
                  riskLevel: "low",
                  requiresPrescriberReview: false,
                  autoDecision: false
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
    expect(ids).toContain("policy.controlledsubstance.mme-computed");
  });

  it("blocks an autonomous prescribing decision (no-autonomous-prescribing-decision)", async () => {
    const taskId = "test-cs-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST,
                determination: {
                  requestRef: "cs-request-002",
                  guidelineId: "guideline.cdc-2022-mme",
                  proposedOpioidMmePerDay: 60,
                  concurrentOpioidMmePerDay: 40,
                  totalMmePerDay: 100,
                  riskLevel: "high",
                  requiresPrescriberReview: false,
                  autoDecision: true
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
    expect(ids).toContain("policy.controlledsubstance.no-autonomous-prescribing-decision");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/controlled-substance/tasks", {
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
      new Request("http://localhost/api/agents/controlled-substance/tasks", {
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
