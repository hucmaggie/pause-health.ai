import { describe, expect, it, vi } from "vitest";

import type { A2ATask } from "../lib/a2a";
import {
  PROVIDER_BENCHMARKING_PRESETS,
  buildProviderBenchmarkingRequestBody,
  providerBenchmarkingViewFromTask,
  runProviderBenchmarkingTask
} from "./provider-benchmarking-panel";

describe("PROVIDER_BENCHMARKING_PRESETS", () => {
  it("has the three finding presets and the three governance-block presets", () => {
    const ids = PROVIDER_BENCHMARKING_PRESETS.map((p) => p.id);
    expect(ids).toContain("favorable");
    expect(ids).toContain("review");
    expect(ids).toContain("quality");
    expect(ids).toContain("mis-sized-cohort-block");
    expect(ids).toContain("miscomputed-stats-block");
    expect(ids).toContain("auto-tiered-block");
  });

  it("attaches an asserted determination only to the block presets", () => {
    for (const p of PROVIDER_BENCHMARKING_PRESETS) {
      if (p.id.endsWith("-block")) expect(p.determination).toBeDefined();
      else expect(p.determination).toBeUndefined();
    }
  });
});

describe("buildProviderBenchmarkingRequestBody", () => {
  it("builds a tasks/send envelope with a request", () => {
    const body = buildProviderBenchmarkingRequestBody({
      taskId: "t-1",
      personaId: "demo",
      request: {
        benchmarkRef: "b",
        providerRef: "p",
        metricName: "m",
        metricDirection: "lower-is-better",
        targetValue: 900,
        cohort: [{ providerId: "x", value: 1000 }]
      }
    });
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t-1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect((data.request as { targetValue: number }).targetValue).toBe(900);
    expect(data.determination).toBeUndefined();
  });

  it("includes an asserted determination when supplied", () => {
    const body = buildProviderBenchmarkingRequestBody({
      taskId: "t-2",
      determination: { disposition: "benchmark-favorable" }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ disposition: "benchmark-favorable" });
  });
});

describe("runProviderBenchmarkingTask", () => {
  it("POSTs and returns the A2A task result", async () => {
    const task: A2ATask = {
      id: "t-9",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } }
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t-9", result: task }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    const result = await runProviderBenchmarkingTask({ taskId: "t-9" }, fetchImpl);
    expect(result.id).toBe("t-9");
  });

  it("throws on an RPC error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "t", error: { code: -32600, message: "bad" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ) as unknown as typeof fetch;
    await expect(runProviderBenchmarkingTask({ taskId: "t" }, fetchImpl)).rejects.toThrow("bad");
  });
});

describe("providerBenchmarkingViewFromTask", () => {
  it("lifts a resolved view from a completed task", () => {
    const task: A2ATask = {
      id: "t-1",
      status: { state: "completed", timestamp: "now", message: { role: "agent", parts: [] } },
      artifacts: [
        {
          name: "ProviderBenchmarkingDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  benchmarkRef: "bmk-002",
                  determination: {
                    benchmarkRef: "bmk-002",
                    providerRef: "prov-target-high",
                    metricName: "risk-adjusted-cost-per-episode",
                    metricDirection: "lower-is-better",
                    targetValue: 1450,
                    disposition: "benchmark-review",
                    percentileRank: 88.89,
                    effectivePercentile: 11.11,
                    performanceBand: "bottom-quartile",
                    median: 1150,
                    cohortSize: 9,
                    reason: "r",
                    note: "n"
                  }
                }
              }
            }
          ]
        }
      ],
      metadata: {
        agentFabric: {
          decision: "allow",
          traceTaskId: "t-1",
          benchmarkCohortSourced: true,
          benchmarkStatsConsistent: true,
          benchmarkNoAutonomousTiering: true
        }
      }
    };
    const view = providerBenchmarkingViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("benchmark-review");
      expect(view.percentileRank).toBe(88.89);
      expect(view.performanceBand).toBe("bottom-quartile");
      expect(view.benchmarkCohortSourced).toBe(true);
    }
  });

  it("lifts a blocked view from a governance block", () => {
    const task: A2ATask = {
      id: "t-2",
      status: {
        state: "failed",
        timestamp: "now",
        message: { role: "agent", parts: [{ type: "text", text: "blocked" }] }
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: ["policy.benchmark.stats-consistent"],
          violations: [{ policyId: "policy.benchmark.stats-consistent", reason: "bad math" }],
          traceTaskId: "t-2"
        }
      }
    };
    const view = providerBenchmarkingViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.benchmark.stats-consistent");
    }
  });

  it("lifts an invalid view from a non-block failure", () => {
    const task: A2ATask = {
      id: "t-3",
      status: {
        state: "failed",
        timestamp: "now",
        message: { role: "agent", parts: [{ type: "text", text: "nope" }] }
      },
      metadata: { agentFabric: { decision: "invalid", traceTaskId: "t-3" } }
    };
    const view = providerBenchmarkingViewFromTask(task);
    expect(view.kind).toBe("invalid");
  });
});
