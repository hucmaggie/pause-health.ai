/**
 * Benefit Accumulator Ledger / Fenwick-Tree Prefix Sums — the deterministic, transparent payer-operations layer
 * that, given an ORDERED sequence of posted claim amounts (dollars applied to a member's benefit accumulator) and
 * an OUT-OF-POCKET MAXIMUM, maintains a running accumulator and answers two questions fast: the CUMULATIVE amount
 * applied through each claim, and the CROSSOVER claim — the first at which the running total reaches or exceeds
 * the OOP maximum (after which the plan pays 100%) — without ever posting, adjusting, or paying against a
 * member's real accumulator on its own. A benefits analyst confirms.
 *
 * Deterministic, dependency-free domain core the Benefit Accumulator agent (app/api/agents/benefit-accumulator)
 * wraps — an accumulator-ledger agent on the PHI-bearing payer & plan operations plane of Pause's Agent Fabric.
 * CRUCIALLY, the heart of this service is the FENWICK TREE (Binary Indexed Tree): a cumulative-frequency data
 * structure that supports point updates and prefix-sum queries in O(log n), and — with a binary lower-bound
 * descent over its implicit tree — finds the smallest index whose prefix sum reaches a threshold in O(log n) as
 * well. As each claim's applied amount is inserted, the tree maintains the running accumulator; the crossover
 * claim is located by descending the Fenwick tree for the first prefix sum ≥ the OOP maximum. This is a genuinely
 * NEW computation pattern for the fabric: it is NOT the Member Cost-Share agent's COST-SHARING WATERFALL (which
 * splits a SINGLE claim across deductible / coinsurance / OOP for one date of service — this is a CUMULATIVE
 * data structure over a SEQUENCE of claims with prefix-sum + find-by-threshold queries), NOT the Audit Sample
 * agent's RESERVOIR SAMPLING, NOT the Duplicate-Claim Screen agent's BLOOM FILTER, NOT the MLR Rebate agent's
 * LARGEST-REMAINDER APPORTIONMENT, NOT the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, and NOT
 * the Peak-Window agent's KADANE MAXIMUM-SUBARRAY — it is Fenwick-tree prefix sums with a lower-bound descent.
 * The running prefix sums and the crossover index are the invariants this service reports and defends.
 *
 *   Inbound:  a BenefitAccumulatorRequest { ledgerRef, oopMax, appliedAmounts[] }  (amounts in cents/dollars, ordered)
 *   Outbound: a BenefitAccumulatorDetermination { runningTotals[], totalApplied, oopMax, crossoverIndex,
 *             remainingBeforeOopMax, claimCount, disposition, requiresAnalystReview:true, autoAdjusted:false,
 *             reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the ledger is sourced and self-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  A ledger is trustworthy only if the reported per-claim cumulative totals are the TRUE running sums of the
 *  submitted amounts (each runningTotals[k] === sum of appliedAmounts[0..k]), the reported totalApplied equal to
 *  the final running total, the crossoverIndex (if any) pointing at a real submitted claim, remainingBeforeOopMax
 *  equal to max(0, oopMax - totalApplied), and the disposition following (oop-max-met iff totalApplied ≥ oopMax).
 *  A fabricated running total, a mis-summed ledger, or an out-of-range crossover corrupts the accounting.
 *  ledgerSourced() verifies it; the Agent Fabric enforces it via policy.benefitacc.ledger-sourced. It does NOT
 *  recompute via the Fenwick tree — that is the accumulator gate's job — so the two are isolable. (The sourced +
 *  self-consistency gate — mirrors the Audit Sample Agent's sample-sourced and the Duplicate-Claim Screen Agent's
 *  filter-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the accumulator is exact (the Fenwick tree re-derives).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-building the Fenwick tree from the submitted amounts and re-querying must reproduce every prefix sum, and
 *  the CROSSOVER index located by the tree's binary lower-bound descent (first prefix sum ≥ oopMax) must equal the
 *  reported crossoverIndex. A ledger that reports the wrong crossover — the claim after which the plan starts
 *  paying 100% — would mis-state the member's liability. accumulatorExact() re-derives the prefix sums AND the
 *  crossover INDEPENDENT of the reported running totals (it descends the tree, not the reported array), so a
 *  fabricated ledger that still reports the right crossover fails sourced only, and a real-but-mislocated
 *  crossover fails accumulator only — the two gates are isolable. The Agent Fabric enforces it via
 *  policy.benefitacc.accumulator-exact. (The load-bearing correctness gate — mirrors the Audit Sample Agent's
 *  selection-reproducible and the Duplicate-Claim Screen Agent's membership-exact.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous adjustment.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent COMPUTES on paper — it never posts, adjusts, or pays against a member's real accumulator on its own
 *  (each is a benefit-adjustment action that must be authorized); every ledger is a RECOMMENDATION requiring a
 *  benefits analyst to confirm before anything touches the member's real accumulator. noAutonomousAdjust() reports
 *  the honest signal the Agent Fabric enforces via policy.benefitacc.no-autonomous-adjust. (Mirrors the Audit
 *  Sample Agent's no-autonomous-audit and the Duplicate-Claim Screen Agent's no-autonomous-reject — the harmful
 *  action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A ledger — under-oop-max or oop-max-met — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresAnalystReview:true, autoAdjusted:false). An oop-max-met disposition is NOT a governance block — it is
 *  the honest finding that the member has reached their out-of-pocket maximum (surfacing when is the whole point).
 *  A GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (a fabricated / mis-summed ledger, a
 *  mislocated crossover, or an autonomous adjustment) — which the Agent Fabric rejects before it can leave the
 *  fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified benefits-accumulator / claims-payment system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real accumulator processing weighs the full benefit design (embedded vs aggregate family deductibles, in- vs
 *  out-of-network tiers, carve-outs, EOB reversals and adjustments), plan-year resets, and an authoritative
 *  accumulator store — not a bare prefix-sum over illustrative amounts. This tallies the supplied illustrative
 *  amounts only. TIME IS DATA: the amounts + OOP max are plain numbers and the ledger is a pure function of them
 *  (no clock, no randomness), so the same request always yields the same determination, which is what lets the
 *  demo, the seeded trace, and the tests agree. The amounts are a clearly-labeled ILLUSTRATIVE synthetic. The
 *  ledger references a member's claims, so a determination is treated as PHI-bearing and the agent is on the
 *  HIPAA audit path.
 */

/** A request: the OOP maximum + the ordered per-claim applied amounts. */
export type BenefitAccumulatorRequest = {
  ledgerRef: string;
  /** Out-of-pocket maximum (same unit as amounts). Non-negative. */
  oopMax: number;
  /** Per-claim amounts applied to the accumulator, in posting order. Non-negative. */
  appliedAmounts: number[];
};

export type BenefitAccumulatorDisposition = "under-oop-max" | "oop-max-met";

/** The deterministic finding the agent returns. */
export type BenefitAccumulatorDetermination = {
  ledgerRef: string;
  /** The submitted amounts, echoed so the guards can recompute. */
  appliedAmounts: number[];
  oopMax: number;
  /** Running cumulative total through each claim (runningTotals[k] = sum of amounts[0..k]). */
  runningTotals: number[];
  /** Total amount applied (the final running total). */
  totalApplied: number;
  /** 0-indexed first claim whose cumulative total reaches/exceeds oopMax, or -1 if never. */
  crossoverIndex: number;
  /** max(0, oopMax - totalApplied). */
  remainingBeforeOopMax: number;
  claimCount: number;
  disposition: BenefitAccumulatorDisposition;
  /** Always true — a benefits analyst confirms every ledger. */
  requiresAnalystReview: true;
  /** Always false — the agent never autonomously adjusts a real accumulator. */
  autoAdjusted: false;
  reason: string;
  synthetic: true;
  note: string;
};

/**
 * A FENWICK TREE (Binary Indexed Tree) over a fixed-length array, supporting point add and prefix-sum query in
 * O(log n), plus a lower-bound descent (find the smallest 1-indexed position whose prefix sum reaches a
 * threshold). Deterministic; pure state. Amounts are stored scaled to integers to keep the tree's compares exact.
 */
export class FenwickTree {
  private readonly n: number;
  private readonly tree: number[];

  constructor(size: number) {
    this.n = Math.max(0, Math.floor(size));
    this.tree = new Array<number>(this.n + 1).fill(0);
  }

  /** Add `delta` at 1-indexed position i. */
  add(i: number, delta: number): void {
    for (let x = i; x <= this.n; x += x & -x) this.tree[x] += delta;
  }

  /** Prefix sum of positions [1, i]. */
  prefixSum(i: number): number {
    let s = 0;
    for (let x = Math.min(i, this.n); x > 0; x -= x & -x) s += this.tree[x];
    return s;
  }

  /**
   * Binary lower-bound descent: the smallest 1-indexed position whose prefix sum is ≥ target, or n+1 (i.e. the
   * total prefix never reaches target). Walks the implicit tree from the highest power-of-two ≤ n downward. Works
   * because all stored deltas are non-negative (prefix sums are monotonic). Values are integers, so `<` is exact.
   */
  lowerBound(target: number): number {
    if (target <= 0) return 1;
    let pos = 0;
    let acc = 0;
    let logn = 1;
    while (logn * 2 <= this.n) logn *= 2;
    for (let step = logn; step > 0; step >>= 1) {
      const next = pos + step;
      if (next <= this.n && acc + this.tree[next] < target) {
        pos = next;
        acc += this.tree[next];
      }
    }
    return pos + 1;
  }
}

/** Scale a dollar/cents amount to an integer (2 dp) so Fenwick compares are exact — no float drift. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Compute the running cumulative totals of the amounts, in order. Pure. (The plain scan is the honest ground
 * truth the sourced gate checks against; the Fenwick tree is used for the accumulator gate's independent
 * re-derivation and the crossover descent.)
 */
export function runningTotalsOf(appliedAmounts: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const a of Array.isArray(appliedAmounts) ? appliedAmounts : []) {
    acc += Math.max(0, a);
    out.push(Math.round(acc * 100) / 100);
  }
  return out;
}

/**
 * Locate the crossover claim via a FENWICK-TREE lower-bound descent: build the tree from the (scaled) amounts and
 * descend for the first 1-indexed position whose prefix sum ≥ oopMax; return it 0-indexed, or -1 if the total
 * never reaches oopMax. Pure — a function of the amounts + oopMax.
 */
export function crossoverViaFenwick(appliedAmounts: number[], oopMax: number): number {
  const amounts = Array.isArray(appliedAmounts) ? appliedAmounts : [];
  const n = amounts.length;
  if (n === 0) return -1;
  const tree = new FenwickTree(n);
  for (let i = 0; i < n; i++) tree.add(i + 1, toCents(Math.max(0, amounts[i])));
  const target = toCents(Math.max(0, oopMax));
  if (target <= 0) return 0; // an OOP max of 0 is met at the very first claim
  const pos = tree.lowerBound(target); // 1-indexed, or n+1 if never reached
  return pos > n ? -1 : pos - 1;
}

/**
 * The deterministic ledger function — the heart of the service. DETERMINISTIC: a pure function of the request's
 * own amounts + oopMax (no randomness, no clock). It computes the running totals, the total applied, the
 * crossover claim (via the Fenwick descent), and the remaining-before-OOP-max, and derives the disposition.
 * Nothing is posted — the ledger is handed to a benefits analyst.
 */
export function evaluateBenefitAccumulator(
  request: BenefitAccumulatorRequest
): BenefitAccumulatorDetermination {
  const appliedAmounts = (Array.isArray(request.appliedAmounts) ? request.appliedAmounts : []).map((a) =>
    Math.max(0, a)
  );
  const oopMax = Math.max(0, request.oopMax);
  const runningTotals = runningTotalsOf(appliedAmounts);
  const totalApplied = runningTotals.length > 0 ? runningTotals[runningTotals.length - 1] : 0;
  const crossoverIndex = crossoverViaFenwick(appliedAmounts, oopMax);
  const remainingBeforeOopMax = Math.round(Math.max(0, oopMax - totalApplied) * 100) / 100;
  const disposition: BenefitAccumulatorDisposition =
    totalApplied >= oopMax ? "oop-max-met" : "under-oop-max";

  const reason =
    disposition === "oop-max-met"
      ? `Member ledger ${request.ledgerRef} reached the out-of-pocket maximum of ${oopMax} at claim ${crossoverIndex + 1} of ${appliedAmounts.length} (total applied ${totalApplied}); the plan pays 100% thereafter.`
      : `Member ledger ${request.ledgerRef} is under the out-of-pocket maximum of ${oopMax} — total applied ${totalApplied} across ${appliedAmounts.length} claim(s), ${remainingBeforeOopMax} remaining before the plan pays 100%.`;

  return {
    ledgerRef: request.ledgerRef,
    appliedAmounts,
    oopMax,
    runningTotals,
    totalApplied,
    crossoverIndex,
    remainingBeforeOopMax,
    claimCount: appliedAmounts.length,
    disposition,
    requiresAnalystReview: true,
    autoAdjusted: false,
    reason,
    synthetic: true,
    note:
      `Benefit accumulator ${request.ledgerRef}: ${disposition.toUpperCase()} — ` +
      `${appliedAmounts.length} claim(s), total applied ${totalApplied} against OOP max ${oopMax}` +
      (crossoverIndex >= 0
        ? ` (crossover at claim ${crossoverIndex + 1}) `
        : ` (${remainingBeforeOopMax} remaining) `) +
      "via FENWICK-TREE PREFIX SUMS with a lower-bound descent. Real accumulator processing weighs the full benefit design (embedded vs aggregate family deductibles, network tiers, carve-outs, EOB reversals), plan-year resets, and an authoritative accumulator store — not a bare prefix-sum over illustrative amounts. Synthetic/illustrative amounts — NOT a certified benefits-accumulator / claims-payment system. The agent never posts, adjusts, or pays against a member's real accumulator on its own — a benefits analyst confirms every ledger. The ledger references a member's claims, so a determination is on the HIPAA audit path."
  };
}

/**
 * Sourced + self-consistency check: are the reported per-claim cumulative totals the TRUE running sums of the
 * submitted amounts (each runningTotals[k] === sum of amounts[0..k]), the totalApplied equal to the final running
 * total, the crossoverIndex either -1 or a valid submitted-claim index, remainingBeforeOopMax equal to
 * max(0, oopMax - totalApplied), and the disposition following? Catches a fabricated running total, a mis-summed
 * ledger, or an out-of-range crossover. Does NOT re-derive via the Fenwick tree (that is the accumulator gate's
 * job), so it is independent of it. Anything evaluateBenefitAccumulator() produces satisfies it. This is the
 * honest signal the ledger reports to policy.benefitacc.ledger-sourced. A non-object / malformed input is a
 * violation.
 */
export function ledgerSourced(
  decision:
    | {
        appliedAmounts?: unknown;
        oopMax?: unknown;
        runningTotals?: unknown;
        totalApplied?: unknown;
        crossoverIndex?: unknown;
        remainingBeforeOopMax?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const appliedAmounts = Array.isArray(decision.appliedAmounts)
    ? (decision.appliedAmounts as number[])
    : null;
  const runningTotals = Array.isArray(decision.runningTotals) ? (decision.runningTotals as number[]) : null;
  if (!appliedAmounts || !runningTotals) return false;
  for (const a of appliedAmounts) if (typeof a !== "number" || !Number.isFinite(a) || a < 0) return false;
  for (const t of runningTotals) if (typeof t !== "number" || !Number.isFinite(t)) return false;
  if (typeof decision.oopMax !== "number" || !Number.isFinite(decision.oopMax) || decision.oopMax < 0) {
    return false;
  }
  if (runningTotals.length !== appliedAmounts.length) return false;

  // The running totals must be the true prefix sums, claim by claim.
  const expected = runningTotalsOf(appliedAmounts);
  for (let i = 0; i < expected.length; i++) {
    if (runningTotals[i] !== expected[i]) return false;
  }

  const totalApplied = expected.length > 0 ? expected[expected.length - 1] : 0;
  if (decision.totalApplied !== undefined && decision.totalApplied !== totalApplied) return false;

  const oopMax = decision.oopMax;
  // The crossover (if reported) must be -1 or a valid submitted-claim index.
  if (typeof decision.crossoverIndex !== "number") return false;
  if (
    decision.crossoverIndex !== -1 &&
    (decision.crossoverIndex < 0 || decision.crossoverIndex >= appliedAmounts.length)
  ) {
    return false;
  }

  const remaining = Math.round(Math.max(0, oopMax - totalApplied) * 100) / 100;
  if (decision.remainingBeforeOopMax !== undefined && decision.remainingBeforeOopMax !== remaining) {
    return false;
  }

  const expectedDisposition: BenefitAccumulatorDisposition =
    totalApplied >= oopMax ? "oop-max-met" : "under-oop-max";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * Accumulator-exactness check: re-building the Fenwick tree from the submitted amounts and re-querying must
 * reproduce every prefix sum, and the CROSSOVER index located by the tree's binary lower-bound descent (first
 * prefix sum ≥ oopMax) must equal the reported crossoverIndex. True only when the recompute agrees. Catches a
 * mislocated crossover — the claim after which the plan pays 100% — which would mis-state the member's liability.
 * The load-bearing correctness gate — it re-derives the prefix sums AND the crossover INDEPENDENT of the reported
 * running totals (it descends the Fenwick tree, not the reported array), so a fabricated ledger that still reports
 * the right crossover fails sourced only while a real-but-mislocated crossover fails here — the two gates are
 * isolable. Anything evaluateBenefitAccumulator() produces satisfies it. A non-object input is a violation.
 */
export function accumulatorExact(
  decision:
    | { appliedAmounts?: unknown; oopMax?: unknown; runningTotals?: unknown; crossoverIndex?: unknown }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const appliedAmounts = Array.isArray(decision.appliedAmounts)
    ? (decision.appliedAmounts as number[])
    : null;
  const runningTotals = Array.isArray(decision.runningTotals) ? (decision.runningTotals as number[]) : null;
  if (!appliedAmounts || !runningTotals) return false;
  for (const a of appliedAmounts) if (typeof a !== "number" || !Number.isFinite(a) || a < 0) return false;
  if (typeof decision.oopMax !== "number" || !Number.isFinite(decision.oopMax)) return false;
  if (typeof decision.crossoverIndex !== "number") return false;
  if (runningTotals.length !== appliedAmounts.length) return false;

  // Re-derive prefix sums via the Fenwick tree and compare to the reported running totals.
  const n = appliedAmounts.length;
  const tree = new FenwickTree(n);
  for (let i = 0; i < n; i++) tree.add(i + 1, toCents(Math.max(0, appliedAmounts[i])));
  for (let i = 0; i < n; i++) {
    const fromTree = tree.prefixSum(i + 1) / 100;
    if (Math.round(fromTree * 100) !== Math.round(runningTotals[i] * 100)) return false;
  }

  // The crossover located by the tree's lower-bound descent must match the reported one.
  const expectedCrossover = crossoverViaFenwick(appliedAmounts, Math.max(0, decision.oopMax));
  if (decision.crossoverIndex !== expectedCrossover) return false;
  return true;
}

/**
 * No-autonomous-adjustment check: did the agent avoid posting / adjusting on its own? True unless the
 * determination reports it auto-adjusted a real accumulator (autoAdjusted:true) or does not require analyst
 * review (requiresAnalystReview:false). Anything evaluateBenefitAccumulator() produces satisfies it. This is the
 * honest signal the ledger reports to policy.benefitacc.no-autonomous-adjust. A non-object input is a violation.
 */
export function noAutonomousAdjust(
  decision: { autoAdjusted?: boolean; requiresAnalystReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoAdjusted === true) return false;
  if (decision.requiresAnalystReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a ledger. */
export function benefitAccumulatorSummary(decision: BenefitAccumulatorDetermination): {
  ledgerRef: string;
  disposition: BenefitAccumulatorDisposition;
  claimCount: number;
  totalApplied: number;
  oopMax: number;
  crossoverIndex: number;
  remainingBeforeOopMax: number;
  requiresAnalystReview: boolean;
  synthetic: boolean;
} {
  return {
    ledgerRef: decision.ledgerRef,
    disposition: decision.disposition,
    claimCount: decision.claimCount,
    totalApplied: decision.totalApplied,
    oopMax: decision.oopMax,
    crossoverIndex: decision.crossoverIndex,
    remainingBeforeOopMax: decision.remainingBeforeOopMax,
    requiresAnalystReview: decision.requiresAnalystReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: six claims posting against a $3,000 OOP maximum. The running total crosses
 * $3,000 at the fifth claim (index 4). "Oop-max-met." Synthetic; PHI-adjacent (member claims).
 *
 * Amounts: 400, 650, 900, 500, 800, 300 → cumulative 400, 1050, 1950, 2450, 3250, 3550 → crosses at index 4.
 */
export const DEMO_BENEFIT_ACCUMULATOR_REQUEST: BenefitAccumulatorRequest = {
  ledgerRef: "member-accum-2026-7781",
  oopMax: 3000,
  appliedAmounts: [400, 650, 900, 500, 800, 300]
};

/**
 * A representative demo request that never reaches the OOP maximum — total applied stays under it. "Under-oop-max."
 * Synthetic.
 */
export const DEMO_BENEFIT_ACCUMULATOR_UNDER_REQUEST: BenefitAccumulatorRequest = {
  ledgerRef: "member-accum-2026-7782",
  oopMax: 5000,
  appliedAmounts: [300, 450, 275, 600]
};

/**
 * A representative demo request where a single large first claim meets the OOP maximum immediately (crossover at
 * index 0). "Oop-max-met." Synthetic.
 */
export const DEMO_BENEFIT_ACCUMULATOR_IMMEDIATE_REQUEST: BenefitAccumulatorRequest = {
  ledgerRef: "member-accum-2026-7783",
  oopMax: 2000,
  appliedAmounts: [2500, 100, 100]
};
