import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_PEAK_WINDOW_ALL_NEGATIVE_REQUEST,
  DEMO_PEAK_WINDOW_ALL_POSITIVE_REQUEST,
  DEMO_PEAK_WINDOW_REQUEST,
  evaluatePeakWindow
} from "../../../../../lib/peak-window";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/peak-window/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluatePeakWindow(DEMO_PEAK_WINDOW_REQUEST);

describe("POST /api/agents/peak-window/tasks", () => {
  it("positive window → completed, with a parented non-PHI trace", async () => {
    const taskId = "test-pw-positive-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_PEAK_WINDOW_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("positive-window");
    expect(body.result.metadata.agentFabric.windowSum).toBe(58);
    expect(body.result.metadata.agentFabric.windowLength).toBe(5);
    expect(body.result.metadata.agentFabric.peakWindowSourced).toBe(true);
    expect(body.result.metadata.agentFabric.peakWindowOptimal).toBe(true);
    expect(body.result.metadata.agentFabric.peakWindowNoAutonomousAction).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("peak.receive-series");
    expect(ops).toContain("peak.scan-max-subarray");
    expect(ops).toContain("peak.classify-disposition");
    expect(ops).toContain("peak.log-audit");
    const scanSpan = spans.find((s) => s.operation === "peak.scan-max-subarray");
    expect(scanSpan?.agentId).toBe("peak-window-agent");
    expect(scanSpan?.attributes?.phiAccessed).toBe(false);
  });

  it("all-negative series → completed (no positive window)", async () => {
    const res = await POST(
      rpc({
        id: "test-pw-negative-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_PEAK_WINDOW_ALL_NEGATIVE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("no-positive-window");
    expect(body.result.metadata.agentFabric.windowSum).toBe(-3);
  });

  it("all-positive series → completed (whole series)", async () => {
    const res = await POST(
      rpc({
        id: "test-pw-allpositive-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_PEAK_WINDOW_ALL_POSITIVE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.windowSum).toBe(25);
  });

  it("blocks a fabricated / out-of-range window (window-sourced)", async () => {
    const taskId = "test-pw-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_PEAK_WINDOW_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  // Claim the optimal sum on a range that doesn't sum to it.
                  startIndex: 0,
                  endIndex: 1,
                  windowLength: 2
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
    expect(ids).toContain("policy.peak-window.window-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "peak.scan-max-subarray.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "peak.log-audit")).toBe(false);
  });

  it("blocks a sub-optimal window (window-optimal)", async () => {
    const res = await POST(
      rpc({
        id: "test-pw-suboptimal-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_PEAK_WINDOW_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  startIndex: 9,
                  endIndex: 10,
                  windowSum: 11,
                  windowLength: 2,
                  hasPositiveWindow: true,
                  disposition: "positive-window"
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
    expect(ids).toContain("policy.peak-window.window-optimal");
  });

  it("blocks an autonomous action (no-autonomous-action)", async () => {
    const res = await POST(
      rpc({
        id: "test-pw-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_PEAK_WINDOW_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresAnalystReview: false,
                  autoActioned: true
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
    expect(ids).toContain("policy.peak-window.no-autonomous-action");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/peak-window/tasks", {
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
      new Request("http://localhost/api/agents/peak-window/tasks", {
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
