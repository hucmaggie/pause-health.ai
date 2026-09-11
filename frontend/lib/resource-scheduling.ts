/**
 * Resource-Block Scheduling / Max-Value Non-Overlapping Selection — the deterministic, transparent
 * care-coordination layer that, given a single SHARED SCARCE RESOURCE (an infusion chair, an OR block, a
 * specialist's slot ladder, an imaging machine) and a batch of competing REQUESTS for it — each a time WINDOW
 * with a priority WEIGHT (clinical value / acuity) — selects the MAXIMUM-TOTAL-WEIGHT set of NON-OVERLAPPING
 * requests that the resource can honor, and reports the rest as CONTENDED — without ever booking, bumping, or
 * confirming anything. A scheduler confirms.
 *
 * Deterministic, dependency-free domain core the Resource Scheduling agent (app/api/agents/resource-scheduling)
 * wraps — a capacity-optimization agent on the patient & clinical-operations plane of Pause's Agent Fabric.
 * CRUCIALLY, this is NOT the Scheduling Conflict agent's GREEDY INTERVAL SELECTION (the classic
 * activity-selection algorithm — sort by earliest finish and admit each interval that doesn't overlap the
 * last admitted, maximizing the COUNT of non-overlapping appointments, WEIGHTLESS) and NOT the Caseload
 * Balancing agent's GREEDY BIN-PACKING under a capacity constraint or the Outreach Prioritization agent's 0/1
 * KNAPSACK DYNAMIC PROGRAMMING (items with a value + a cost packed under a single capacity budget, no time /
 * overlap structure). It is also UNLIKE the Care Routing agent's DIJKSTRA'S WEIGHTED SHORTEST PATH, the
 * Source Consensus agent's BOYER–MOORE MAJORITY VOTE, the Code Taxonomy agent's TRIE LONGEST-PREFIX MATCH,
 * the KPI Trend agent's LEAST-SQUARES REGRESSION, the Quality Shift agent's CUSUM CHANGE-POINT DETECTION, the
 * Timeline Merge agent's K-WAY MERGE, the PCP Matching agent's STABLE MATCHING, the Network Adequacy agent's
 * GREAT-CIRCLE DISTANCE, the Household Composition agent's UNION-FIND, the Provider Benchmarking agent's
 * PERCENTILE / RANK STATISTICS, or the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM. The heart
 * of this service is WEIGHTED INTERVAL SCHEDULING via DYNAMIC PROGRAMMING: sort the requests by end time,
 * compute for each request i the latest earlier request p(i) that does NOT overlap it, and fill the recurrence
 * dp[i] = max(dp[i-1], weight_i + dp[p(i)]) — then backtrack to recover the max-weight compatible subset. A
 * greedy earliest-finish rule maximizes the COUNT of appointments but can leave clinical VALUE on the table
 * (two short low-acuity blocks beat one long high-acuity block by count, but not by weight); the DP maximizes
 * the total weight the resource actually delivers. So this selects DETERMINISTICALLY and hands the schedule to
 * a human.
 *
 *   Inbound:  a BlockScheduleRequest { resourceRef, requests[] }  (each request a half-open [start, end) window + a weight)
 *   Outbound: a BlockScheduleDetermination { selected[], totalWeight, scheduledCount, contendedCount, total,
 *             disposition, requiresSchedulerReview:true, autoBooked:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the selection is sourced and feasible.
 * ─────────────────────────────────────────────────────────────────────
 *  A schedule is trustworthy only if it is a REAL, FEASIBLE subset of the submitted requests: every selected
 *  id must be a SUBMITTED request (no FABRICATED block, none double-counted), the selected windows must be
 *  pairwise NON-OVERLAPPING (the resource is never double-booked), the reported totalWeight must equal the sum
 *  of the selected weights, the counts must add up (scheduled + contended = total = requests), and the
 *  disposition must follow. A fabricated block or a double-booked resource corrupts the schedule.
 *  selectionSourced() verifies it; the Agent Fabric enforces it via policy.block-schedule.selection-sourced.
 *  It does NOT recompute the optimum — that is the optimality gate's job — so the two are isolable. (The
 *  sourced + feasibility gate — mirrors the Scheduling Conflict Agent's intervals-sourced + conflict-free and
 *  the Care Routing Agent's path-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the selection is optimal (the DP recomputes).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running the weighted-interval-scheduling DP over the submitted requests must reproduce the reported
 *  totalWeight (and the same all-scheduled / contended disposition). A sub-optimal schedule silently leaves
 *  clinical value unbooked — a request that SHOULD have been scheduled sits contended so the resource delivers
 *  less than it could. selectionOptimal() recomputes the optimum end-to-end, INDEPENDENT of the reported
 *  selection (it recomputes the max weight from the requests, not from the reported selected set), so a
 *  fabricated-block selection that still reports the optimal total fails sourced only, and a real-but-
 *  sub-optimal selection fails optimal only — the two gates are isolable. The Agent Fabric enforces it via
 *  policy.block-schedule.schedule-optimal. (The load-bearing correctness gate — mirrors the Care Routing
 *  Agent's route-optimal and the Outreach Prioritization Agent's selection-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous booking.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent SELECTS on paper — it never books, bumps, or confirms a block on its own (each is a scheduling
 *  action that must be authorized); every schedule is a RECOMMENDATION requiring a scheduler to confirm.
 *  noAutonomousBooking() reports the honest signal the Agent Fabric enforces via
 *  policy.block-schedule.no-autonomous-booking. (Mirrors the Scheduling Conflict Agent's no-autonomous-booking
 *  and the Caseload Balancing Agent's no-autonomous-assignment — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A schedule — all-scheduled or contended — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresSchedulerReview:true, autoBooked:false). A GOVERNANCE BLOCK is when a caller PRESENTS an offending
 *  DETERMINATION (a fabricated / double-booked selection, a sub-optimal schedule, or an autonomous booking) —
 *  which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified scheduling / capacity system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real resource scheduling uses provider availability calendars, appointment-type durations, buffer /
 *  turnover times, room / equipment constraints, and staffing ratios — not a bare weighted-interval DP over a
 *  handful of windows. This optimizes the supplied illustrative requests only. TIME IS DATA: the windows are
 *  plain numbers (epoch-minutes / slot indices), and the selection is a pure function of the requests (no
 *  clock, no randomness), so the same request always yields the same determination, which is what lets the
 *  demo, the seeded trace, and the tests agree. The resource + requests are clearly-labeled ILLUSTRATIVE
 *  synthetics. It IS PHI-bearing — each request references the patient being scheduled.
 */

/** One competing request for the shared resource: a half-open [start, end) window + a priority weight. */
export type ResourceRequest = {
  requestId: string;
  /** Window start (epoch-minutes / slot index). Half-open: the window is [start, end). */
  start: number;
  /** Window end (exclusive). A request ending exactly when another starts does NOT overlap it. */
  end: number;
  /** Priority weight (clinical value / acuity). Non-negative. */
  weight: number;
  label?: string;
};

/** A scheduling request: a shared resource + the competing requests for it. */
export type BlockScheduleRequest = {
  resourceRef: string;
  requests: ResourceRequest[];
};

export type BlockScheduleDisposition = "all-scheduled" | "contended";

/** The deterministic finding the agent returns. */
export type BlockScheduleDetermination = {
  resourceRef: string;
  /** The submitted requests, echoed so the guards can recompute. */
  requests: ResourceRequest[];
  /** The ids of the selected (max-weight, non-overlapping) requests, in schedule (end-ascending) order. */
  selected: string[];
  /** The sum of the selected requests' weights (the optimum). */
  totalWeight: number;
  scheduledCount: number;
  contendedCount: number;
  total: number;
  disposition: BlockScheduleDisposition;
  /** Always true — a scheduler confirms every schedule. */
  requiresSchedulerReview: true;
  /** Always false — the agent never autonomously books. */
  autoBooked: false;
  reason: string;
  synthetic: true;
  note: string;
};

type IndexedRequest = ResourceRequest & { _i: number };

/** Stable end-ascending order (tie-break: start asc, then requestId) — the canonical DP order. */
function sortByEnd(requests: ResourceRequest[]): IndexedRequest[] {
  return requests
    .map((r, i) => ({ ...r, _i: i }))
    .sort(
      (a, b) =>
        a.end - b.end ||
        a.start - b.start ||
        (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0)
    );
}

/**
 * WEIGHTED INTERVAL SCHEDULING via DYNAMIC PROGRAMMING — the heart of the service. Sort the requests by end
 * time; for each request i compute p(i) = the latest earlier request that does NOT overlap it (end <= start,
 * half-open); fill dp[i] = max(dp[i-1], weight_i + dp[p(i)]); backtrack to recover the max-weight compatible
 * subset. Returns the selected request ids (in end-ascending order) and the optimum weight. Deterministic:
 * ties in the recurrence resolve toward INCLUDING the current request (>=), and the sort is stable.
 */
export function weightedIntervalSchedule(requests: ResourceRequest[]): {
  selected: string[];
  weight: number;
} {
  const n = requests.length;
  if (n === 0) return { selected: [], weight: 0 };
  const sorted = sortByEnd(requests);

  // p(i): latest j < i with sorted[j].end <= sorted[i].start (compatible, half-open).
  const p = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (sorted[j].end <= sorted[i].start) {
        p[i] = j;
        break;
      }
    }
  }

  const dp = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const incl = sorted[i].weight + (p[i] >= 0 ? dp[p[i]] : 0);
    const excl = i > 0 ? dp[i - 1] : 0;
    dp[i] = incl >= excl ? incl : excl;
  }

  // Backtrack to recover the chosen set.
  const chosen: IndexedRequest[] = [];
  let i = n - 1;
  while (i >= 0) {
    const incl = sorted[i].weight + (p[i] >= 0 ? dp[p[i]] : 0);
    const excl = i > 0 ? dp[i - 1] : 0;
    if (incl >= excl) {
      chosen.push(sorted[i]);
      i = p[i];
    } else {
      i = i - 1;
    }
  }
  chosen.reverse();
  return { selected: chosen.map((c) => c.requestId), weight: dp[n - 1] };
}

/** Are two windows overlapping? Half-open [start, end): touching endpoints do NOT overlap. */
function overlaps(a: ResourceRequest, b: ResourceRequest): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The deterministic selection function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own requests (no randomness, no clock). It runs the weighted-interval-scheduling DP and returns
 * the max-weight non-overlapping subset. Nothing is booked — the schedule is handed to a scheduler.
 */
export function evaluateBlockSchedule(request: BlockScheduleRequest): BlockScheduleDetermination {
  const requests = Array.isArray(request.requests) ? request.requests : [];
  const { selected, weight } = weightedIntervalSchedule(requests);
  const total = requests.length;
  const scheduledCount = selected.length;
  const contendedCount = total - scheduledCount;
  const disposition: BlockScheduleDisposition =
    contendedCount > 0 ? "contended" : "all-scheduled";

  const reason =
    contendedCount > 0
      ? `Selected ${scheduledCount} of ${total} request(s) for ${request.resourceRef} by max-weight non-overlapping selection (total weight ${weight}); ${contendedCount} contended.`
      : `Scheduled all ${total} request(s) for ${request.resourceRef} \u2014 no contention (total weight ${weight}).`;

  return {
    resourceRef: request.resourceRef,
    requests,
    selected,
    totalWeight: weight,
    scheduledCount,
    contendedCount,
    total,
    disposition,
    requiresSchedulerReview: true,
    autoBooked: false,
    reason,
    synthetic: true,
    note:
      `Resource-block schedule ${request.resourceRef}: ${disposition.toUpperCase()} \u2014 ` +
      `${scheduledCount}/${total} request(s) selected for total weight ${weight} via WEIGHTED INTERVAL SCHEDULING (DYNAMIC PROGRAMMING)` +
      (contendedCount > 0 ? `, ${contendedCount} contended.` : ".") +
      " Real resource scheduling uses provider availability calendars, appointment-type durations, buffer / turnover times, and room / equipment constraints \u2014 not a bare weighted-interval DP over a handful of windows. Synthetic/illustrative resource + requests \u2014 NOT a certified scheduling / capacity system. The agent never books, bumps, or confirms a block on its own \u2014 a scheduler confirms every schedule. PHI-bearing \u2014 each request references the patient being scheduled."
  };
}

/** Index the submitted requests by id (for the guards). */
function requestById(requests: ResourceRequest[]): Map<string, ResourceRequest> {
  const m = new Map<string, ResourceRequest>();
  for (const r of requests) m.set(r.requestId, r);
  return m;
}

/**
 * Sourced + feasibility check: is the reported selection a REAL, FEASIBLE subset of the submitted requests?
 * Every selected id must be a SUBMITTED request (no fabricated block, none double-counted), the selected
 * windows must be pairwise NON-OVERLAPPING (the resource is never double-booked), the reported totalWeight
 * must equal the sum of the selected weights, the counts must add up (scheduled + contended = total =
 * requests), and the disposition must follow. Catches a fabricated block or a double-booked resource. Does
 * NOT recompute the optimum (that is the optimality gate's job), so it is independent of it. Anything
 * evaluateBlockSchedule() produces satisfies it. This is the honest signal the schedule reports to
 * policy.block-schedule.selection-sourced. A non-object / malformed input is a violation.
 */
export function selectionSourced(
  decision:
    | {
        requests?: unknown;
        selected?: unknown;
        totalWeight?: unknown;
        scheduledCount?: unknown;
        contendedCount?: unknown;
        total?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const requests = Array.isArray(decision.requests) ? (decision.requests as ResourceRequest[]) : null;
  const selected = Array.isArray(decision.selected) ? (decision.selected as string[]) : null;
  if (!requests || !selected) return false;

  const byId = requestById(requests);
  const seen = new Set<string>();
  const picked: ResourceRequest[] = [];
  let sum = 0;
  for (const id of selected) {
    if (typeof id !== "string") return false;
    if (seen.has(id)) return false; // double-counted
    const r = byId.get(id);
    if (!r) return false; // fabricated block
    seen.add(id);
    picked.push(r);
    sum += r.weight;
  }

  // Pairwise non-overlapping (the resource is never double-booked).
  for (let a = 0; a < picked.length; a++) {
    for (let b = a + 1; b < picked.length; b++) {
      if (overlaps(picked[a], picked[b])) return false;
    }
  }

  if (typeof decision.totalWeight !== "number" || decision.totalWeight !== sum) return false;
  if (typeof decision.total !== "number" || decision.total !== requests.length) return false;
  if (decision.scheduledCount !== selected.length) return false;
  if (decision.contendedCount !== requests.length - selected.length) return false;
  const expectedDisposition: BlockScheduleDisposition =
    requests.length - selected.length > 0 ? "contended" : "all-scheduled";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }
  return true;
}

/**
 * Optimality check: re-running the weighted-interval-scheduling DP over the submitted requests must reproduce
 * the reported totalWeight and the same all-scheduled / contended disposition. True only when the recompute
 * agrees. Catches a sub-optimal schedule that silently leaves clinical value unbooked. The load-bearing
 * correctness gate — it recomputes the optimum from the requests INDEPENDENT of the reported selection (it
 * recomputes the max weight, not the reported selected set), so a fabricated-block selection that still
 * reports the optimal total fails sourced while recomputing here, and a real-but-sub-optimal selection fails
 * here while passing sourced — the two gates are isolable. Anything evaluateBlockSchedule() produces satisfies
 * it. A non-object input is a violation.
 */
export function selectionOptimal(
  decision:
    | { requests?: unknown; totalWeight?: unknown; disposition?: unknown }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const requests = Array.isArray(decision.requests) ? (decision.requests as ResourceRequest[]) : null;
  if (!requests) return false;

  const { selected, weight } = weightedIntervalSchedule(requests);
  if (decision.totalWeight !== weight) return false;
  const expectedDisposition: BlockScheduleDisposition =
    requests.length - selected.length > 0 ? "contended" : "all-scheduled";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }
  return true;
}

/**
 * No-autonomous-booking check: did the agent avoid booking on its own? True unless the determination reports
 * it auto-booked (autoBooked:true) or does not require scheduler review (requiresSchedulerReview:false).
 * Anything evaluateBlockSchedule() produces satisfies it. This is the honest signal the schedule reports to
 * policy.block-schedule.no-autonomous-booking. A non-object input is a violation.
 */
export function noAutonomousBooking(
  decision: { autoBooked?: boolean; requiresSchedulerReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoBooked === true) return false;
  if (decision.requiresSchedulerReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a schedule. */
export function blockScheduleSummary(decision: BlockScheduleDetermination): {
  resourceRef: string;
  disposition: BlockScheduleDisposition;
  requestCount: number;
  scheduledCount: number;
  contendedCount: number;
  totalWeight: number;
  total: number;
  requiresSchedulerReview: boolean;
  synthetic: boolean;
} {
  return {
    resourceRef: decision.resourceRef,
    disposition: decision.disposition,
    requestCount: decision.requests.length,
    scheduledCount: decision.scheduledCount,
    contendedCount: decision.contendedCount,
    totalWeight: decision.totalWeight,
    total: decision.total,
    requiresSchedulerReview: decision.requiresSchedulerReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: five competing requests for one infusion chair. The max-weight non-
 * overlapping subset is { infusion-1101, infusion-1104 } for a total weight of 11 (contended — three
 * requests can't fit). Windows are epoch-minutes from the top of the chair's day. Synthetic; PHI-bearing.
 */
export const DEMO_BLOCK_SCHEDULE_REQUEST: BlockScheduleRequest = {
  resourceRef: "infusion-chair-3",
  requests: [
    { requestId: "infusion-1101", start: 0, end: 3, weight: 5, label: "High-acuity infusion" },
    { requestId: "infusion-1102", start: 2, end: 5, weight: 4, label: "Routine infusion" },
    { requestId: "infusion-1103", start: 4, end: 7, weight: 3, label: "Routine infusion" },
    { requestId: "infusion-1104", start: 6, end: 9, weight: 6, label: "High-acuity infusion" },
    { requestId: "infusion-1105", start: 5, end: 8, weight: 2, label: "Low-acuity infusion" }
  ]
};

/** A representative demo request whose requests are all mutually non-overlapping (all-scheduled). Synthetic. */
export const DEMO_BLOCK_SCHEDULE_ALL_REQUEST: BlockScheduleRequest = {
  resourceRef: "or-block-a",
  requests: [
    { requestId: "or-2201", start: 0, end: 2, weight: 4, label: "Case A" },
    { requestId: "or-2202", start: 2, end: 4, weight: 5, label: "Case B" },
    { requestId: "or-2203", start: 4, end: 6, weight: 3, label: "Case C" }
  ]
};

/**
 * A representative demo request highlighting that WEIGHT (not count) drives the selection: two short
 * low-weight windows overlap one long high-weight window. A greedy earliest-finish rule would take the two
 * short ones (count 2, weight 6); the weighted DP takes the single long one (weight 10). Synthetic.
 */
export const DEMO_BLOCK_SCHEDULE_WEIGHTED_REQUEST: BlockScheduleRequest = {
  resourceRef: "mri-scanner-1",
  requests: [
    { requestId: "mri-3301", start: 0, end: 6, weight: 10, label: "Complex protocol (long)" },
    { requestId: "mri-3302", start: 0, end: 2, weight: 3, label: "Screening (short)" },
    { requestId: "mri-3303", start: 2, end: 4, weight: 3, label: "Screening (short)" }
  ]
};
