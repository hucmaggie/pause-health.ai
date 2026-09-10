import { describe, expect, it, vi } from "vitest";

import type { A2ARpcResponse, A2ATask } from "../lib/a2a";
import {
  COVERAGE_CONTINUITY_PRESETS,
  buildCoverageContinuityRequestBody,
  coverageContinuityViewFromTask,
  runCoverageContinuityTask
} from "./coverage-continuity-panel";
import { DEMO_COVERAGE_CONTINUITY_REQUEST } from "../lib/coverage-continuity";

describe("COVERAGE_CONTINUITY_PRESETS", () => {
  it("has stable ids and a demonstrates note for each preset", () => {
    expect(COVERAGE_CONTINUITY_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of COVERAGE_CONTINUITY_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.demonstrates).toBeTruthy();
    }
  });

  it("includes the three governance-block presets", () => {
    const ids = COVERAGE_CONTINUITY_PRESETS.map((p) => p.id);
    expect(ids).toContain("fabricated-span-block");
    expect(ids).toContain("bad-math-block");
    expect(ids).toContain("auto-determined-block");
  });
});

describe("buildCoverageContinuityRequestBody", () => {
  it("builds a tasks/send envelope carrying the request", () => {
    const body = buildCoverageContinuityRequestBody({
      taskId: "t1",
      personaId: "demo",
      request: DEMO_COVERAGE_CONTINUITY_REQUEST
    });
    expect(body.method).toBe("tasks/send");
    expect(body.params.id).toBe("t1");
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.request).toEqual(DEMO_COVERAGE_CONTINUITY_REQUEST);
    expect(data.determination).toBeUndefined();
  });

  it("carries a caller-asserted determination when present", () => {
    const body = buildCoverageContinuityRequestBody({
      taskId: "t2",
      determination: { autoDetermined: true }
    });
    const data = body.params.message.parts[0].data as Record<string, unknown>;
    expect(data.determination).toEqual({ autoDetermined: true });
  });
});

function okResponse(task: A2ATask): Response {
  const payload: A2ARpcResponse<A2ATask> = { jsonrpc: "2.0", id: "x", result: task };
  return {
    ok: true,
    status: 200,
    json: async () => payload
  } as unknown as Response;
}

describe("runCoverageContinuityTask", () => {
  it("POSTs to the coverage-continuity route and returns the task", async () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() }
    };
    const fetchImpl = vi.fn(async () => okResponse(task));
    const out = await runCoverageContinuityTask(
      { taskId: "t", request: DEMO_COVERAGE_CONTINUITY_REQUEST },
      fetchImpl as unknown as typeof fetch
    );
    expect(out.id).toBe("t");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/agents/coverage-continuity/tasks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    await expect(
      runCoverageContinuityTask({ taskId: "t" }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow("HTTP 400");
  });
});

describe("coverageContinuityViewFromTask", () => {
  it("lifts a resolved determination from a completed task", () => {
    const task: A2ATask = {
      id: "t",
      status: { state: "completed", timestamp: new Date().toISOString() },
      artifacts: [
        {
          name: "CoverageContinuityDetermination",
          index: 0,
          parts: [
            {
              type: "data",
              data: {
                result: {
                  requestRef: "cov-001",
                  determination: {
                    requestRef: "cov-001",
                    memberRef: "member-4821",
                    asOfDate: "2025-01-15",
                    disposition: "continuous",
                    mergedSpans: [
                      { startDay: 0, endDay: 181, startDate: "2024-01-01", endDate: "2024-06-30", coveredDays: 182 }
                    ],
                    gaps: [],
                    totalCoveredDays: 182,
                    maxGapDays: 63,
                    hasSignificantBreak: false,
                    segments: [],
                    invalidSegments: [],
                    reason: "ok",
                    note: "note"
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
          traceTaskId: "trace-1",
          coverageSegmentsSourced: true,
          coverageMathConsistent: true,
          coverageNoAutonomousDetermination: true
        }
      }
    };
    const view = coverageContinuityViewFromTask(task);
    expect(view.kind).toBe("resolved");
    if (view.kind === "resolved") {
      expect(view.disposition).toBe("continuous");
      expect(view.mergedSpans).toHaveLength(1);
      expect(view.totalCoveredDays).toBe(182);
      expect(view.traceTaskId).toBe("trace-1");
    }
  });

  it("lifts a blocked view from a failed task with a fabric block", () => {
    const task: A2ATask = {
      id: "t",
      status: {
        state: "failed",
        timestamp: new Date().toISOString(),
        message: { role: "agent", parts: [{ type: "text", text: "blocked" }] }
      },
      metadata: {
        agentFabric: {
          decision: "block",
          policiesEvaluated: ["policy.coverage.math-consistent"],
          violations: [{ policyId: "policy.coverage.math-consistent", reason: "miscounted total" }]
        }
      }
    };
    const view = coverageContinuityViewFromTask(task);
    expect(view.kind).toBe("blocked");
    if (view.kind === "blocked") {
      expect(view.violations[0].policyId).toBe("policy.coverage.math-consistent");
      expect(view.policiesEvaluated).toContain("policy.coverage.math-consistent");
    }
  });
});
