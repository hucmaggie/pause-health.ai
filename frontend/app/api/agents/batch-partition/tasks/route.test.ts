import { describe, expect, it } from "vitest";

import { POST } from "./route";
import {
  DEMO_BATCH_PARTITION_EVEN_REQUEST,
  DEMO_BATCH_PARTITION_ITEMBOUND_REQUEST,
  DEMO_BATCH_PARTITION_REQUEST,
  evaluateBatchPartition
} from "../../../../../lib/batch-partition";

function rpc(params: unknown) {
  return new Request("http://localhost/api/agents/batch-partition/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "tasks/send", params })
  });
}

/** A valid, produced determination over the demo — the block base. */
const VALID_DETERMINATION = evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST);

describe("POST /api/agents/batch-partition/tasks", () => {
  it("divisible backlog → completed, with a parented PHI-adjacent trace", async () => {
    const taskId = "test-bp-divisible-001";
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_BATCH_PARTITION_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.decision).toBe("allow");
    expect(body.result.metadata.agentFabric.disposition).toBe("divisible");
    expect(body.result.metadata.agentFabric.maxBatchLoad).toBe(10);
    expect(body.result.metadata.agentFabric.totalWeight).toBe(24);
    expect(body.result.metadata.agentFabric.batchPartitionSourced).toBe(true);
    expect(body.result.metadata.agentFabric.batchPartitionLoadOptimal).toBe(true);
    expect(body.result.metadata.agentFabric.batchPartitionNoAutonomousAssign).toBe(true);

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    const ops = spans.map((s) => s.operation);
    expect(ops).toContain("batchpartition.receive-worklist");
    expect(ops).toContain("batchpartition.partition");
    expect(ops).toContain("batchpartition.classify-disposition");
    expect(ops).toContain("batchpartition.log-audit");
    const partitionSpan = spans.find((s) => s.operation === "batchpartition.partition");
    expect(partitionSpan?.agentId).toBe("batch-partition-agent");
    expect(partitionSpan?.attributes?.phiAccessed).toBe(true);
  });

  it("item-bound worklist → completed (item-bound)", async () => {
    const res = await POST(
      rpc({
        id: "test-bp-itembound-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_BATCH_PARTITION_ITEMBOUND_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.disposition).toBe("item-bound");
    expect(body.result.metadata.agentFabric.maxBatchLoad).toBe(20);
  });

  it("even worklist → completed (perfectly balanced)", async () => {
    const res = await POST(
      rpc({
        id: "test-bp-even-001",
        message: {
          role: "user",
          parts: [{ type: "data", data: { request: DEMO_BATCH_PARTITION_EVEN_REQUEST } }]
        }
      })
    );
    const body = await res.json();
    expect(body.result.status.state).toBe("completed");
    expect(body.result.metadata.agentFabric.maxBatchLoad).toBe(8);
  });

  it("blocks a reordered cover (partition-sourced)", async () => {
    const taskId = "test-bp-sourced-block-001";
    // Swap the batch order: the concatenation no longer reproduces the submitted item sequence,
    // but the batch loads (and thus maxBatchLoad = 10) are unchanged and still optimal.
    const batches = [VALID_DETERMINATION.batches[1], VALID_DETERMINATION.batches[0], VALID_DETERMINATION.batches[2]];
    const res = await POST(
      rpc({
        id: taskId,
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: { request: DEMO_BATCH_PARTITION_REQUEST, determination: { ...VALID_DETERMINATION, batches } }
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
    expect(ids).toContain("policy.batchpartition.partition-sourced");

    const { listTraces } = await import("../../../../../lib/agent-fabric");
    const spans = listTraces({ taskId });
    expect(spans.some((s) => s.operation === "batchpartition.partition.blocked")).toBe(true);
    expect(spans.some((s) => s.operation === "batchpartition.log-audit")).toBe(false);
  });

  it("blocks a sub-optimal split (load-optimal)", async () => {
    // A valid, order-preserving cover that is NOT optimal: [5,2,4] | [3,6] | [4] → peak 11 (optimum is 10).
    const items = VALID_DETERMINATION.items;
    const batches = [
      { items: items.slice(0, 3), load: 11 },
      { items: items.slice(3, 5), load: 9 },
      { items: items.slice(5, 6), load: 4 }
    ];
    const res = await POST(
      rpc({
        id: "test-bp-optimal-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_BATCH_PARTITION_REQUEST,
                determination: { ...VALID_DETERMINATION, batches, maxBatchLoad: 11 }
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
    expect(ids).toContain("policy.batchpartition.load-optimal");
  });

  it("blocks an autonomous assignment (no-autonomous-assign)", async () => {
    const res = await POST(
      rpc({
        id: "test-bp-auto-block-001",
        message: {
          role: "user",
          parts: [
            {
              type: "data",
              data: {
                request: DEMO_BATCH_PARTITION_REQUEST,
                determination: { ...VALID_DETERMINATION, requiresSupervisorReview: false, autoAssigned: true }
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
    expect(ids).toContain("policy.batchpartition.no-autonomous-assign");
  });

  it("rejects a malformed envelope with -32600", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/batch-partition/tasks", {
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
      new Request("http://localhost/api/agents/batch-partition/tasks", {
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
