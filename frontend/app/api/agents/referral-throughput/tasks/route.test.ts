import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_REFERRAL_THROUGHPUT_DIAMOND_REQUEST,
  DEMO_REFERRAL_THROUGHPUT_REQUEST,
  DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST,
  evaluateReferralThroughput
} from "../../../../../lib/referral-throughput";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/referral-throughput/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_REQUEST);

describe("POST /api/agents/referral-throughput/tasks", () => {
  it("bottlenecked network → completed, with a parented PHI-adjacent trace", async () => {
    const taskId = "test-rt-bottleneck-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_REFERRAL_THROUGHPUT_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("bottlenecked");
    expect(body.result.metadata.agentFabric.maxFlow).toBe(8);
    expect(body.result.metadata.agentFabric.minCutCapacity).toBe(8);
    expect(body.result.metadata.agentFabric.referralFlowSourced).toBe(true);
    expect(body.result.metadata.agentFabric.referralThroughputOptimal).toBe(true);
    expect(body.result.metadata.agentFabric.referralNoAutonomousRoute).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("referralflow.receive-network");
    expect(ops).toContain("referralflow.solve-maxflow");
    expect(ops).toContain("referralflow.classify-disposition");
    expect(ops).toContain("referralflow.log-audit");
    const solveSpan = spans.find((s) => s.operation === "referralflow.solve-maxflow");
    expect(solveSpan?.agentId).toBe("referral-throughput-agent");
    expect(solveSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("unconstrained network → completed (unconstrained)", async () => {
    const res = await POST(
      rpc({
        id: "test-rt-unconstrained-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("unconstrained");
    expect(body.result.metadata.agentFabric.maxFlow).toBe(3);
  });

  it("diamond network → completed (bottlenecked, back-edge cancellation)", async () => {
    const res = await POST(
      rpc({
        id: "test-rt-diamond-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_REFERRAL_THROUGHPUT_DIAMOND_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.maxFlow).toBe(3);
  });

  it("blocks an over-capacity flow (flow-sourced)", async () => {
    const taskId = "test-rt-sourced-block-001";
    const flows = VALID_DETERMINATION.flows.map((f, i) => (i === 0 ? { ...f, flow: f.flow + 100 } : f));
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_REFERRAL_THROUGHPUT_REQUEST,
                determination: { ...VALID_DETERMINATION, flows }
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
    expect(ids).toContain("policy.referralflow.flow-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "referralflow.plan.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "referralflow.log-audit")).toBe(false);
  });

  it("blocks a sub-maximal throughput (throughput-optimal)", async () => {
    const uncon = evaluateReferralThroughput(DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST);
    // A feasible but sub-maximal flow: push only 2 of the achievable 3 along the single path.
    const flows = uncon.flows.map((f) => ({ ...f, flow: 2 }));
    const res = await POST(
      rpc({
        id: "test-rt-optimal-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_REFERRAL_THROUGHPUT_UNCONSTRAINED_REQUEST,
                determination: { ...uncon, flows, maxFlow: 2, minCutCapacity: 2 }
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
    expect(ids).toContain("policy.referralflow.throughput-optimal");
    // Isolable: it passed sourced.
    expect(ids).not.toContain("policy.referralflow.flow-sourced");
  });

  it("blocks an autonomous routing (no-autonomous-route)", async () => {
    const res = await POST(
      rpc({
        id: "test-rt-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_REFERRAL_THROUGHPUT_REQUEST,
                determination: { ...VALID_DETERMINATION, requiresCoordinatorReview: false, autoRouted: true }
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
    expect(ids).toContain("policy.referralflow.no-autonomous-route");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/referral-throughput/tasks", {
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
      new Request("http://localhost/api/agents/referral-throughput/tasks", {
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
