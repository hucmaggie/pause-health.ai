import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_KPI_TREND_DECLINING_REQUEST,
  DEMO_KPI_TREND_FLAT_REQUEST,
  DEMO_KPI_TREND_REQUEST,
  evaluateKpiTrend
} from "../../../../../lib/kpi-trend";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/kpi-trend/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the rising demo — the block base. */
const VALID_DETERMINATION = evaluateKpiTrend(DEMO_KPI_TREND_REQUEST);

describe("POST /api/agents/kpi-trend/tasks", () => {
  it("rising series → completed, with a parented non-PHI trace", async () => {
    const taskId = "test-kpi-rising-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: { role: "user", parts: [{ type: "data", data: { request: DEMO_KPI_TREND_REQUEST } }] }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.trend).toBe("rising");
    expect(body.result.metadata.agentFabric.slope).toBeCloseTo(11, 9);
    expect(body.result.metadata.agentFabric.projection).toBeCloseTo(86, 9);
    expect(body.result.metadata.agentFabric.kpiSeriesSourced).toBe(true);
    expect(body.result.metadata.agentFabric.kpiFitConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.kpiNoAutonomousCommit).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("kpi.receive-series");
    expect(ops).toContain("kpi.fit-regression");
    expect(ops).toContain("kpi.classify-trend");
    expect(ops).toContain("kpi.log-audit");
    const fitSpan = spans.find((s) => s.operation === "kpi.fit-regression");
    expect(fitSpan?.agentId).toBe("kpi-trend-agent");
    // Commercial plane — no PHI.
    expect(fitSpan?.attributes?.phiAccessed).toBe(false);
  });

  it("flat series → completed, flat", async () => {
    const res = await POST(
      rpc({
        id: "test-kpi-flat-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_KPI_TREND_FLAT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.trend).toBe("flat");
  });

  it("declining series → completed, declining", async () => {
    const res = await POST(
      rpc({
        id: "test-kpi-declining-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_KPI_TREND_DECLINING_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.trend).toBe("declining");
    expect(body.result.metadata.agentFabric.projection).toBeCloseTo(32, 9);
  });

  it("blocks a phantom point (series-sourced)", async () => {
    const taskId = "test-kpi-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_KPI_TREND_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  points: [...VALID_DETERMINATION.points, { index: 99, value: 999, fitted: 0, residual: 0 }]
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
    expect(ids).toContain("policy.kpi.series-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "kpi.fit-regression.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "kpi.log-audit")).toBe(false);
  });

  it("blocks a mis-fit line (fit-consistent)", async () => {
    const res = await POST(
      rpc({
        id: "test-kpi-misfit-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_KPI_TREND_REQUEST,
                determination: { ...VALID_DETERMINATION, slope: 5, projection: 50 }
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
    expect(ids).toContain("policy.kpi.fit-consistent");
  });

  it("blocks an autonomous commit (no-autonomous-commit)", async () => {
    const res = await POST(
      rpc({
        id: "test-kpi-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_KPI_TREND_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresAnalystReview: false,
                  autoCommitted: true
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
    expect(ids).toContain("policy.kpi.no-autonomous-commit");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/kpi-trend/tasks", {
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
      new Request("http://localhost/api/agents/kpi-trend/tasks", {
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
