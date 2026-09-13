import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_AUDIT_SAMPLE_FULL_REQUEST,
  DEMO_AUDIT_SAMPLE_RESEED_REQUEST,
  DEMO_AUDIT_SAMPLE_REQUEST,
  evaluateAuditSample
} from "../../../../../lib/audit-sample";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/audit-sample/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateAuditSample(DEMO_AUDIT_SAMPLE_REQUEST);

describe("POST /api/agents/audit-sample/tasks", () => {
  it("sampled population → completed, with a parented PHI-adjacent trace", async () => {
    const taskId = "test-as-sampled-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AUDIT_SAMPLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("sampled");
    expect(body.result.metadata.agentFabric.populationSize).toBe(20);
    expect(body.result.metadata.agentFabric.effectiveSampleSize).toBe(5);
    expect(body.result.metadata.agentFabric.inclusionProbability).toBe(0.25);
    expect(body.result.metadata.agentFabric.auditSampleSourced).toBe(true);
    expect(body.result.metadata.agentFabric.auditSelectionReproducible).toBe(true);
    expect(body.result.metadata.agentFabric.auditNoAutonomousAudit).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("auditsample.receive-population");
    expect(ops).toContain("auditsample.select");
    expect(ops).toContain("auditsample.classify-disposition");
    expect(ops).toContain("auditsample.log-audit");
    const selectSpan = spans.find((s) => s.operation === "auditsample.select");
    expect(selectSpan?.agentId).toBe("audit-sample-agent");
    expect(selectSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("full-population request → completed (full-population)", async () => {
    const res = await POST(
      rpc({
        id: "test-as-full-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AUDIT_SAMPLE_FULL_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("full-population");
    expect(body.result.metadata.agentFabric.inclusionProbability).toBe(1);
  });

  it("reseeded request → completed (sampled, different draw)", async () => {
    const res = await POST(
      rpc({
        id: "test-as-reseed-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_AUDIT_SAMPLE_RESEED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.seed).toBe(42);
  });

  it("blocks a fabricated id (sample-sourced)", async () => {
    const taskId = "test-as-sourced-block-001";
    const sample = [...VALID_DETERMINATION.sample.slice(0, 4), "CLM-FAKE"];
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { request: DEMO_AUDIT_SAMPLE_REQUEST, determination: { ...VALID_DETERMINATION, sample } }
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
    expect(ids).toContain("policy.auditsample.sample-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "auditsample.select.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "auditsample.log-audit")).toBe(false);
  });

  it("blocks a cherry-picked sample the seed wouldn't produce (selection-reproducible)", async () => {
    // Five real population ids that aren't the seeded draw: passes sourced, fails reproducible.
    const sample = ["CLM-44201", "CLM-44202", "CLM-44203", "CLM-44205", "CLM-44206"];
    const res = await POST(
      rpc({
        id: "test-as-repro-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { request: DEMO_AUDIT_SAMPLE_REQUEST, determination: { ...VALID_DETERMINATION, sample } }
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
    expect(ids).toContain("policy.auditsample.selection-reproducible");
    // Isolable: it passed sourced.
    expect(ids).not.toContain("policy.auditsample.sample-sourced");
  });

  it("blocks an autonomous audit (no-autonomous-audit)", async () => {
    const res = await POST(
      rpc({
        id: "test-as-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_AUDIT_SAMPLE_REQUEST,
                determination: { ...VALID_DETERMINATION, requiresAuditorReview: false, autoAudited: true }
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
    expect(ids).toContain("policy.auditsample.no-autonomous-audit");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/audit-sample/tasks", {
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
      new Request("http://localhost/api/agents/audit-sample/tasks", {
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
