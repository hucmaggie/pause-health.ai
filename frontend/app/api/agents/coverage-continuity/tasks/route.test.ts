import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_COVERAGE_CONTINUITY_BREAK_REQUEST,
  DEMO_COVERAGE_CONTINUITY_OVERLAP_REQUEST,
  DEMO_COVERAGE_CONTINUITY_REQUEST
} from "../../../../../lib/coverage-continuity";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/coverage-continuity/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

describe("POST /api/agents/coverage-continuity/tasks", () => {
  it("continuous coverage → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-coverage-ok-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_COVERAGE_CONTINUITY_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("continuous");
    expect(body.result.metadata.agentFabric.spanCount).toBe(2);
    expect(body.result.metadata.agentFabric.totalCoveredDays).toBe(352);
    expect(body.result.metadata.agentFabric.hasSignificantBreak).toBe(false);
    expect(body.result.metadata.agentFabric.coverageSegmentsSourced).toBe(true);
    expect(body.result.metadata.agentFabric.coverageMathConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.coverageNoAutonomousDetermination).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("coverage.receive-segments");
    expect(ops).toContain("coverage.merge-intervals");
    expect(ops).toContain("coverage.detect-gaps");
    expect(ops).toContain("coverage.log-audit");
    const mergeSpan = spans.find((s) => s.operation === "coverage.merge-intervals");
    expect(mergeSpan?.agentId).toBe("coverage-continuity-agent");
    expect(mergeSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("significant break → completed, significant-break", async () => {
    const taskId = "test-coverage-break-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_COVERAGE_CONTINUITY_BREAK_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("significant-break");
    expect(body.result.metadata.agentFabric.hasSignificantBreak).toBe(true);
  });

  it("overlapping coverage → completed, single span", async () => {
    const taskId = "test-coverage-overlap-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_COVERAGE_CONTINUITY_OVERLAP_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.spanCount).toBe(1);
    expect(body.result.metadata.agentFabric.totalCoveredDays).toBe(366);
  });

  it("blocks a fabricated span (segments-sourced)", async () => {
    const taskId = "test-coverage-fabricated-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_COVERAGE_CONTINUITY_REQUEST,
                determination: {
                  requestRef: "cov-001",
                  memberRef: "member-4821",
                  asOfDate: "2025-01-15",
                  disposition: "continuous",
                  mergedSpans: [{ startDay: 100, endDay: 200, startDate: "x", endDate: "y", coveredDays: 101 }],
                  gaps: [],
                  totalCoveredDays: 101,
                  maxGapDays: 63,
                  hasSignificantBreak: false,
                  segments: [{ segmentId: "seg-a", source: "x", startDate: "x", endDate: "y", startDay: 300, endDay: 400 }],
                  invalidSegments: [],
                  requiresEligibilityReview: true,
                  autoDetermined: false
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
    expect(ids).toContain("policy.coverage.segments-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "coverage.detect-gaps.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "coverage.log-audit")).toBe(false);
  });

  it("blocks inconsistent coverage math (math-consistent)", async () => {
    const taskId = "test-coverage-badmath-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_COVERAGE_CONTINUITY_REQUEST,
                determination: {
                  requestRef: "cov-001",
                  memberRef: "member-4821",
                  asOfDate: "2025-01-15",
                  disposition: "continuous",
                  mergedSpans: [{ startDay: 0, endDay: 181, startDate: "x", endDate: "y", coveredDays: 182 }],
                  gaps: [],
                  totalCoveredDays: 999,
                  maxGapDays: 63,
                  hasSignificantBreak: false,
                  segments: [{ segmentId: "seg-a", source: "x", startDate: "x", endDate: "y", startDay: 0, endDay: 181 }],
                  invalidSegments: [],
                  requiresEligibilityReview: true,
                  autoDetermined: false
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
    expect(ids).toContain("policy.coverage.math-consistent");
  });

  it("blocks an autonomous coverage determination (no-autonomous-determination)", async () => {
    const taskId = "test-coverage-autodet-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_COVERAGE_CONTINUITY_REQUEST,
                determination: {
                  requestRef: "cov-001",
                  memberRef: "member-4821",
                  asOfDate: "2025-01-15",
                  disposition: "continuous",
                  mergedSpans: [{ startDay: 0, endDay: 181, startDate: "x", endDate: "y", coveredDays: 182 }],
                  gaps: [],
                  totalCoveredDays: 182,
                  maxGapDays: 63,
                  hasSignificantBreak: false,
                  segments: [{ segmentId: "seg-a", source: "x", startDate: "x", endDate: "y", startDay: 0, endDay: 181 }],
                  invalidSegments: [],
                  requiresEligibilityReview: false,
                  autoDetermined: true
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
    expect(ids).toContain("policy.coverage.no-autonomous-determination");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/coverage-continuity/tasks", {
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
      new Request("http://localhost/api/agents/coverage-continuity/tasks", {
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
