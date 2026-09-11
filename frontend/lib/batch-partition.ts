/**
 * Chart Review Batch Partitioning / Linear Partition (Binary-Search-on-Answer) — the deterministic,
 * transparent care-coordination layer that, given a CHRONOLOGICALLY / PRIORITY-ORDERED clinical review
 * worklist — each item carrying an effort WEIGHT (estimated review minutes / complexity points) — and a
 * number of reviewers k, splits the worklist into k CONTIGUOUS batches (order preserved: no item jumps its
 * neighbours) that MINIMIZE the busiest reviewer's load (the maximum batch weight), reporting the batch
 * boundaries, each batch's load, and the minimal achievable peak load — without ever assigning a reviewer or
 * dispatching the work on its own. A supervisor confirms.
 *
 * Deterministic, dependency-free domain core the Batch Partition agent (app/api/agents/batch-partition) wraps —
 * a workload-partitioning agent on the care-coordination plane of Pause's Agent Fabric. CRUCIALLY, this is NOT
 * the Caseload Balancing agent's WORST-FIT-DECREASING BIN-PACKING (which reorders members by descending acuity
 * and greedily drops each into the emptiest bin — an UNORDERED heuristic assignment) and NOT the Peak-Window
 * agent's KADANE MAXIMUM-SUBARRAY (which finds one best contiguous window, not a k-way split). It is also
 * UNLIKE the Huffman agent's OPTIMAL PREFIX CODING, the List Reconciliation agent's LONGEST COMMON SUBSEQUENCE,
 * the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, the Care Routing agent's DIJKSTRA'S SHORTEST
 * PATH, the Outreach agent's 0/1 KNAPSACK, the PCP Matching agent's GALE–SHAPLEY STABLE MATCHING, the
 * Scheduling agent's INTERVAL SELECTION, or the Household Composition agent's UNION-FIND. The heart of this
 * service is the LINEAR PARTITION PROBLEM solved by BINARY SEARCH ON THE ANSWER: the minimal feasible peak
 * load lies between the single heaviest item and the total weight; a greedy feasibility test (how many
 * contiguous batches does a candidate cap require?) is monotonic in the cap, so binary search converges on the
 * exact minimal maximum. The split itself is reconstructed by an order-preserving DP. The minimal peak load is
 * provably optimal — no contiguous k-way split achieves a smaller maximum — and it is the invariant this
 * service reports and defends.
 *
 *   Inbound:  a BatchPartitionRequest { worklistRef, items[], batchCount }  (items ordered; batchCount = k)
 *   Outbound: a BatchPartitionDetermination { batches[], maxBatchLoad, maxItemWeight, totalWeight, disposition,
 *             requiresSupervisorReview:true, autoAssigned:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the partition is sourced and self-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  A partition is trustworthy only if it is a REAL, self-consistent accounting of the submitted worklist: the
 *  batches, concatenated IN ORDER, must reproduce EXACTLY the submitted items (same labels, same weights, same
 *  sequence — no item dropped, added, reordered, or split across batches), there must be exactly `batchCount`
 *  NON-EMPTY contiguous batches, each batch's reported load must equal the sum of its items' weights, the
 *  reported maxBatchLoad must equal the largest batch load, maxItemWeight and totalWeight must be honest, and
 *  the disposition must follow. A fabricated batch, a reordered cover, or an overstated load corrupts the
 *  partition. partitionSourced() verifies it; the Agent Fabric enforces it via policy.batchpartition.partition-
 *  sourced. It does NOT recompute the optimal split — that is the optimality gate's job — so the two are
 *  isolable. (The sourced + self-consistency gate — mirrors the Huffman Agent's code-sourced and the List
 *  Reconciliation Agent's diff-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the partition is the optimal (minimal peak load).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running the linear-partition solver over the submitted weights and batchCount must reproduce the reported
 *  maxBatchLoad (and disposition). A sub-optimal split leaves one reviewer overloaded while others idle — the
 *  whole point of the balancing. partitionOptimal() recomputes the minimal achievable peak load by BINARY
 *  SEARCH ON THE ANSWER INDEPENDENT of the reported batches (it recomputes the scalar optimum from the weights
 *  + batchCount, not from the reported cover — different optimal splits can achieve the same minimal maximum),
 *  so a fabricated cover that still reports the optimal peak load fails sourced only, and a real-but-sub-optimal
 *  split fails optimal only — the two gates are isolable. The Agent Fabric enforces it via
 *  policy.batchpartition.load-optimal. (The load-bearing correctness gate — mirrors the Huffman Agent's
 *  code-optimal and the Care Routing Agent's route-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous assignment.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent PARTITIONS on paper — it never assigns a named reviewer to a batch or dispatches the worklist on
 *  its own (each is a staffing action that must be authorized); every partition is a RECOMMENDATION requiring a
 *  supervisor to confirm. noAutonomousAssign() reports the honest signal the Agent Fabric enforces via
 *  policy.batchpartition.no-autonomous-assign. (Mirrors the Huffman Agent's no-autonomous-deploy and the SLA
 *  Worklist Agent's no-autonomous-dispatch — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A partition — divisible or item-bound — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresSupervisorReview:true, autoAssigned:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (a fabricated / reordered cover, a sub-optimal split, or an autonomous assignment) —
 *  which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified staffing / workforce-management system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real reviewer scheduling weighs skills, certifications, shift rules, breaks, and fatigue — not a bare
 *  contiguous split by an effort number. This partitions the supplied illustrative weights only. TIME IS DATA:
 *  the weights are plain numbers and the partition is a pure function of them (no clock, no randomness), so the
 *  same request always yields the same determination, which is what lets the demo, the seeded trace, and the
 *  tests agree. The worklist is a clearly-labeled ILLUSTRATIVE synthetic. The item labels reference charts /
 *  encounters, so a partition is treated as PHI-adjacent and the agent is on the HIPAA audit path.
 */

/** One review-worklist item + its effort weight (estimated review minutes / complexity points). */
export type BatchItem = {
  label: string;
  /** Effort weight. Non-negative. */
  weight: number;
};

/** A request: one ordered worklist + the number of reviewers (batches) to split it across. */
export type BatchPartitionRequest = {
  worklistRef: string;
  /** The worklist, in its fixed order (chronological / priority). */
  items: BatchItem[];
  /** Number of contiguous batches (reviewers) to split across. */
  batchCount: number;
};

export type BatchPartitionDisposition = "divisible" | "item-bound";

/** One contiguous batch of the partition. */
export type PartitionBatch = {
  items: BatchItem[];
  /** The batch load — sum of its items' weights. */
  load: number;
};

/** The deterministic finding the agent returns. */
export type BatchPartitionDetermination = {
  worklistRef: string;
  /** The submitted items, echoed so the guards can recompute. */
  items: BatchItem[];
  /** The number of contiguous batches requested. */
  batchCount: number;
  /** The optimal contiguous partition, in order. */
  batches: PartitionBatch[];
  /** The minimal achievable peak load — the largest batch load (the linear-partition optimum). */
  maxBatchLoad: number;
  /** The heaviest single item — a lower bound on maxBatchLoad. */
  maxItemWeight: number;
  /** Total weight across all items. */
  totalWeight: number;
  disposition: BatchPartitionDisposition;
  /** Always true — a supervisor confirms every partition. */
  requiresSupervisorReview: true;
  /** Always false — the agent never autonomously assigns reviewers. */
  autoAssigned: false;
  reason: string;
  synthetic: true;
  note: string;
};

/**
 * The greedy FEASIBILITY test for binary search: how many contiguous batches are needed if no batch may exceed
 * `cap`? Sweep left-to-right opening a new batch whenever the running load would exceed the cap. Returns
 * Infinity when a single item already exceeds the cap (no feasible split). Monotonic: a larger cap never needs
 * more batches — the property that makes binary search on the answer valid.
 */
function minBatchesForCap(weights: number[], cap: number): number {
  let batches = 1;
  let current = 0;
  for (const w of weights) {
    if (w > cap) return Number.POSITIVE_INFINITY;
    if (current + w > cap) {
      batches++;
      current = w;
    } else {
      current += w;
    }
  }
  return batches;
}

/**
 * The minimal achievable peak load (the scalar optimum) — recomputed by the optimality gate INDEPENDENT of any
 * reported cover. BINARY SEARCH ON THE ANSWER: the answer lies in [max(weight), sum(weight)]; the greedy
 * feasibility test is monotonic in the cap, so binary search converges on the smallest cap that fits within
 * `batchCount` contiguous batches. Empty worklist → 0. batchCount is clamped to [1, n] (you cannot form more
 * non-empty contiguous batches than there are items).
 */
export function optimalMaxLoad(weights: number[], batchCount: number): number {
  const n = weights.length;
  if (n === 0) return 0;
  const k = Math.max(1, Math.min(Math.floor(batchCount), n));
  let lo = Math.max(...weights);
  let hi = weights.reduce((acc, w) => acc + w, 0);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (minBatchesForCap(weights, mid) <= k) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

/**
 * LINEAR PARTITION — reconstruct the order-preserving contiguous split into exactly `batchCount` non-empty
 * batches that minimizes the peak load. An order-preserving DP: dp[i][b] is the minimal achievable peak when
 * splitting items[i..n) into exactly b batches; reconstruction walks left-to-right choosing, at each step, the
 * SMALLEST first-batch prefix that still achieves the optimum (a canonical leftmost-tight split, so it is
 * deterministic). Empty worklist → []. batchCount is clamped to [1, n].
 */
export function partitionItems(items: BatchItem[], batchCount: number): PartitionBatch[] {
  const n = items.length;
  if (n === 0) return [];
  const k = Math.max(1, Math.min(Math.floor(batchCount), n));
  const weights = items.map((it) => it.weight);
  const prefix = [0];
  for (let i = 0; i < n; i++) prefix.push(prefix[i] + weights[i]);
  const sum = (i: number, j: number) => prefix[j] - prefix[i];
  const INF = Number.POSITIVE_INFINITY;
  // dp[i][b] = minimal peak splitting items[i..n) into exactly b non-empty batches.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(INF));
  dp[n][0] = 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let b = 1; b <= k; b++) {
      if (b > n - i) continue; // cannot have more non-empty batches than remaining items
      let best = INF;
      for (let j = i + 1; j <= n - (b - 1); j++) {
        const cand = Math.max(sum(i, j), dp[j][b - 1]);
        if (cand < best) best = cand;
      }
      dp[i][b] = best;
    }
  }
  const batches: PartitionBatch[] = [];
  let i = 0;
  for (let b = k; b >= 1; b--) {
    const target = dp[i][b];
    let chosen = i + 1;
    for (let j = i + 1; j <= n - (b - 1); j++) {
      if (Math.max(sum(i, j), dp[j][b - 1]) === target) {
        chosen = j;
        break;
      }
    }
    batches.push({ items: items.slice(i, chosen), load: sum(i, chosen) });
    i = chosen;
  }
  return batches;
}

/**
 * The deterministic partitioning function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own items + batchCount (no randomness, no clock). It builds the optimal contiguous split, reads off
 * the minimal peak load, and derives the disposition. Nothing is assigned — the partition is handed to a
 * supervisor.
 */
export function evaluateBatchPartition(request: BatchPartitionRequest): BatchPartitionDetermination {
  const items = Array.isArray(request.items) ? request.items : [];
  const batchCount = Math.max(1, Math.min(Math.floor(request.batchCount) || 1, Math.max(items.length, 1)));
  const batches = partitionItems(items, batchCount);
  const maxBatchLoad = batches.reduce((acc, b) => Math.max(acc, b.load), 0);
  const maxItemWeight = items.reduce((acc, it) => Math.max(acc, it.weight), 0);
  const totalWeight = items.reduce((acc, it) => acc + it.weight, 0);
  const disposition: BatchPartitionDisposition = maxBatchLoad === maxItemWeight ? "item-bound" : "divisible";

  const reason =
    disposition === "item-bound"
      ? `Split ${items.length} item(s) of ${request.worklistRef} across ${batches.length} reviewer(s) \u2014 peak load ${maxBatchLoad} is bound by the single heaviest item; more reviewers cannot lower it.`
      : `Split ${items.length} item(s) of ${request.worklistRef} across ${batches.length} reviewer(s) \u2014 minimal peak load ${maxBatchLoad} (total ${totalWeight}); the busiest batch could rebalance with a different reviewer count.`;

  return {
    worklistRef: request.worklistRef,
    items,
    batchCount: batches.length,
    batches,
    maxBatchLoad,
    maxItemWeight,
    totalWeight,
    disposition,
    requiresSupervisorReview: true,
    autoAssigned: false,
    reason,
    synthetic: true,
    note:
      `Linear partition ${request.worklistRef}: ${disposition.toUpperCase()} \u2014 ` +
      `${items.length} item(s) split into ${batches.length} contiguous batch(es) with minimal peak load ${maxBatchLoad} (total ${totalWeight}) via LINEAR PARTITION / BINARY SEARCH ON THE ANSWER. ` +
      "Real reviewer scheduling weighs skills, certifications, shift rules, breaks, and fatigue \u2014 not a bare contiguous split by an effort number. Synthetic/illustrative weights \u2014 NOT a certified staffing / workforce-management system. The agent never assigns a named reviewer or dispatches the worklist on its own \u2014 a supervisor confirms every partition. Item labels reference charts / encounters, so a partition is PHI-adjacent and on the HIPAA audit path."
  };
}

/**
 * Sourced + self-consistency check: is the reported partition a REAL, self-consistent accounting of the
 * submitted worklist? The batches, concatenated IN ORDER, must reproduce EXACTLY the submitted items (same
 * labels, same weights, same sequence — no item dropped, added, reordered, or split), there must be exactly
 * `batchCount` NON-EMPTY contiguous batches, each batch's load must equal the sum of its items' weights, the
 * reported maxBatchLoad must equal the largest batch load, maxItemWeight and totalWeight must be honest, and
 * the disposition must follow the REPORTED maxBatchLoad. Catches a fabricated batch, a reordered cover, or an
 * overstated load. Does NOT recompute the optimal split (that is the optimality gate's job), so it is
 * independent of it. Anything evaluateBatchPartition() produces satisfies it. This is the honest signal the
 * partition reports to policy.batchpartition.partition-sourced. A non-object / malformed input is a violation.
 */
export function partitionSourced(
  decision:
    | {
        items?: unknown;
        batchCount?: unknown;
        batches?: unknown;
        maxBatchLoad?: unknown;
        maxItemWeight?: unknown;
        totalWeight?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const items = Array.isArray(decision.items) ? (decision.items as BatchItem[]) : null;
  const batches = Array.isArray(decision.batches) ? (decision.batches as PartitionBatch[]) : null;
  if (!items || !batches) return false;
  for (const it of items) {
    if (!it || typeof it.label !== "string" || typeof it.weight !== "number" || !Number.isFinite(it.weight)) {
      return false;
    }
  }
  if (typeof decision.batchCount !== "number" || decision.batchCount !== batches.length) return false;
  if (batches.length < 1) return false;

  // Flatten the batches in order and require an EXACT match to the submitted items (order-preserving cover).
  const flattened: BatchItem[] = [];
  let maxLoad = 0;
  for (const batch of batches) {
    if (!batch || typeof batch !== "object" || !Array.isArray(batch.items)) return false;
    if (batch.items.length === 0) return false; // no empty batch
    let load = 0;
    for (const it of batch.items) {
      if (!it || typeof it.label !== "string" || typeof it.weight !== "number") return false;
      flattened.push(it);
      load += it.weight;
    }
    if (typeof batch.load !== "number" || batch.load !== load) return false; // dishonest batch load
    if (load > maxLoad) maxLoad = load;
  }
  if (flattened.length !== items.length) return false; // dropped / added
  for (let i = 0; i < items.length; i++) {
    if (flattened[i].label !== items[i].label || flattened[i].weight !== items[i].weight) return false;
  }

  if (typeof decision.maxBatchLoad !== "number" || decision.maxBatchLoad !== maxLoad) return false;

  const maxItemWeight = items.reduce((acc, it) => Math.max(acc, it.weight), 0);
  const totalWeight = items.reduce((acc, it) => acc + it.weight, 0);
  if (decision.maxItemWeight !== undefined && decision.maxItemWeight !== maxItemWeight) return false;
  if (decision.totalWeight !== undefined && decision.totalWeight !== totalWeight) return false;

  const expectedDisposition: BatchPartitionDisposition = maxLoad === maxItemWeight ? "item-bound" : "divisible";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }
  return true;
}

/**
 * Optimality check: re-running the linear-partition solver over the submitted weights + batchCount must
 * reproduce the reported maxBatchLoad (and disposition). True only when the recompute agrees. Catches a
 * sub-optimal split that leaves one reviewer overloaded. The load-bearing correctness gate — it recomputes the
 * minimal peak load by BINARY SEARCH ON THE ANSWER from the weights INDEPENDENT of the reported batches (it
 * compares the scalar optimum, not the cover — different optimal splits achieve the same minimal maximum), so a
 * fabricated cover that still reports the optimal peak load fails sourced only while a real-but-sub-optimal
 * split fails here — the two gates are isolable. Anything evaluateBatchPartition() produces satisfies it. A
 * non-object input is a violation.
 */
export function partitionOptimal(
  decision:
    | { items?: unknown; batchCount?: unknown; maxBatchLoad?: unknown; disposition?: unknown }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const items = Array.isArray(decision.items) ? (decision.items as BatchItem[]) : null;
  if (!items) return false;
  for (const it of items) {
    if (!it || typeof it.label !== "string" || typeof it.weight !== "number" || !Number.isFinite(it.weight)) {
      return false;
    }
  }
  if (typeof decision.batchCount !== "number" || !Number.isFinite(decision.batchCount)) return false;

  const weights = items.map((it) => it.weight);
  const optimal = optimalMaxLoad(weights, decision.batchCount);
  if (typeof decision.maxBatchLoad !== "number" || decision.maxBatchLoad !== optimal) return false;

  const maxItemWeight = items.reduce((acc, it) => Math.max(acc, it.weight), 0);
  const expectedDisposition: BatchPartitionDisposition = optimal === maxItemWeight ? "item-bound" : "divisible";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }
  return true;
}

/**
 * No-autonomous-assignment check: did the agent avoid assigning / dispatching on its own? True unless the
 * determination reports it auto-assigned reviewers (autoAssigned:true) or does not require supervisor review
 * (requiresSupervisorReview:false). Anything evaluateBatchPartition() produces satisfies it. This is the honest
 * signal the partition reports to policy.batchpartition.no-autonomous-assign. A non-object input is a violation.
 */
export function noAutonomousAssign(
  decision: { autoAssigned?: boolean; requiresSupervisorReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoAssigned === true) return false;
  if (decision.requiresSupervisorReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a partition. */
export function batchPartitionSummary(decision: BatchPartitionDetermination): {
  worklistRef: string;
  disposition: BatchPartitionDisposition;
  itemCount: number;
  batchCount: number;
  maxBatchLoad: number;
  totalWeight: number;
  requiresSupervisorReview: boolean;
  synthetic: boolean;
} {
  return {
    worklistRef: decision.worklistRef,
    disposition: decision.disposition,
    itemCount: decision.items.length,
    batchCount: decision.batchCount,
    maxBatchLoad: decision.maxBatchLoad,
    totalWeight: decision.totalWeight,
    requiresSupervisorReview: decision.requiresSupervisorReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a seven-item chart-review backlog with varied effort weights, split across
 * three reviewers. The optimal contiguous split lands a minimal peak load of 10 — no k=3 split does better.
 * "Divisible" (the peak exceeds every single item). Synthetic; PHI-adjacent (chart labels).
 */
export const DEMO_BATCH_PARTITION_REQUEST: BatchPartitionRequest = {
  worklistRef: "chart-review-backlog-2231",
  items: [
    { label: "chart-8801", weight: 5 },
    { label: "chart-8802", weight: 2 },
    { label: "chart-8803", weight: 4 },
    { label: "chart-8804", weight: 3 },
    { label: "chart-8805", weight: 6 },
    { label: "chart-8806", weight: 4 }
  ],
  batchCount: 3
};

/**
 * A representative demo request where one item dominates: a single 20-point chart forces the peak load to 20
 * regardless of reviewer count — "item-bound" (more reviewers cannot lower the peak). Synthetic.
 */
export const DEMO_BATCH_PARTITION_ITEMBOUND_REQUEST: BatchPartitionRequest = {
  worklistRef: "triage-queue-mrn-set-88",
  items: [
    { label: "triage-01", weight: 2 },
    { label: "triage-02", weight: 3 },
    { label: "triage-03", weight: 20 },
    { label: "triage-04", weight: 4 },
    { label: "triage-05", weight: 1 }
  ],
  batchCount: 3
};

/**
 * A representative demo request whose four equal-weight items split evenly across two reviewers — a perfectly
 * balanced minimal peak load of 8. "Divisible." Synthetic.
 */
export const DEMO_BATCH_PARTITION_EVEN_REQUEST: BatchPartitionRequest = {
  worklistRef: "coding-queue-batch-14",
  items: [
    { label: "encounter-a", weight: 4 },
    { label: "encounter-b", weight: 4 },
    { label: "encounter-c", weight: 4 },
    { label: "encounter-d", weight: 4 }
  ],
  batchCount: 2
};
