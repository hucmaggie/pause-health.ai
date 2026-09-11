import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_HUFFMAN_REQUEST,
  DEMO_HUFFMAN_SKEWED_REQUEST,
  DEMO_HUFFMAN_UNIFORM_REQUEST,
  evaluateHuffman
} from "../../../../../lib/huffman-coding";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/huffman-coding/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateHuffman(DEMO_HUFFMAN_REQUEST);

describe("POST /api/agents/huffman-coding/tasks", () => {
  it("compressible stream → completed, with a parented non-PHI trace", async () => {
    const taskId = "test-hc-compress-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_HUFFMAN_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("compressible");
    expect(body.result.metadata.agentFabric.weightedTotal).toBe(178);
    expect(body.result.metadata.agentFabric.huffCodeSourced).toBe(true);
    expect(body.result.metadata.agentFabric.huffCodeOptimal).toBe(true);
    expect(body.result.metadata.agentFabric.huffCodeNoAutonomousDeploy).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("huffcode.receive-symbols");
    expect(ops).toContain("huffcode.build-code");
    expect(ops).toContain("huffcode.classify-disposition");
    expect(ops).toContain("huffcode.log-audit");
    const buildSpan = spans.find((s) => s.operation === "huffcode.build-code");
    expect(buildSpan?.agentId).toBe("huffman-coding-agent");
    expect(buildSpan?.attributes?.phiAccessed).toBe(false);
  });

  it("uniform stream → completed (already-uniform)", async () => {
    const res = await POST(
      rpc({
        id: "test-hc-uniform-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_HUFFMAN_UNIFORM_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("already-uniform");
  });

  it("heavily-skewed stream → completed (compressible)", async () => {
    const res = await POST(
      rpc({
        id: "test-hc-skewed-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_HUFFMAN_SKEWED_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.weightedTotal).toBe(130);
  });

  it("blocks a non-prefix-free code (code-sourced)", async () => {
    const taskId = "test-hc-prefix-block-001";
    const codes = [
      { symbol: "heartbeat", code: "0", length: 1, frequency: 50 },
      { symbol: "reading-normal", code: "01", length: 2, frequency: 30 },
      { symbol: "reading-high", code: "110", length: 3, frequency: 12 },
      { symbol: "battery-low", code: "1110", length: 4, frequency: 5 },
      { symbol: "sync-error", code: "1111", length: 4, frequency: 3 }
    ];
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            { type: "data", data: { request: DEMO_HUFFMAN_REQUEST, determination: { ...VALID_DETERMINATION, codes } } }
          ]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("failed");
    const ids = body.result.metadata.agentFabric.violations.map(
      (v: { policyId: string }) => v.policyId
    );
    expect(ids).toContain("policy.huffcode.code-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "huffcode.build-code.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "huffcode.log-audit")).toBe(false);
  });

  it("blocks a sub-optimal code (code-optimal)", async () => {
    const skewed = evaluateHuffman(DEMO_HUFFMAN_SKEWED_REQUEST);
    const codes = [
      { symbol: "ack", code: "00", length: 2, frequency: 80 },
      { symbol: "nack", code: "01", length: 2, frequency: 10 },
      { symbol: "retry", code: "10", length: 2, frequency: 6 },
      { symbol: "drop", code: "11", length: 2, frequency: 4 }
    ];
    const res = await POST(
      rpc({
        id: "test-hc-suboptimal-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_HUFFMAN_SKEWED_REQUEST,
                determination: { ...skewed, codes, weightedTotal: 200, disposition: "already-uniform" }
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
    expect(ids).toContain("policy.huffcode.code-optimal");
  });

  it("blocks an autonomous deploy (no-autonomous-deploy)", async () => {
    const res = await POST(
      rpc({
        id: "test-hc-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_HUFFMAN_REQUEST,
                determination: { ...VALID_DETERMINATION, requiresEngineerReview: false, autoDeployed: true }
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
    expect(ids).toContain("policy.huffcode.no-autonomous-deploy");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/huffman-coding/tasks", {
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
      new Request("http://localhost/api/agents/huffman-coding/tasks", {
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
