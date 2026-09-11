import { describe, expect, it } from "vitest";

import {
  DEMO_BATCH_PARTITION_EVEN_REQUEST,
  DEMO_BATCH_PARTITION_ITEMBOUND_REQUEST,
  DEMO_BATCH_PARTITION_REQUEST,
  batchPartitionSummary,
  evaluateBatchPartition,
  noAutonomousAssign,
  optimalMaxLoad,
  partitionItems,
  partitionOptimal,
  partitionSourced
} from "./batch-partition";

describe("optimalMaxLoad", () => {
  it("is the minimal achievable peak load via binary search on the answer", () => {
    expect(optimalMaxLoad([5, 2, 4, 3, 6, 4], 3)).toBe(10);
    expect(optimalMaxLoad([2, 3, 20, 4, 1], 3)).toBe(20);
    expect(optimalMaxLoad([4, 4, 4, 4], 2)).toBe(8);
  });

  it("equals the total for a single batch and the heaviest item for one-per-batch", () => {
    expect(optimalMaxLoad([5, 2, 4, 3, 6, 4], 1)).toBe(24);
    expect(optimalMaxLoad([5, 2, 4, 3, 6, 4], 6)).toBe(6);
  });

  it("is 0 for an empty worklist", () => {
    expect(optimalMaxLoad([], 3)).toBe(0);
  });
});

describe("partitionItems", () => {
  it("produces a canonical leftmost-tight optimal split", () => {
    const batches = partitionItems(DEMO_BATCH_PARTITION_REQUEST.items, 3);
    expect(batches.map((b) => b.items.map((i) => i.weight))).toEqual([[5], [2, 4, 3], [6, 4]]);
    expect(batches.map((b) => b.load)).toEqual([5, 9, 10]);
  });

  it("isolates a dominant item into its own batch", () => {
    const batches = partitionItems(DEMO_BATCH_PARTITION_ITEMBOUND_REQUEST.items, 3);
    expect(batches.map((b) => b.items.map((i) => i.weight))).toEqual([[2, 3], [20], [4, 1]]);
  });

  it("returns empty for no items", () => {
    expect(partitionItems([], 3)).toEqual([]);
  });
});

describe("evaluateBatchPartition", () => {
  it("classifies a divisible backlog", () => {
    const d = evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST);
    expect(d.maxBatchLoad).toBe(10);
    expect(d.maxItemWeight).toBe(6);
    expect(d.totalWeight).toBe(24);
    expect(d.batchCount).toBe(3);
    expect(d.disposition).toBe("divisible");
    expect(d.requiresSupervisorReview).toBe(true);
    expect(d.autoAssigned).toBe(false);
  });

  it("classifies an item-bound worklist", () => {
    const d = evaluateBatchPartition(DEMO_BATCH_PARTITION_ITEMBOUND_REQUEST);
    expect(d.maxBatchLoad).toBe(20);
    expect(d.maxItemWeight).toBe(20);
    expect(d.disposition).toBe("item-bound");
  });

  it("splits an even worklist into perfectly balanced batches", () => {
    const d = evaluateBatchPartition(DEMO_BATCH_PARTITION_EVEN_REQUEST);
    expect(d.maxBatchLoad).toBe(8);
    expect(d.batches.map((b) => b.load)).toEqual([8, 8]);
    expect(d.disposition).toBe("divisible");
  });

  it("is deterministic", () => {
    expect(evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST)).toEqual(
      evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST)
    );
  });
});

describe("partitionSourced", () => {
  it("is true for each demo partition", () => {
    expect(partitionSourced(evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST))).toBe(true);
    expect(partitionSourced(evaluateBatchPartition(DEMO_BATCH_PARTITION_ITEMBOUND_REQUEST))).toBe(true);
    expect(partitionSourced(evaluateBatchPartition(DEMO_BATCH_PARTITION_EVEN_REQUEST))).toBe(true);
  });

  it("is false for a reordered cover (isolated from load-optimal)", () => {
    const d = evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST);
    // Swap the batch order: the concatenation no longer reproduces the submitted item sequence,
    // but the batch loads (and thus maxBatchLoad = 10) are unchanged and still optimal.
    const batches = [d.batches[1], d.batches[0], d.batches[2]];
    const tampered = { ...d, batches };
    expect(partitionSourced(tampered)).toBe(false);
    expect(partitionOptimal(tampered)).toBe(true);
  });

  it("is false for a dishonest batch load", () => {
    const d = evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST);
    const batches = d.batches.map((b, i) => (i === 0 ? { ...b, load: b.load + 1 } : b));
    expect(partitionSourced({ ...d, batches })).toBe(false);
  });

  it("is false for a dropped item", () => {
    const d = evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST);
    const batches = d.batches.map((b, i) =>
      i === 1 ? { items: b.items.slice(1), load: b.items.slice(1).reduce((a, it) => a + it.weight, 0) } : b
    );
    expect(partitionSourced({ ...d, batches })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(partitionSourced(null)).toBe(false);
  });
});

describe("partitionOptimal", () => {
  it("is true for each demo partition", () => {
    expect(partitionOptimal(evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST))).toBe(true);
    expect(partitionOptimal(evaluateBatchPartition(DEMO_BATCH_PARTITION_ITEMBOUND_REQUEST))).toBe(true);
  });

  it("is false for a sub-optimal split (while partition-sourced stays true)", () => {
    const d = evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST);
    // A valid, order-preserving cover that is NOT optimal: [5,2,4] | [3,6] | [4] → peak 11 (optimum is 10).
    const items = d.items;
    const batches = [
      { items: items.slice(0, 3), load: 11 },
      { items: items.slice(3, 5), load: 9 },
      { items: items.slice(5, 6), load: 4 }
    ];
    const tampered = { ...d, batches, maxBatchLoad: 11 };
    expect(partitionSourced(tampered)).toBe(true);
    expect(partitionOptimal(tampered)).toBe(false);
  });

  it("is false for an understated peak load", () => {
    const d = evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST);
    expect(partitionOptimal({ ...d, maxBatchLoad: 9 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(partitionOptimal(undefined)).toBe(false);
  });
});

describe("noAutonomousAssign", () => {
  it("is true for a produced partition", () => {
    expect(noAutonomousAssign(evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST))).toBe(true);
  });

  it("is false when auto-assigned", () => {
    const d = evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST);
    expect(noAutonomousAssign({ ...d, autoAssigned: true as unknown as false })).toBe(false);
  });

  it("is false when supervisor review is skipped", () => {
    const d = evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST);
    expect(noAutonomousAssign({ ...d, requiresSupervisorReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousAssign(null)).toBe(false);
  });
});

describe("batchPartitionSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateBatchPartition(DEMO_BATCH_PARTITION_REQUEST);
    expect(batchPartitionSummary(d)).toEqual({
      worklistRef: "chart-review-backlog-2231",
      disposition: "divisible",
      itemCount: 6,
      batchCount: 3,
      maxBatchLoad: 10,
      totalWeight: 24,
      requiresSupervisorReview: true,
      synthetic: true
    });
  });
});
