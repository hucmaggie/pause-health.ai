import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_QUALITY_SHIFT_DOWN_REQUEST,
  DEMO_QUALITY_SHIFT_IN_CONTROL_REQUEST,
  DEMO_QUALITY_SHIFT_REQUEST,
  evaluateQualityShift
} from "../../../../../lib/quality-shift";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/quality-shift/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the shift-up demo — the block base. */
const VALID_DETERMINATION = evaluateQualityShift(DEMO_QUALITY_SHIFT_REQUEST);

describe("POST /api/agents/quality-shift/tasks", () => {
  it("shift-up → completed, with a parented PHI-bearing trace", async () => {
    const taskId = "test-qs-up-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_QUALITY_SHIFT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.signal).toBe("shift-up-detected");
    expect(body.result.metadata.agentFabric.alarmIndex).toBe(5);
    expect(body.result.metadata.agentFabric.qualityObservationsSourced).toBe(true);
    expect(body.result.metadata.agentFabric.qualityCusumConsistent).toBe(true);
    expect(body.result.metadata.agentFabric.qualityNoAutonomousIntervention).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("quality.receive-series");
    expect(ops).toContain("quality.run-cusum");
    expect(ops).toContain("quality.classify-signal");
    expect(ops).toContain("quality.log-audit");
    const cusumSpan = spans.find((s) => s.operation === "quality.run-cusum");
    expect(cusumSpan?.agentId).toBe("quality-shift-agent");
    expect(cusumSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("in-control → completed", async () => {
    const taskId = "test-qs-incontrol-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_QUALITY_SHIFT_IN_CONTROL_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.signal).toBe("in-control");
    expect(body.result.metadata.agentFabric.alarmIndex).toBe(-1);
  });

  it("shift-down → completed", async () => {
    const taskId = "test-qs-down-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_QUALITY_SHIFT_DOWN_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.signal).toBe("shift-down-detected");
  });

  it("blocks a phantom point (observations-sourced)", async () => {
    const taskId = "test-qs-phantom-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_QUALITY_SHIFT_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  points: [
                    ...VALID_DETERMINATION.points,
                    { index: 7, value: 99, cusumHigh: 0, cusumLow: 0, alarm: false }
                  ]
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
    expect(ids).toContain("policy.quality.observations-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "quality.run-cusum.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "quality.log-audit")).toBe(false);
  });

  it("blocks a mis-charted CUSUM (cusum-consistent)", async () => {
    const taskId = "test-qs-mischart-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_QUALITY_SHIFT_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  points: VALID_DETERMINATION.points.map((p) =>
                    p.index === 5 ? { ...p, cusumHigh: 3 } : p
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
    expect(ids).toContain("policy.quality.cusum-consistent");
  });

  it("blocks an autonomous intervention (no-autonomous-intervention)", async () => {
    const taskId = "test-qs-auto-block-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_QUALITY_SHIFT_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  requiresQualityReview: false,
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
    expect(ids).toContain("policy.quality.no-autonomous-intervention");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/quality-shift/tasks", {
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
      new Request("http://localhost/api/agents/quality-shift/tasks", {
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
