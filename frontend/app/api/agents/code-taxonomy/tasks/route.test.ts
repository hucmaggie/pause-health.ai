import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_CODE_TAXONOMY_ALL_REQUEST,
  DEMO_CODE_TAXONOMY_REQUEST,
  DEMO_CODE_TAXONOMY_SPECIFIC_REQUEST,
  evaluateCodeTaxonomy
} from "../../../../../lib/code-taxonomy";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/code-taxonomy/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the mixed demo — the block base. */
const VALID_DETERMINATION = evaluateCodeTaxonomy(DEMO_CODE_TAXONOMY_REQUEST);

describe("POST /api/agents/code-taxonomy/tasks", () => {
  it("mixed batch → completed, with a parented non-PHI trace", async () => {
    const taskId = "test-ct-mixed-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CODE_TAXONOMY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("unclassified-present");
    expect(body.result.metadata.agentFabric.classifiedCount).toBe(4);
    expect(body.result.metadata.agentFabric.unclassifiedCount).toBe(1);
    expect(body.result.metadata.agentFabric.codeClassificationsSourced).toBe(true);
    expect(body.result.metadata.agentFabric.codeClassificationConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.codeNoAutonomousRecode).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("taxonomy.receive-codes");
    expect(ops).toContain("taxonomy.match-prefixes");
    expect(ops).toContain("taxonomy.classify-disposition");
    expect(ops).toContain("taxonomy.log-audit");
    const matchSpan = spans.find((s) => s.operation === "taxonomy.match-prefixes");
    expect(matchSpan?.agentId).toBe("code-taxonomy-agent");
    expect(matchSpan?.attributes?.phiAccessed).toBe(false);
  });

  it("all-classified batch → completed", async () => {
    const res = await POST(
      rpc({
        id: "test-ct-all-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CODE_TAXONOMY_ALL_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("all-classified");
    expect(body.result.metadata.agentFabric.unclassifiedCount).toBe(0);
  });

  it("specificity batch → completed", async () => {
    const res = await POST(
      rpc({
        id: "test-ct-specific-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_CODE_TAXONOMY_SPECIFIC_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("all-classified");
  });

  it("blocks a fabricated code (classifications-sourced)", async () => {
    const taskId = "test-ct-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CODE_TAXONOMY_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  classifications: VALID_DETERMINATION.classifications.map((c, i) =>
                    i === 0 ? { ...c, code: "PHANTOM.CODE" } : c
                  )
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
    expect(ids).toContain("policy.code.classifications-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "taxonomy.match-prefixes.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "taxonomy.log-audit")).toBe(false);
  });

  it("blocks a wrong bucket (classification-consistent)", async () => {
    const res = await POST(
      rpc({
        id: "test-ct-wrongbucket-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CODE_TAXONOMY_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  classifications: VALID_DETERMINATION.classifications.map((c, i) =>
                    i === 0
                      ? { ...c, category: "Type 2 diabetes mellitus", matchedPrefix: "E11" }
                      : c
                  )
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
    expect(ids).toContain("policy.code.classification-consistent");
  });

  it("blocks an autonomous re-code (no-autonomous-recode)", async () => {
    const res = await POST(
      rpc({
        id: "test-ct-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_CODE_TAXONOMY_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresCoderReview: false,
                  autoApplied: true
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
    expect(ids).toContain("policy.code.no-autonomous-recode");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/code-taxonomy/tasks", {
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
      new Request("http://localhost/api/agents/code-taxonomy/tasks", {
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
