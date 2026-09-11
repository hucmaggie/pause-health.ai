/**
 * Care-Management Capacity Allocation / Outreach Prioritization — the deterministic, transparent
 * care-coordination layer that, given a care team's fixed CAPACITY for the cycle (its available outreach
 * HOURS this week) and a set of candidate proactive INTERVENTIONS (each with an hours COST and a projected
 * clinical BENEFIT), selects the subset of interventions that MAXIMIZES the total projected benefit while
 * fitting inside the capacity budget — deferring (never denying) the rest to the next cycle — without ever
 * launching the outreach or committing the plan on its own. A care lead confirms.
 *
 * Deterministic, dependency-free domain core the Outreach Prioritization agent
 * (app/api/agents/outreach-prioritization) wraps — a care-coordination / capacity-planning service on the
 * patient & clinical plane of Pause's Agent Fabric. UNLIKE the Quality Shift agent's CUSUM CHANGE-POINT
 * DETECTION, the Timeline Merge agent's K-WAY MERGE OF SORTED STREAMS, the Reportable Condition agent's
 * RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP Matching agent's TWO-SIDED STABLE MATCHING
 * (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation
 * agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the
 * Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER
 * APPORTIONMENT, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's
 * STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Care Pathway agent's
 * TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log
 * Integrity agent's HASH CHAIN — and, CRUCIALLY, UNLIKE the Caseload Balancing agent's GREEDY BIN-PACKING
 * (which distributes EVERY member across managers' capacities by acuity — a partition) and the Population
 * Health agent's RISK RANKING (which orders a panel; it selects no subset under a budget) — the heart of
 * this service is the 0/1 KNAPSACK via DYNAMIC PROGRAMMING: the classic capacity-constrained
 * maximum-value-subset optimization, filling a DP table dp[i][c] = max benefit achievable from the first i
 * interventions within capacity c (dp[i][c] = max(dp[i-1][c], dp[i-1][c-cost_i] + benefit_i)) and
 * reconstructing the optimal set by walking the table back. A greedy or hand-picked allocation leaves
 * benefit on the table — patients who could have been reached this cycle are not — so this optimizes
 * DETERMINISTICALLY and hands the plan to a human.
 *
 *   Inbound:  an OutreachRequest { cycleRef, capacity, candidates[] }
 *   Outbound: an OutreachDetermination { selected[], deferred[], totalCost, totalBenefit, remainingCapacity,
 *             disposition, requiresCareLeadReview:true, autoScheduled:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every selection is sourced and every candidate is accounted for.
 * ─────────────────────────────────────────────────────────────────────
 *  An allocation is trustworthy only if it is built from the submitted candidates: every selected (and
 *  deferred) intervention must trace to a SUBMITTED candidate (same id + cost + benefit; no FABRICATED
 *  intervention), every submitted candidate must appear EXACTLY ONCE across selected ∪ deferred (none
 *  dropped, none double-counted, none both), and the reported tallies (selected count, total cost, total
 *  benefit, remaining capacity) must add up against the capacity. A fabricated or dropped intervention
 *  silently rewrites the plan. selectionsSourced() verifies it; the Agent Fabric enforces it via
 *  policy.outreach.selections-sourced. (The sourced + completeness gate — mirrors the Caseload Balancing
 *  Agent's assignment-complete and the Timeline Merge Agent's events-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the allocation is optimal + feasible.
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing the 0/1 knapsack DP over the submitted candidates + capacity must reproduce the reported
 *  maximum total benefit, and the reported selection must be FEASIBLE (its total cost within capacity) and
 *  OPTIMAL (its benefit equals the DP optimum). A sub-optimal allocation under-serves patients; an
 *  over-capacity one over-commits the team. allocationOptimal() recomputes it end-to-end; the Agent Fabric
 *  enforces it via policy.outreach.allocation-optimal. (The load-bearing correctness gate — mirrors the
 *  Caseload Balancing Agent's capacity-respected and the Quality Shift Agent's cusum-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous scheduling.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent PRIORITIZES — it never launches the outreach, commits the plan, or books the interventions on
 *  its own (each is a care-delivery action that must be authorized); every allocation is a RECOMMENDATION
 *  requiring a care lead to confirm, and the deferred interventions are deferred to a later cycle, never
 *  denied. noAutonomousSchedule() reports the honest signal the Agent Fabric enforces via
 *  policy.outreach.no-autonomous-schedule. (Mirrors the Caseload Balancing Agent's no-autonomous-assignment
 *  and the Care Gap Agent's human-review posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  An allocation — all-scheduled or some-deferred — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresCareLeadReview:true, autoScheduled:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (a fabricated intervention, a sub-optimal / over-capacity allocation, or an
 *  autonomous schedule) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified care-management / capacity-planning system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real capacity planning weighs clinical urgency, member consent, staffing mix, regulatory timeliness, and
 *  equity — not a single benefit score under one hours budget. This optimizes the supplied illustrative
 *  scores only, and a deferred intervention is deferred, NEVER denied. TIME IS DATA: the allocation is a
 *  pure function of the candidates' own costs + benefits + the capacity (no clock, no randomness), so the
 *  same request always yields the same plan, which is what lets the demo, the seeded trace, and the tests
 *  agree. The interventions are clearly-labeled ILLUSTRATIVE synthetics.
 */

/** A candidate proactive intervention. `cost` is integer hours; `benefit` is an integer projected-impact score. */
export type OutreachCandidate = {
  id: string;
  cost: number;
  benefit: number;
  label?: string;
};

/** An outreach-prioritization request. `capacity` is the integer hours budget for the cycle. */
export type OutreachRequest = {
  cycleRef: string;
  capacity: number;
  candidates: OutreachCandidate[];
};

export type OutreachDisposition = "all-scheduled" | "some-deferred";

/** The deterministic finding the agent returns. */
export type OutreachDetermination = {
  cycleRef: string;
  capacity: number;
  /** The submitted candidates, echoed so the guards can recompute. */
  candidates: OutreachCandidate[];
  /** The optimal max-benefit subset that fits the capacity, in candidate order. */
  selected: OutreachCandidate[];
  /** The candidates not selected this cycle (deferred, never denied), in candidate order. */
  deferred: OutreachCandidate[];
  totalCost: number;
  totalBenefit: number;
  remainingCapacity: number;
  disposition: OutreachDisposition;
  /** Always true — a care lead confirms every allocation. */
  requiresCareLeadReview: true;
  /** Always false — the agent never autonomously schedules. */
  autoScheduled: false;
  reason: string;
  synthetic: true;
  note: string;
};

/**
 * The 0/1 KNAPSACK via DYNAMIC PROGRAMMING — the heart of the service. Fills the DP table and reconstructs
 * the optimal max-benefit subset that fits `capacity`. Deterministic: items are considered in the given
 * order, and the reconstruction takes an item only when it strictly improves the optimum (ties defer), so
 * the selected set is a single well-defined optimum. Costs and capacity are treated as non-negative
 * integers. Returns the selected candidates in the input order and the optimum benefit.
 */
export function knapsack(
  candidates: OutreachCandidate[],
  capacity: number
): { selected: OutreachCandidate[]; optimum: number } {
  const n = candidates.length;
  const cap = Math.max(0, Math.floor(capacity));
  // dp[i][c] = max benefit using first i items within capacity c.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(cap + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const { cost, benefit } = candidates[i - 1];
    for (let c = 0; c <= cap; c++) {
      const without = dp[i - 1][c];
      if (cost <= c) {
        const withIt = dp[i - 1][c - cost] + benefit;
        dp[i][c] = Math.max(without, withIt);
      } else {
        dp[i][c] = without;
      }
    }
  }

  // Reconstruct: walk back, taking item i only when it strictly changed the optimum (deterministic).
  const chosenIdx: number[] = [];
  let c = cap;
  for (let i = n; i >= 1; i--) {
    if (dp[i][c] !== dp[i - 1][c]) {
      chosenIdx.push(i - 1);
      c -= candidates[i - 1].cost;
    }
  }
  chosenIdx.reverse();
  return {
    selected: chosenIdx.map((idx) => candidates[idx]),
    optimum: dp[n][cap]
  };
}

/**
 * The deterministic allocation function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own candidates + capacity (no randomness, no clock). It runs the 0/1 knapsack DP, selects the
 * optimal max-benefit feasible subset, defers the rest, and derives the disposition. Nothing is scheduled —
 * the plan is handed to a care lead.
 */
export function evaluateOutreachPrioritization(request: OutreachRequest): OutreachDetermination {
  const candidates = Array.isArray(request.candidates) ? request.candidates : [];
  const capacity = request.capacity;
  const { selected } = knapsack(candidates, capacity);

  const selectedIds = new Set(selected.map((s) => s.id));
  const deferred = candidates.filter((c) => !selectedIds.has(c.id));
  const totalCost = selected.reduce((n, s) => n + s.cost, 0);
  const totalBenefit = selected.reduce((n, s) => n + s.benefit, 0);
  const remainingCapacity = capacity - totalCost;
  const disposition: OutreachDisposition = deferred.length === 0 ? "all-scheduled" : "some-deferred";

  const reason =
    disposition === "all-scheduled"
      ? `All ${candidates.length} candidate intervention(s) fit the ${capacity}-hour capacity; total projected benefit ${totalBenefit}.`
      : `Selected ${selected.length} of ${candidates.length} intervention(s) for the ${capacity}-hour capacity (max projected benefit ${totalBenefit}); ${deferred.length} deferred to a later cycle.`;

  return {
    cycleRef: request.cycleRef,
    capacity,
    candidates,
    selected,
    deferred,
    totalCost,
    totalBenefit,
    remainingCapacity,
    disposition,
    requiresCareLeadReview: true,
    autoScheduled: false,
    reason,
    synthetic: true,
    note:
      `Outreach prioritization ${request.cycleRef}: ${disposition.toUpperCase()} — ${selected.length} of ${candidates.length} intervention(s) selected within a ${capacity}-hour capacity for a maximum projected benefit of ${totalBenefit}, via the 0/1 KNAPSACK dynamic-programming optimization (dp[i][c] = max(dp[i-1][c], dp[i-1][c-cost_i] + benefit_i)).` +
      " Real capacity planning weighs clinical urgency, member consent, staffing mix, regulatory timeliness, and equity — not a single benefit score under one hours budget. A deferred intervention is DEFERRED to a later cycle, NEVER denied. Synthetic/illustrative interventions — NOT a certified care-management / capacity-planning system. The agent never launches the outreach or commits the plan on its own — a care lead confirms every allocation."
  };
}

/** Index the submitted candidates by id. */
function candidateIndex(candidates: OutreachCandidate[]): Map<string, OutreachCandidate> {
  const idx = new Map<string, OutreachCandidate>();
  for (const c of candidates) idx.set(c.id, c);
  return idx;
}

/**
 * Sourced + completeness check: is the allocation built from the submitted candidates? True only when every
 * selected AND deferred intervention traces to a SUBMITTED candidate (same id + cost + benefit; no fabricated
 * intervention), every submitted candidate appears EXACTLY ONCE across selected ∪ deferred (none dropped,
 * none double-counted, none in both), the capacity is a number, and the reported tallies (total cost, total
 * benefit, remaining capacity) match the selected set. Catches a fabricated or dropped intervention. Does
 * NOT recompute the knapsack optimum or check feasibility (that is the optimality check's job), so it is
 * independent of it. Anything evaluateOutreachPrioritization() produces satisfies it. This is the honest
 * signal the route reports to policy.outreach.selections-sourced. A non-object / malformed input is a
 * violation.
 */
export function selectionsSourced(
  decision:
    | {
        candidates?: unknown;
        selected?: unknown;
        deferred?: unknown;
        capacity?: unknown;
        totalCost?: unknown;
        totalBenefit?: unknown;
        remainingCapacity?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const candidates = Array.isArray(decision.candidates)
    ? (decision.candidates as OutreachCandidate[])
    : null;
  const selected = Array.isArray(decision.selected) ? (decision.selected as OutreachCandidate[]) : null;
  const deferred = Array.isArray(decision.deferred) ? (decision.deferred as OutreachCandidate[]) : null;
  if (!candidates || !selected || !deferred) return false;
  if (typeof decision.capacity !== "number") return false;

  const idx = candidateIndex(candidates);
  const seen = new Set<string>();
  for (const item of [...selected, ...deferred]) {
    const c = idx.get(item.id);
    if (!c) return false; // fabricated intervention
    if (c.cost !== item.cost || c.benefit !== item.benefit) return false;
    if (seen.has(item.id)) return false; // double-counted / in both lists
    seen.add(item.id);
  }
  if (seen.size !== idx.size) return false; // some candidate dropped

  // Tallies against the selected set.
  const totalCost = selected.reduce((n, s) => n + s.cost, 0);
  const totalBenefit = selected.reduce((n, s) => n + s.benefit, 0);
  if (decision.totalCost !== undefined && decision.totalCost !== totalCost) return false;
  if (decision.totalBenefit !== undefined && decision.totalBenefit !== totalBenefit) return false;
  if (
    decision.remainingCapacity !== undefined &&
    decision.remainingCapacity !== decision.capacity - totalCost
  ) {
    return false;
  }
  return true;
}

/**
 * Optimality + feasibility check: recomputing the 0/1 knapsack DP over the submitted candidates + capacity
 * must reproduce the reported maximum total benefit, and the reported selection must be FEASIBLE (its total
 * cost within capacity) and OPTIMAL (its benefit equals the DP optimum). True only when the reported
 * selection, filtered to real submitted candidates, is feasible and its benefit equals the recomputed
 * optimum, AND the reported totalBenefit equals the optimum, AND the disposition matches. Catches a
 * sub-optimal or over-capacity allocation. The load-bearing correctness gate — it recomputes the optimum
 * from the candidates INDEPENDENT of the selection-correspondence (a fabricated intervention is filtered out
 * here, so it fails sourced while the real selection still recomputes — the two gates are isolable). Anything
 * evaluateOutreachPrioritization() produces satisfies it. A non-object input is a violation.
 */
export function allocationOptimal(
  decision:
    | {
        candidates?: unknown;
        selected?: unknown;
        deferred?: unknown;
        capacity?: unknown;
        totalBenefit?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const candidates = Array.isArray(decision.candidates)
    ? (decision.candidates as OutreachCandidate[])
    : null;
  const selected = Array.isArray(decision.selected) ? (decision.selected as OutreachCandidate[]) : null;
  if (!candidates || !selected) return false;
  if (typeof decision.capacity !== "number") return false;

  const idx = candidateIndex(candidates);
  // Filter the reported selection to real candidates (isolates from the sourced gate).
  const realSelected = selected.filter((s) => {
    const c = idx.get(s.id);
    return c !== undefined && c.cost === s.cost && c.benefit === s.benefit;
  });

  const { optimum } = knapsack(candidates, decision.capacity);

  const realCost = realSelected.reduce((n, s) => n + s.cost, 0);
  const realBenefit = realSelected.reduce((n, s) => n + s.benefit, 0);

  if (realCost > decision.capacity) return false; // infeasible / over capacity
  if (realBenefit !== optimum) return false; // sub-optimal (leaves benefit on the table)
  if (decision.totalBenefit !== undefined && decision.totalBenefit !== optimum) return false;

  // A selected item must not appear twice (a duplicate would inflate the benefit).
  const ids = new Set<string>();
  for (const s of realSelected) {
    if (ids.has(s.id)) return false;
    ids.add(s.id);
  }

  // Disposition must match (all-scheduled iff every candidate is selected).
  if (decision.disposition !== undefined) {
    const expected: OutreachDisposition = realSelected.length === candidates.length ? "all-scheduled" : "some-deferred";
    if (decision.disposition !== expected) return false;
  }
  return true;
}

/**
 * No-autonomous-schedule check: did the agent avoid autonomously launching the outreach? True unless the
 * determination reports it auto-scheduled (autoScheduled:true) or does not require care-lead review
 * (requiresCareLeadReview:false). Anything evaluateOutreachPrioritization() produces satisfies it. This is
 * the honest signal the route reports to policy.outreach.no-autonomous-schedule. A non-object input is a
 * violation.
 */
export function noAutonomousSchedule(
  decision:
    | { autoScheduled?: boolean; requiresCareLeadReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoScheduled === true) return false;
  if (decision.requiresCareLeadReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of an allocation. */
export function outreachSummary(decision: OutreachDetermination): {
  cycleRef: string;
  disposition: OutreachDisposition;
  candidateCount: number;
  selectedCount: number;
  deferredCount: number;
  totalBenefit: number;
  totalCost: number;
  remainingCapacity: number;
  requiresCareLeadReview: boolean;
  synthetic: boolean;
} {
  return {
    cycleRef: decision.cycleRef,
    disposition: decision.disposition,
    candidateCount: decision.candidates.length,
    selectedCount: decision.selected.length,
    deferredCount: decision.deferred.length,
    totalBenefit: decision.totalBenefit,
    totalCost: decision.totalCost,
    remainingCapacity: decision.remainingCapacity,
    requiresCareLeadReview: decision.requiresCareLeadReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request whose optimal plan defers one lower-value intervention (some-deferred).
 * Synthetic interventions.
 */
export const DEMO_OUTREACH_REQUEST: OutreachRequest = {
  cycleRef: "outreach-cycle-001",
  capacity: 10,
  candidates: [
    { id: "iv-hrt-titration", cost: 5, benefit: 60, label: "HRT titration outreach" },
    { id: "iv-dexa-reminder", cost: 3, benefit: 50, label: "Bone-density (DEXA) screening reminder" },
    { id: "iv-sdoh-checkin", cost: 4, benefit: 40, label: "SDOH check-in call" },
    { id: "iv-education", cost: 2, benefit: 30, label: "Menopause education packet + follow-up" }
  ]
};

/** A representative demo request whose capacity fits every candidate (all-scheduled). Synthetic. */
export const DEMO_OUTREACH_ALL_REQUEST: OutreachRequest = {
  cycleRef: "outreach-cycle-002",
  capacity: 14,
  candidates: [
    { id: "iv-hrt-titration", cost: 5, benefit: 60, label: "HRT titration outreach" },
    { id: "iv-dexa-reminder", cost: 3, benefit: 50, label: "Bone-density (DEXA) screening reminder" },
    { id: "iv-sdoh-checkin", cost: 4, benefit: 40, label: "SDOH check-in call" },
    { id: "iv-education", cost: 2, benefit: 30, label: "Menopause education packet + follow-up" }
  ]
};

/** A representative demo request with a tight capacity that defers two interventions (some-deferred). */
export const DEMO_OUTREACH_TIGHT_REQUEST: OutreachRequest = {
  cycleRef: "outreach-cycle-003",
  capacity: 5,
  candidates: [
    { id: "iv-hrt-titration", cost: 5, benefit: 60, label: "HRT titration outreach" },
    { id: "iv-dexa-reminder", cost: 3, benefit: 50, label: "Bone-density (DEXA) screening reminder" },
    { id: "iv-sdoh-checkin", cost: 4, benefit: 40, label: "SDOH check-in call" },
    { id: "iv-education", cost: 2, benefit: 30, label: "Menopause education packet + follow-up" }
  ]
};
