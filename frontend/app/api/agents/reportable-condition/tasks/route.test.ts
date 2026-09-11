import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_CASE_DEFINITION,
  DEMO_REPORTABLE_CASE_NEGATIVE_REQUEST,
  DEMO_REPORTABLE_CASE_PROBABLE_REQUEST,
  DEMO_REPORTABLE_CASE_REQUEST,
  referencedFactsOf
} from "../../../../../lib/reportable-condition";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/reportable-condition/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the probable demo — the block base. */
const VALID_DETERMINATION = {
  caseRef: "rc-case-002",
  condition: DEMO_CASE_DEFINITION.condition,
  facts: DEMO_REPORTABLE_CASE_PROBABLE_REQUEST.facts,
  definition: DEMO_CASE_DEFINITION,
  classificationResults: [
    { classification: "confirmed", met: false },
    { classification: "probable", met: true },
    { classification: "suspect", met: true }
  ],
  classification: "probable",
  reportable: true,
  referencedFacts: referencedFactsOf(DEMO_CASE_DEFINITION),
  requiresEpiReview: true,
  autoReported: false
};

describe("POST /api/agents/reportable-condition/tasks", () => {
  it("confirmed → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-rc-confirmed-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_REPORTABLE_CASE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.classification).toBe("confirmed");
    expect(body.result.metadata.agentFabric.reportable).toBe(true);
    expect(body.result.metadata.agentFabric.caseFactsSourced).toBe(true);
    expect(body.result.metadata.agentFabric.classificationConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.noAutonomousReport).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("rc.receive-case");
    expect(ops).toContain("rc.evaluate-criteria");
    expect(ops).toContain("rc.classify");
    expect(ops).toContain("rc.log-audit");
    const evalSpan = spans.find((s) => s.operation === "rc.evaluate-criteria");
    expect(evalSpan?.agentId).toBe("reportable-condition-agent");
    expect(evalSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("probable → completed", async () => {
    const taskId = "test-rc-probable-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_REPORTABLE_CASE_PROBABLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.classification).toBe("probable");
    expect(body.result.metadata.agentFabric.reportable).toBe(true);
  });

  it("not-a-case → completed, not reportable", async () => {
    const taskId = "test-rc-negative-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_REPORTABLE_CASE_NEGATIVE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.classification).toBe("not-a-case");
    expect(body.result.metadata.agentFabric.reportable).toBe(false);
  });

  it("blocks a phantom classification result (facts-sourced)", async () => {
    const taskId = "test-rc-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_REPORTABLE_CASE_PROBABLE_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  classificationResults: [
                    ...VALID_DETERMINATION.classificationResults,
                    { classification: "phantom-tier", met: true }
                  ]
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
    expect(ids).toContain("policy.reportable.facts-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "rc.evaluate-criteria.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "rc.log-audit")).toBe(false);
  });

  it("blocks a mis-evaluated criteria tree (classification-consistent)", async () => {
    const taskId = "test-rc-miseval-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_REPORTABLE_CASE_PROBABLE_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  classificationResults: [
                    { classification: "confirmed", met: true },
                    { classification: "probable", met: true },
                    { classification: "suspect", met: true }
                  ],
                  classification: "confirmed",
                  reportable: true
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
    expect(ids).toContain("policy.reportable.classification-consistent");
  });

  it("blocks an autonomous report (no-autonomous-report)", async () => {
    const taskId = "test-rc-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_REPORTABLE_CASE_PROBABLE_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresEpiReview: false,
                  autoReported: true
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
    expect(ids).toContain("policy.reportable.no-autonomous-report");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/reportable-condition/tasks", {
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
      new Request("http://localhost/api/agents/reportable-condition/tasks", {
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
