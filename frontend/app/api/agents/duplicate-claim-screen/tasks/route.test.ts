import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_DUPLICATE_SCREEN_CLEAR_REQUEST,
  DEMO_DUPLICATE_SCREEN_REQUEST,
  DEMO_DUPLICATE_SCREEN_SATURATED_REQUEST,
  evaluateDuplicateScreen
} from "../../../../../lib/duplicate-claim-screen";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/duplicate-claim-screen/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateDuplicateScreen(DEMO_DUPLICATE_SCREEN_REQUEST);

describe("POST /api/agents/duplicate-claim-screen/tasks", () => {
  it("possible-duplicates batch → completed, with a parented PHI-adjacent trace", async () => {
    const taskId = "test-dcs-dups-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DUPLICATE_SCREEN_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("possible-duplicates");
    expect(body.result.metadata.agentFabric.possibleDuplicateCount).toBe(3);
    expect(body.result.metadata.agentFabric.definitelyNewCount).toBe(2);
    expect(body.result.metadata.agentFabric.dupScreenFilterSourced).toBe(true);
    expect(body.result.metadata.agentFabric.dupScreenMembershipExact).toBe(true);
    expect(body.result.metadata.agentFabric.dupScreenNoAutonomousReject).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("dupscreen.receive-batch");
    expect(ops).toContain("dupscreen.screen");
    expect(ops).toContain("dupscreen.classify-disposition");
    expect(ops).toContain("dupscreen.log-audit");
    const screenSpan = spans.find((s) => s.operation === "dupscreen.screen");
    expect(screenSpan?.agentId).toBe("duplicate-claim-screen-agent");
    expect(screenSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("all-clear batch → completed (all-clear)", async () => {
    const res = await POST(
      rpc({
        id: "test-dcs-clear-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DUPLICATE_SCREEN_CLEAR_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("all-clear");
    expect(body.result.metadata.agentFabric.possibleDuplicateCount).toBe(0);
  });

  it("saturated filter → completed (possible-duplicates, high FP)", async () => {
    const res = await POST(
      rpc({
        id: "test-dcs-saturated-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_DUPLICATE_SCREEN_SATURATED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.estimatedFalsePositiveRate).toBeGreaterThan(0.4);
  });

  it("blocks a fabricated bit array (filter-sourced)", async () => {
    const taskId = "test-dcs-sourced-block-001";
    const bits = VALID_DETERMINATION.bits.slice();
    bits[0] = bits[0] === 1 ? 0 : 1;
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DUPLICATE_SCREEN_REQUEST,
                determination: { ...VALID_DETERMINATION, bits, setBitCount: bits.reduce((s, b) => s + b, 0) }
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
    expect(ids).toContain("policy.dupscreen.filter-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "dupscreen.screen.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "dupscreen.log-audit")).toBe(false);
  });

  it("blocks a false negative (membership-exact)", async () => {
    // Report a known duplicate (CLM-88002) as definitely-new: the one failure a Bloom filter must never make.
    const results = VALID_DETERMINATION.results.map((r) =>
      r.id === "CLM-88002" ? { ...r, verdict: "definitely-new" as const } : r
    );
    const res = await POST(
      rpc({
        id: "test-dcs-exact-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DUPLICATE_SCREEN_REQUEST,
                determination: {
                  ...VALID_DETERMINATION,
                  results,
                  possibleDuplicateCount: 2,
                  definitelyNewCount: 3
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
    expect(ids).toContain("policy.dupscreen.membership-exact");
  });

  it("blocks an autonomous rejection (no-autonomous-reject)", async () => {
    const res = await POST(
      rpc({
        id: "test-dcs-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_DUPLICATE_SCREEN_REQUEST,
                determination: { ...VALID_DETERMINATION, requiresAdjudicatorReview: false, autoRejected: true }
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
    expect(ids).toContain("policy.dupscreen.no-autonomous-reject");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/duplicate-claim-screen/tasks", {
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
      new Request("http://localhost/api/agents/duplicate-claim-screen/tasks", {
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
