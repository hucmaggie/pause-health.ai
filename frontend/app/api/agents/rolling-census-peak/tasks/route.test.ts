import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_ROLLING_CENSUS_SPIKE_REQUEST,
  DEMO_ROLLING_CENSUS_WITHIN_REQUEST,
  DEMO_ROLLING_CENSUS_REQUEST,
  evaluateRollingCensus
} from "../../../../../lib/rolling-census-peak";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/rolling-census-peak/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateRollingCensus(DEMO_ROLLING_CENSUS_REQUEST);

describe("POST /api/agents/rolling-census-peak/tasks", () => {
  it("over-capacity unit → completed, with a parented PHI-adjacent trace", async () => {
    const taskId = "test-rc-over-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ROLLING_CENSUS_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("over-capacity");
    expect(body.result.metadata.agentFabric.peakCensus).toBe(20);
    expect(body.result.metadata.agentFabric.overCapacityCount).toBe(4);
    expect(body.result.metadata.agentFabric.censusWindowsSourced).toBe(true);
    expect(body.result.metadata.agentFabric.censusDequeExact).toBe(true);
    expect(body.result.metadata.agentFabric.censusNoAutonomousDivert).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("rollingcensus.receive-readings");
    expect(ops).toContain("rollingcensus.peak");
    expect(ops).toContain("rollingcensus.classify-disposition");
    expect(ops).toContain("rollingcensus.log-audit");
    const peakSpan = spans.find((s) => s.operation === "rollingcensus.peak");
    expect(peakSpan?.agentId).toBe("rolling-census-peak-agent");
    expect(peakSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("within-capacity unit → completed (within-capacity)", async () => {
    const res = await POST(
      rpc({
        id: "test-rc-within-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ROLLING_CENSUS_WITHIN_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("within-capacity");
    expect(body.result.metadata.agentFabric.overCapacityCount).toBe(0);
  });

  it("spike unit → completed (over-capacity)", async () => {
    const res = await POST(
      rpc({
        id: "test-rc-spike-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_ROLLING_CENSUS_SPIKE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.peakCensus).toBe(12);
  });

  it("blocks a fabricated window max (windows-sourced)", async () => {
    const taskId = "test-rc-sourced-block-001";
    const windowMaxes = VALID_DETERMINATION.windowMaxes.map((m, i) => (i === 0 ? m + 5 : m));
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { request: DEMO_ROLLING_CENSUS_REQUEST, determination: { ...VALID_DETERMINATION, windowMaxes } }
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
    expect(ids).toContain("policy.rollingcensus.windows-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "rollingcensus.peak.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "rollingcensus.log-audit")).toBe(false);
  });

  it("blocks a maxima array the deque wouldn't produce (deque-exact)", async () => {
    const windowMaxes = VALID_DETERMINATION.windowMaxes.map((m, i) => (i === 5 ? m + 1 : m));
    const res = await POST(
      rpc({
        id: "test-rc-exact-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { request: DEMO_ROLLING_CENSUS_REQUEST, determination: { ...VALID_DETERMINATION, windowMaxes } }
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
    expect(ids).toContain("policy.rollingcensus.deque-exact");
  });

  it("blocks an autonomous diversion (no-autonomous-divert)", async () => {
    const res = await POST(
      rpc({
        id: "test-rc-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_ROLLING_CENSUS_REQUEST,
                determination: { ...VALID_DETERMINATION, requiresSupervisorReview: false, autoDiverted: true }
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
    expect(ids).toContain("policy.rollingcensus.no-autonomous-divert");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/rolling-census-peak/tasks", {
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
      new Request("http://localhost/api/agents/rolling-census-peak/tasks", {
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
