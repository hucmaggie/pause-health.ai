/**
 * SLA Worklist Sequencing / Earliest-Deadline-First (EDF) Scheduling — the deterministic, transparent
 * payer-operations layer that, given a single WORKLIST of pending cases for one processor (a UM nurse's
 * queue, an appeals analyst's desk, a claims-review bench) — each case a unit of work with a processing
 * DURATION and an SLA DEADLINE — sequences them EARLIEST-DEADLINE-FIRST, computes each case's cumulative
 * completion time, and flags which cases will BREACH their SLA if worked in that order — without ever
 * dispatching, starting, or reassigning a case. A supervisor confirms.
 *
 * Deterministic, dependency-free domain core the SLA Worklist agent (app/api/agents/sla-worklist) wraps — a
 * work-sequencing agent on the payer & plan-operations plane of Pause's Agent Fabric. CRUCIALLY, this is NOT
 * the Resource Scheduling agent's WEIGHTED INTERVAL SCHEDULING (which SELECTS a max-weight non-overlapping
 * SUBSET of time-windowed requests for one resource — a subset, with dropped requests) and NOT the Scheduling
 * Conflict agent's GREEDY INTERVAL SELECTION (which admits the max COUNT of non-overlapping appointments). It
 * is also UNLIKE the Peak-Window agent's KADANE MAXIMUM-SUBARRAY, the Care Routing agent's DIJKSTRA'S SHORTEST
 * PATH, the Outreach agent's 0/1 KNAPSACK, the Source Consensus agent's MAJORITY VOTE, the Code Taxonomy
 * agent's TRIE LONGEST-PREFIX MATCH, the Timeline Merge agent's K-WAY MERGE, the Provider Benchmarking agent's
 * PERCENTILE / RANK STATISTICS, the Household Composition agent's UNION-FIND, the MLR Rebate agent's
 * LARGEST-REMAINDER APPORTIONMENT, or the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM. The heart
 * of this service is EARLIEST-DEADLINE-FIRST (EDF) SCHEDULING: ORDER the entire worklist by deadline
 * ascending (documented tie-break: earlier deadline first, then lexical case id), then process the cases
 * sequentially from time zero — each case starts when the previous finishes, its completion time is the
 * running cumulative duration, and it BREACHES when its completion time exceeds its deadline. EDF is the
 * classic optimal single-processor discipline: if ANY ordering can meet every deadline, EDF does. So this
 * sequences DETERMINISTICALLY and hands the ordered worklist + the breach list to a human.
 *
 *   Inbound:  a WorklistRequest { queueRef, tasks[] }  (each task a processing duration + an SLA deadline)
 *   Outbound: a WorklistDetermination { scheduled[], lateCount, onTimeCount, total, disposition,
 *             requiresReviewerReview:true, autoDispatched:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the schedule is sourced and self-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  A worklist schedule is trustworthy only if it is a REAL, complete, self-consistent accounting of the
 *  submitted cases: the scheduled list must be a PERMUTATION of the submitted tasks (each SUBMITTED case
 *  appears exactly once — no FABRICATED case, none dropped or double-worked), each entry must echo its case's
 *  duration + deadline, the completion times must chain (the first starts at zero, each starts when the
 *  previous finishes, each completion = start + duration), each late flag must equal completion > deadline,
 *  the counts must add up, and the disposition must follow. A fabricated case or a mis-chained completion time
 *  corrupts the schedule. scheduleSourced() verifies it; the Agent Fabric enforces it via
 *  policy.worklist.schedule-sourced. It does NOT recompute the EDF ORDER — that is the ordering gate's job —
 *  so the two are isolable. (The sourced + self-consistency gate — mirrors the Resource Scheduling Agent's
 *  selection-sourced and the Scheduling Conflict Agent's intervals-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the order is earliest-deadline-first.
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running the EDF discipline over the submitted cases must reproduce the reported ORDER — the cases must
 *  be sequenced by deadline ascending (tie-break by case id). A non-EDF order needlessly breaches deadlines
 *  that a correct order would have met — the whole point of the discipline. scheduleOrdered() recomputes the
 *  canonical EDF order and checks the reported order against it INDEPENDENT of the reported completion times
 *  (it compares the ordering of the real submitted cases, so a fabricated-case schedule that still orders the
 *  real cases correctly fails sourced only, and a real-but-mis-ordered schedule fails ordered only — the two
 *  gates are isolable). The Agent Fabric enforces it via policy.worklist.edf-ordered. (The load-bearing
 *  correctness gate — mirrors the Resource Scheduling Agent's schedule-optimal and the Care Routing Agent's
 *  route-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous dispatch.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent SEQUENCES on paper — it never dispatches, starts, or reassigns a case on its own (each is a
 *  work-assignment action that must be authorized); every worklist is a RECOMMENDATION requiring a supervisor
 *  to confirm. noAutonomousDispatch() reports the honest signal the Agent Fabric enforces via
 *  policy.worklist.no-autonomous-dispatch. (Mirrors the Resource Scheduling Agent's no-autonomous-booking and
 *  the Caseload Balancing Agent's no-autonomous-assignment — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A worklist — all-on-time or breaches-present — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresReviewerReview:true, autoDispatched:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (a fabricated / mis-chained schedule, a non-EDF order, or an autonomous dispatch) —
 *  which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified workforce / queueing system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real worklist management uses staffing levels, skills-based routing, case arrival times, preemption,
 *  priority tiers, and shift schedules — not a bare single-processor EDF over a handful of cases. This
 *  sequences the supplied illustrative worklist only. TIME IS DATA: durations + deadlines are plain numbers
 *  (minutes from the top of the shift), and the sequencing is a pure function of the tasks (no clock, no
 *  randomness), so the same request always yields the same determination, which is what lets the demo, the
 *  seeded trace, and the tests agree. The worklist is a clearly-labeled ILLUSTRATIVE synthetic. It IS
 *  PHI-bearing — each case references the member / claim being worked.
 */

/** One unit of work: a processing duration + an SLA deadline (both plain numbers, minutes from shift start). */
export type WorklistTask = {
  taskId: string;
  /** Processing time required (minutes). Non-negative. */
  duration: number;
  /** SLA deadline (minutes from shift start). The case breaches when its completion time exceeds this. */
  deadline: number;
  label?: string;
};

/** A worklist request: a single queue + the pending cases for one processor. */
export type WorklistRequest = {
  queueRef: string;
  tasks: WorklistTask[];
};

export type WorklistDisposition = "all-on-time" | "breaches-present";

/** One sequenced case with its computed start / completion time and lateness. */
export type ScheduledTask = {
  taskId: string;
  duration: number;
  deadline: number;
  startTime: number;
  completionTime: number;
  late: boolean;
  label?: string;
};

/** The deterministic finding the agent returns. */
export type WorklistDetermination = {
  queueRef: string;
  /** The submitted cases, echoed so the guards can recompute. */
  tasks: WorklistTask[];
  /** The cases in EDF order, each with its computed completion time + lateness. */
  scheduled: ScheduledTask[];
  lateCount: number;
  onTimeCount: number;
  total: number;
  disposition: WorklistDisposition;
  /** Always true — a supervisor confirms every worklist. */
  requiresReviewerReview: true;
  /** Always false — the agent never autonomously dispatches. */
  autoDispatched: false;
  reason: string;
  synthetic: true;
  note: string;
};

/** The EDF strict-less comparator: earlier deadline first, tie-break by lexical case id. */
function edfLess(a: WorklistTask, b: WorklistTask): boolean {
  if (a.deadline !== b.deadline) return a.deadline < b.deadline;
  return a.taskId < b.taskId;
}

/**
 * EARLIEST-DEADLINE-FIRST (EDF) SCHEDULING — the heart of the service. ORDER the entire worklist by deadline
 * ascending (tie-break by case id), then process sequentially from time zero: each case starts when the
 * previous finishes, its completion time is the running cumulative duration, and it BREACHES when completion
 * exceeds its deadline. Returns the cases in EDF order with their computed times. Deterministic: the sort is
 * stable and fully tie-broken by case id.
 */
export function edfSchedule(tasks: WorklistTask[]): ScheduledTask[] {
  const ordered = [...tasks].sort((a, b) => (edfLess(a, b) ? -1 : edfLess(b, a) ? 1 : 0));
  const scheduled: ScheduledTask[] = [];
  let clock = 0;
  for (const t of ordered) {
    const startTime = clock;
    const completionTime = startTime + t.duration;
    clock = completionTime;
    scheduled.push({
      taskId: t.taskId,
      duration: t.duration,
      deadline: t.deadline,
      startTime,
      completionTime,
      late: completionTime > t.deadline,
      ...(t.label !== undefined ? { label: t.label } : {})
    });
  }
  return scheduled;
}

/**
 * The deterministic sequencing function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own tasks (no randomness, no clock). It runs EDF scheduling and returns the ordered worklist +
 * the breach list. Nothing is dispatched — the worklist is handed to a supervisor.
 */
export function evaluateWorklist(request: WorklistRequest): WorklistDetermination {
  const tasks = Array.isArray(request.tasks) ? request.tasks : [];
  const scheduled = edfSchedule(tasks);
  const total = tasks.length;
  const lateCount = scheduled.filter((s) => s.late).length;
  const onTimeCount = total - lateCount;
  const disposition: WorklistDisposition = lateCount > 0 ? "breaches-present" : "all-on-time";

  const reason =
    lateCount > 0
      ? `Sequenced ${total} case(s) for ${request.queueRef} earliest-deadline-first; ${lateCount} will breach SLA.`
      : `Sequenced ${total} case(s) for ${request.queueRef} earliest-deadline-first \u2014 all on time.`;

  return {
    queueRef: request.queueRef,
    tasks,
    scheduled,
    lateCount,
    onTimeCount,
    total,
    disposition,
    requiresReviewerReview: true,
    autoDispatched: false,
    reason,
    synthetic: true,
    note:
      `SLA worklist ${request.queueRef}: ${disposition.toUpperCase()} \u2014 ` +
      `${total} case(s) sequenced via EARLIEST-DEADLINE-FIRST (EDF) SCHEDULING` +
      (lateCount > 0 ? `, ${lateCount} breaching SLA.` : ", all on time.") +
      " Real worklist management uses staffing levels, skills-based routing, case arrival times, preemption, priority tiers, and shift schedules \u2014 not a bare single-processor EDF over a handful of cases. Synthetic/illustrative worklist \u2014 NOT a certified workforce / queueing system. The agent never dispatches, starts, or reassigns a case on its own \u2014 a supervisor confirms every worklist. PHI-bearing \u2014 each case references the member / claim being worked."
  };
}

/** Index the submitted tasks by id (for the guards). */
function taskById(tasks: WorklistTask[]): Map<string, WorklistTask> {
  const m = new Map<string, WorklistTask>();
  for (const t of tasks) m.set(t.taskId, t);
  return m;
}

/**
 * Sourced + self-consistency check: is the reported schedule a REAL, complete, self-consistent accounting of
 * the submitted cases? The scheduled list must be a PERMUTATION of the submitted tasks (each submitted case
 * once — no fabricated case, none dropped or double-worked), each entry must echo its case's duration +
 * deadline, the completion times must chain (first starts at 0, each starts when the previous finishes, each
 * completion = start + duration), each late flag must equal completion > deadline, the counts must add up, and
 * the disposition must follow. Catches a fabricated case or a mis-chained completion time. Does NOT recompute
 * the EDF order (that is the ordering gate's job), so it is independent of it. Anything evaluateWorklist()
 * produces satisfies it. This is the honest signal the schedule reports to policy.worklist.schedule-sourced. A
 * non-object / malformed input is a violation.
 */
export function scheduleSourced(
  decision:
    | {
        tasks?: unknown;
        scheduled?: unknown;
        lateCount?: unknown;
        onTimeCount?: unknown;
        total?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const tasks = Array.isArray(decision.tasks) ? (decision.tasks as WorklistTask[]) : null;
  const scheduled = Array.isArray(decision.scheduled) ? (decision.scheduled as ScheduledTask[]) : null;
  if (!tasks || !scheduled) return false;
  if (scheduled.length !== tasks.length) return false; // dropped / added

  const byId = taskById(tasks);
  const seen = new Set<string>();
  let clock = 0;
  let lateCount = 0;
  for (const s of scheduled) {
    if (!s || typeof s !== "object") return false;
    if (typeof s.taskId !== "string") return false;
    if (seen.has(s.taskId)) return false; // double-worked
    const t = byId.get(s.taskId);
    if (!t) return false; // fabricated case
    seen.add(s.taskId);
    // Echo the case's duration + deadline.
    if (s.duration !== t.duration || s.deadline !== t.deadline) return false;
    // Completion times must chain.
    if (s.startTime !== clock) return false;
    if (s.completionTime !== s.startTime + s.duration) return false;
    clock = s.completionTime;
    // Late flag must be honest.
    const late = s.completionTime > s.deadline;
    if (s.late !== late) return false;
    if (late) lateCount += 1;
  }

  if (typeof decision.total !== "number" || decision.total !== tasks.length) return false;
  if (decision.lateCount !== lateCount) return false;
  if (decision.onTimeCount !== tasks.length - lateCount) return false;
  const expectedDisposition: WorklistDisposition = lateCount > 0 ? "breaches-present" : "all-on-time";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }
  return true;
}

/**
 * Ordering check: re-running the EDF discipline over the submitted cases must reproduce the reported ORDER —
 * the cases sequenced by deadline ascending (tie-break by case id). True only when the recompute agrees.
 * Catches a non-EDF order that needlessly breaches deadlines. The load-bearing correctness gate — it compares
 * the ORDERING of the real submitted cases INDEPENDENT of the reported completion times: it extracts the
 * subsequence of reported cases that are real submitted cases and verifies that subsequence is in EDF order,
 * so a fabricated-case schedule that still orders the real cases correctly fails sourced (the phantom is
 * filtered out here) while a real-but-mis-ordered schedule fails here — the two gates are isolable. Anything
 * evaluateWorklist() produces satisfies it. A non-object input is a violation.
 */
export function scheduleOrdered(
  decision: { tasks?: unknown; scheduled?: unknown } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const tasks = Array.isArray(decision.tasks) ? (decision.tasks as WorklistTask[]) : null;
  const scheduled = Array.isArray(decision.scheduled) ? (decision.scheduled as ScheduledTask[]) : null;
  if (!tasks || !scheduled) return false;

  const byId = taskById(tasks);
  // The subsequence of reported cases that are real submitted cases, in reported order.
  const realOrder: WorklistTask[] = [];
  for (const s of scheduled) {
    if (!s || typeof s.taskId !== "string") continue;
    const t = byId.get(s.taskId);
    if (t) realOrder.push(t);
  }
  // That subsequence must be in EDF order (each element not strictly-less than its predecessor).
  for (let i = 1; i < realOrder.length; i++) {
    if (edfLess(realOrder[i], realOrder[i - 1])) return false;
  }
  return true;
}

/**
 * No-autonomous-dispatch check: did the agent avoid dispatching on its own? True unless the determination
 * reports it auto-dispatched (autoDispatched:true) or does not require reviewer review
 * (requiresReviewerReview:false). Anything evaluateWorklist() produces satisfies it. This is the honest signal
 * the schedule reports to policy.worklist.no-autonomous-dispatch. A non-object input is a violation.
 */
export function noAutonomousDispatch(
  decision: { autoDispatched?: boolean; requiresReviewerReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoDispatched === true) return false;
  if (decision.requiresReviewerReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a worklist schedule. */
export function worklistSummary(decision: WorklistDetermination): {
  queueRef: string;
  disposition: WorklistDisposition;
  taskCount: number;
  lateCount: number;
  onTimeCount: number;
  total: number;
  requiresReviewerReview: boolean;
  synthetic: boolean;
} {
  return {
    queueRef: decision.queueRef,
    disposition: decision.disposition,
    taskCount: decision.tasks.length,
    lateCount: decision.lateCount,
    onTimeCount: decision.onTimeCount,
    total: decision.total,
    requiresReviewerReview: decision.requiresReviewerReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: four UM authorization cases for one nurse's morning queue. EDF orders them
 * auth-502 → auth-501 → auth-504 → auth-503; auth-504 breaches its 70-minute SLA (it completes at minute 75).
 * Durations + deadlines are minutes from the top of the shift. Synthetic; PHI-bearing.
 */
export const DEMO_WORKLIST_REQUEST: WorklistRequest = {
  queueRef: "um-worklist-am",
  tasks: [
    { taskId: "auth-501", duration: 30, deadline: 60, label: "Prior-auth review" },
    { taskId: "auth-502", duration: 20, deadline: 40, label: "Urgent prior-auth" },
    { taskId: "auth-503", duration: 40, deadline: 200, label: "Concurrent review" },
    { taskId: "auth-504", duration: 25, deadline: 70, label: "Prior-auth review" }
  ]
};

/** A representative demo request whose every case meets its SLA (all-on-time). Synthetic. */
export const DEMO_WORKLIST_ALL_ON_TIME_REQUEST: WorklistRequest = {
  queueRef: "triage-worklist",
  tasks: [
    { taskId: "tri-1", duration: 15, deadline: 90, label: "Triage" },
    { taskId: "tri-2", duration: 15, deadline: 120, label: "Triage" },
    { taskId: "tri-3", duration: 15, deadline: 200, label: "Triage" }
  ]
};

/**
 * A representative demo request that is over-committed — even the optimal EDF order breaches two SLAs, which
 * is exactly the signal a supervisor needs to add staff or triage. Synthetic.
 */
export const DEMO_WORKLIST_TIGHT_REQUEST: WorklistRequest = {
  queueRef: "appeals-worklist",
  tasks: [
    { taskId: "ap-1", duration: 40, deadline: 30, label: "Expedited appeal" },
    { taskId: "ap-2", duration: 40, deadline: 50, label: "Standard appeal" }
  ]
};
