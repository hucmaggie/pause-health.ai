import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_STATUS_TIMELINE_INCOMPRESSIBLE_REQUEST,
  DEMO_STATUS_TIMELINE_STABLE_REQUEST,
  DEMO_STATUS_TIMELINE_REQUEST,
  evaluateStatusTimeline
} from "../../../../../lib/status-timeline-rle";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/status-timeline-rle/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_REQUEST);

describe("POST /api/agents/status-timeline-rle/tasks", () => {
  it("compressible stream → completed, with a parented PHI-adjacent trace", async () => {
    const taskId = "test-rle-compressible-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_STATUS_TIMELINE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("compressible");
    expect(body.result.metadata.agentFabric.runCount).toBe(5);
    expect(body.result.metadata.agentFabric.compressionRatio).toBe(3.2);
    expect(body.result.metadata.agentFabric.statusEncodingSourced).toBe(true);
    expect(body.result.metadata.agentFabric.statusRunsCanonical).toBe(true);
    expect(body.result.metadata.agentFabric.statusNoAutonomousWrite).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("statusrle.receive-stream");
    expect(ops).toContain("statusrle.encode");
    expect(ops).toContain("statusrle.classify-disposition");
    expect(ops).toContain("statusrle.log-audit");
    const encodeSpan = spans.find((s) => s.operation === "statusrle.encode");
    expect(encodeSpan?.agentId).toBe("status-timeline-rle-agent");
    expect(encodeSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("incompressible stream → completed (incompressible)", async () => {
    const res = await POST(
      rpc({
        id: "test-rle-incompressible-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_STATUS_TIMELINE_INCOMPRESSIBLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("incompressible");
    expect(body.result.metadata.agentFabric.compressionRatio).toBe(1);
  });

  it("stable stream → completed (maximal compression)", async () => {
    const res = await POST(
      rpc({
        id: "test-rle-stable-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_STATUS_TIMELINE_STABLE_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.runCount).toBe(1);
    expect(body.result.metadata.agentFabric.compressionRatio).toBe(8);
  });

  it("blocks a run list that doesn't decode (encoding-sourced)", async () => {
    const taskId = "test-rle-sourced-block-001";
    const runs = VALID_DETERMINATION.runs.map((r, i) => (i === 0 ? { ...r, length: r.length + 1 } : r));
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { request: DEMO_STATUS_TIMELINE_REQUEST, determination: { ...VALID_DETERMINATION, runs } }
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
    expect(ids).toContain("policy.statusrle.encoding-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "statusrle.encode.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "statusrle.log-audit")).toBe(false);
  });

  it("blocks an over-split (non-canonical) encoding (runs-canonical)", async () => {
    const stable = evaluateStatusTimeline(DEMO_STATUS_TIMELINE_STABLE_REQUEST);
    // occupied×8 split into ×5 + ×3: decodes correctly (passes sourced) but isn't the canonical maximal run.
    const runs = [
      { value: "occupied", length: 5 },
      { value: "occupied", length: 3 }
    ];
    const res = await POST(
      rpc({
        id: "test-rle-canonical-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_STATUS_TIMELINE_STABLE_REQUEST,
                determination: { ...stable, runs, runCount: 2, compressionRatio: 4, longestRun: 5 }
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
    expect(ids).toContain("policy.statusrle.runs-canonical");
    // Isolable: it passed sourced (it decodes correctly).
    expect(ids).not.toContain("policy.statusrle.encoding-sourced");
  });

  it("blocks an autonomous write-back (no-autonomous-write)", async () => {
    const res = await POST(
      rpc({
        id: "test-rle-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_STATUS_TIMELINE_REQUEST,
                determination: { ...VALID_DETERMINATION, requiresStewardReview: false, autoWritten: true }
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
    expect(ids).toContain("policy.statusrle.no-autonomous-write");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/status-timeline-rle/tasks", {
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
      new Request("http://localhost/api/agents/status-timeline-rle/tasks", {
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
