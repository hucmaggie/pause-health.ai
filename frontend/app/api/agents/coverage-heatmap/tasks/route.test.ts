import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_COVERAGE_HEATMAP_COVERED_REQUEST,
  DEMO_COVERAGE_HEATMAP_REQUEST,
  DEMO_COVERAGE_HEATMAP_SPIKE_REQUEST,
  evaluateCoverageHeatmap
} from "../../../../../lib/coverage-heatmap";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/coverage-heatmap/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateCoverageHeatmap(DEMO_COVERAGE_HEATMAP_REQUEST);

describe("POST /api/agents/coverage-heatmap/tasks", () => {
  it("understaffed schedule → completed, with a parented PHI-adjacent trace", async () => {
    const taskId = "test-ch-understaffed-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_COVERAGE_HEATMAP_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("understaffed");
    expect(body.result.metadata.agentFabric.understaffedCount).toBe(2);
    expect(body.result.metadata.agentFabric.minCoverage).toBe(1);
    expect(body.result.metadata.agentFabric.coverageSourcedSignal).toBe(true);
    expect(body.result.metadata.agentFabric.coverageAccumulationExact).toBe(true);
    expect(body.result.metadata.agentFabric.coverageNoAutonomousStaff).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("coverageheat.receive-schedule");
    expect(ops).toContain("coverageheat.accumulate");
    expect(ops).toContain("coverageheat.classify-disposition");
    expect(ops).toContain("coverageheat.log-audit");
    const accSpan = spans.find((s) => s.operation === "coverageheat.accumulate");
    expect(accSpan?.agentId).toBe("coverage-heatmap-agent");
    expect(accSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("fully-covered schedule → completed (fully-covered)", async () => {
    const res = await POST(
      rpc({
        id: "test-ch-covered-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_COVERAGE_HEATMAP_COVERED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("fully-covered");
    expect(body.result.metadata.agentFabric.understaffedCount).toBe(0);
  });

  it("spiky schedule → completed (understaffed)", async () => {
    const res = await POST(
      rpc({
        id: "test-ch-spike-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_COVERAGE_HEATMAP_SPIKE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.maxCoverage).toBe(5);
  });

  it("blocks a fabricated coverage value (coverage-sourced)", async () => {
    const taskId = "test-ch-sourced-block-001";
    const coverage = VALID_DETERMINATION.coverage.map((c, i) => (i === 6 ? c + 5 : c));
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { request: DEMO_COVERAGE_HEATMAP_REQUEST, determination: { ...VALID_DETERMINATION, coverage } }
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
    expect(ids).toContain("policy.coverageheat.coverage-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "coverageheat.map.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "coverageheat.log-audit")).toBe(false);
  });

  it("blocks a mis-materialized coverage array (accumulation-exact)", async () => {
    // Inflate a non-understaffed slot: the under-staffed slot set is unchanged, but the difference-array
    // re-materialization disagrees. The sourced gate ALSO disagrees (direct count), so both may fire — assert
    // accumulation-exact is among them.
    const coverage = VALID_DETERMINATION.coverage.map((c, i) => (i === 2 ? c + 1 : c));
    const res = await POST(
      rpc({
        id: "test-ch-exact-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { request: DEMO_COVERAGE_HEATMAP_REQUEST, determination: { ...VALID_DETERMINATION, coverage } }
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
    expect(ids).toContain("policy.coverageheat.accumulation-exact");
  });

  it("blocks an autonomous staffing action (no-autonomous-staff)", async () => {
    const res = await POST(
      rpc({
        id: "test-ch-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_COVERAGE_HEATMAP_REQUEST,
                determination: { ...VALID_DETERMINATION, requiresManagerReview: false, autoStaffed: true }
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
    expect(ids).toContain("policy.coverageheat.no-autonomous-staff");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/coverage-heatmap/tasks", {
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
      new Request("http://localhost/api/agents/coverage-heatmap/tasks", {
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
