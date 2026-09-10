import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_COST_COHORT,
  DEMO_PROVIDER_BENCHMARKING_QUALITY_REQUEST,
  DEMO_PROVIDER_BENCHMARKING_REQUEST,
  DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST
} from "../../../../../lib/provider-benchmarking";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/provider-benchmarking/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the high-cost (bottom-quartile) demo — the block base. */
const VALID_DETERMINATION = {
  benchmarkRef: "bmk-002",
  providerRef: "prov-target-high",
  metricName: "risk-adjusted-cost-per-episode",
  metricDirection: "lower-is-better",
  targetValue: 1450,
  cohort: DEMO_COST_COHORT.map((c) => ({ providerId: c.providerId, value: c.value })),
  cohortSize: 9,
  countBelow: 8,
  countEqual: 0,
  countAbove: 1,
  percentileRank: 88.89,
  effectivePercentile: 11.11,
  median: 1150,
  performanceBand: "bottom-quartile",
  disposition: "benchmark-review",
  requiresNetworkReview: true,
  autoTiered: false
};

describe("POST /api/agents/provider-benchmarking/tasks", () => {
  it("favorable → completed, with a parented NOT-PHI trace", async () => {
    const taskId = "test-benchmark-fav-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_PROVIDER_BENCHMARKING_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("benchmark-favorable");
    expect(body.result.metadata.agentFabric.performanceBand).toBe("top-quartile");
    expect(body.result.metadata.agentFabric.benchmarkCohortSourced).toBe(true);
    expect(body.result.metadata.agentFabric.benchmarkStatsConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.benchmarkNoAutonomousTiering).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("benchmark.receive-metric");
    expect(ops).toContain("benchmark.compute-percentile");
    expect(ops).toContain("benchmark.classify-band");
    expect(ops).toContain("benchmark.log-audit");
    const computeSpan = spans.find((s) => s.operation === "benchmark.compute-percentile");
    expect(computeSpan?.agentId).toBe("provider-benchmarking-agent");
    // NOT PHI-bearing — no phiAccessed marker anywhere.
    expect(spans.some((s) => s.attributes?.phiAccessed === true)).toBe(false);
  });

  it("review (bottom quartile) → completed, with the percentile", async () => {
    const taskId = "test-benchmark-review-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("benchmark-review");
    expect(body.result.metadata.agentFabric.percentileRank).toBe(88.89);
    expect(body.result.metadata.agentFabric.effectivePercentile).toBe(11.11);
  });

  it("quality direction inversion → completed, bottom-quartile", async () => {
    const taskId = "test-benchmark-quality-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_PROVIDER_BENCHMARKING_QUALITY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("benchmark-review");
    expect(body.result.metadata.agentFabric.performanceBand).toBe("bottom-quartile");
  });

  it("blocks a mis-sized cohort (cohort-sourced)", async () => {
    const taskId = "test-benchmark-cohort-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST,
                determination: { ...VALID_DETERMINATION, cohortSize: 14 }
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
    expect(ids).toContain("policy.benchmark.cohort-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "benchmark.compute-percentile.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "benchmark.log-audit")).toBe(false);
  });

  it("blocks an inverted percentile (stats-consistent)", async () => {
    const taskId = "test-benchmark-stats-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  percentileRank: 11.11,
                  effectivePercentile: 88.89,
                  performanceBand: "top-quartile",
                  disposition: "benchmark-favorable"
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
    expect(ids).toContain("policy.benchmark.stats-consistent");
  });

  it("blocks an autonomous tiering (no-autonomous-tiering)", async () => {
    const taskId = "test-benchmark-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_PROVIDER_BENCHMARKING_REVIEW_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresNetworkReview: false,
                  autoTiered: true
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
    expect(ids).toContain("policy.benchmark.no-autonomous-tiering");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/provider-benchmarking/tasks", {
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
      new Request("http://localhost/api/agents/provider-benchmarking/tasks", {
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
