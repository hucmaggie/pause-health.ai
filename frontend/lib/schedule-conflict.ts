/**
 * Scheduling Conflict / Double-Booking Guard — the deterministic, transparent care-coordination layer
 * that takes a RESOURCE (a provider's clinic day, an infusion chair, an imaging machine) and a batch of
 * REQUESTED APPOINTMENT INTERVALS (each a start/end time for a patient), computes the MAXIMUM
 * CONFLICT-FREE SCHEDULE that fits on that resource without double-booking, and WAITLISTS the requests
 * that collide — never autonomously BOOKING, CANCELLING, or BUMPING an appointment; a scheduler confirms
 * the schedule.
 *
 * Deterministic, dependency-free domain core the Schedule Conflict agent (app/api/agents/schedule-conflict)
 * wraps — a care-coordination service on the patient / clinical plane of Pause's Agent Fabric. UNLIKE the
 * Caseload Balancing agent's GREEDY BIN-PACKING under a capacity constraint, the Access Anomaly agent's
 * SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING + GAP DETECTION, the Care
 * Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the
 * Member Cost-Share agent's SEQUENTIAL dollar waterfall, the OIG Exclusion agent's identity MATCHING, or
 * the Audit Log Integrity agent's HASH CHAIN — and UNLIKE the DATE-DEADLINE agents (Timely Filing, Right
 * of Access, Amendment) that add N days to a single date — the heart of this service is GREEDY INTERVAL
 * SELECTION (the classic activity-selection algorithm: sort the requested intervals by EARLIEST FINISH
 * TIME and greedily admit each one that does not overlap the last admitted, which provably maximizes the
 * number of non-overlapping appointments). Note the contrast with the Coverage Continuity agent: that one
 * MERGES overlapping intervals into continuous spans; this one SELECTS a maximum NON-overlapping subset.
 *
 *   Inbound:  a ScheduleConflictRequest { requestRef, resourceRef, requests[] }  (each request an interval)
 *   Outbound: a ScheduleConflictDetermination { disposition, scheduled[], conflicts[], intervals[],
 *             invalidRequests[], totalRequests, scheduledCount, conflictCount, requiresSchedulerReview:true,
 *             autoBooked:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the Appointment Scheduling agent (which BOOKS a SINGLE slot
 * against a provider's calendar and never double-books THAT slot): this one validates a WHOLE BATCH of
 * requests for a resource, computes the conflict-free schedule + the waitlist, and hands it to a scheduler
 * — the double-booking guard for a day, not the booker of one appointment.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every scheduled / conflicting interval is sourced, and every request is
 *  accounted for exactly once.
 * ─────────────────────────────────────────────────────────────────────
 *  A schedule is trustworthy only if every appointment on it — scheduled OR waitlisted — traces to a
 *  submitted request (same id, member, start, end), and every submitted request appears exactly once
 *  across the scheduled set and the conflict set (no fabricated appointment, no dropped patient, no
 *  double-count). scheduleIntervalsSourced() verifies it; the Agent Fabric enforces it via
 *  policy.schedule.intervals-sourced. (The sourced + completeness gate — mirrors the Caseload Balancing
 *  Agent's assignment-complete and the Coverage Continuity Agent's segments-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the scheduled set is truly conflict-free, and every waitlist is justified.
 * ─────────────────────────────────────────────────────────────────────
 *  The scheduled appointments must be pairwise NON-overlapping (no double-booking on the resource), and
 *  every waitlisted request must genuinely conflict — its interval must overlap a scheduled interval (the
 *  one named in conflictsWith) — and the counts must add up. A scheduled pair that overlaps is a
 *  double-booking; a request waitlisted while it actually fit is a patient turned away for nothing.
 *  scheduleConflictFree() recomputes the overlaps and checks every justification; the Agent Fabric
 *  enforces it via policy.schedule.conflict-free. (The load-bearing correctness gate — mirrors the
 *  Caseload Balancing Agent's capacity-respected and the Access Anomaly Agent's window-count-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: an appointment is never autonomously booked / cancelled / bumped.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent RECOMMENDS — it never BOOKS, CANCELS, or BUMPS an appointment (each is a scheduling action
 *  that must be authorized); every schedule is a RECOMMENDATION requiring a scheduler to confirm.
 *  scheduleNoAutonomousBooking() reports the honest signal the Agent Fabric enforces via
 *  policy.schedule.no-autonomous-booking. (Mirrors the Caseload Balancing Agent's no-autonomous-assignment
 *  and the Appointment Scheduling Agent's governance posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE SCHEDULE vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A schedule — fully conflict-free OR partial with a waitlist — is a SAFE, honest OUTPUT: the task
 *  COMPLETES (it carries requiresSchedulerReview:true, autoBooked:false). A GOVERNANCE BLOCK is when a
 *  caller PRESENTS an offending DETERMINATION (one that fabricates or drops an appointment, double-books
 *  the resource, waitlists a request that fit, or autonomously books) — which the Agent Fabric rejects
 *  before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified scheduling system.
 * ─────────────────────────────────────────────────────────────────────
 *  The resource + requested intervals below are clearly-labeled ILLUSTRATIVE synthetics chosen to model
 *  the SHAPE of a conflict-free-scheduling computation deterministically in the demo. Real scheduling uses
 *  provider availability calendars, appointment-type durations, buffer / turnover times, room and
 *  equipment constraints, and the scheduler's judgment. TIME IS DATA: the schedule is a pure function of
 *  the request's own intervals (times are accepted as data — ISO strings or epoch-ms — and there is NO
 *  reliance on the real clock), so the same batch always yields the same schedule, which is what lets the
 *  demo, the seeded trace, and the tests agree.
 */

/** A requested appointment interval for the resource. Times may be ISO 8601 strings or epoch-ms. */
export type AppointmentRequest = {
  /** The request identifier. */
  requestId: string;
  /** The patient the appointment is for. */
  memberId: string;
  /** The interval start (ISO 8601 string or epoch-ms). */
  start: string | number;
  /** The interval end (ISO 8601 string or epoch-ms). */
  end: string | number;
};

/** A scheduling-conflict request. */
export type ScheduleConflictRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** The resource being scheduled (a provider day, a chair, a machine). */
  resourceRef: string;
  /** The requested appointment intervals. */
  requests: AppointmentRequest[];
};

/** A validated, echoed interval (times resolved to epoch-ms). */
export type EchoedInterval = {
  requestId: string;
  memberId: string;
  startMs: number;
  endMs: number;
};

/** A scheduled appointment (admitted to the conflict-free schedule). */
export type ScheduledSlot = {
  requestId: string;
  memberId: string;
  startMs: number;
  endMs: number;
};

/** A waitlisted appointment (conflicts with a scheduled one). */
export type ConflictingSlot = {
  requestId: string;
  memberId: string;
  startMs: number;
  endMs: number;
  /** The requestId of the scheduled interval this one overlaps. */
  conflictsWith: string;
};

/** The disposition of a scheduling-conflict run. */
export type ScheduleConflictDisposition = "conflict-free" | "conflicts-waitlisted";

/** The deterministic schedule the agent returns. */
export type ScheduleConflictDetermination = {
  requestRef: string;
  resourceRef: string;
  disposition: ScheduleConflictDisposition;
  /** The conflict-free scheduled appointments (sorted by start, then request id). */
  scheduled: ScheduledSlot[];
  /** The waitlisted (conflicting) appointments (sorted by start, then request id). */
  conflicts: ConflictingSlot[];
  /** The validated intervals, echoed so the honesty guards are self-contained. */
  intervals: EchoedInterval[];
  /** Any requests that could not be parsed (missing id / non-positive duration / bad time). */
  invalidRequests: string[];
  /** The number of valid requests. */
  totalRequests: number;
  /** The number of scheduled appointments. */
  scheduledCount: number;
  /** The number of waitlisted (conflicting) appointments. */
  conflictCount: number;
  /** Always true — a scheduler confirms every schedule. */
  requiresSchedulerReview: true;
  /** Always false — the agent never autonomously books / cancels / bumps. */
  autoBooked: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the resource + intervals are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * Resolve a time value (ISO 8601 string or epoch-ms number) to an integer epoch-ms, or null if it can't
 * be parsed. Deterministic: ISO strings are parsed as absolute instants (UTC when a `Z` / offset is
 * present); there is no reliance on the current clock.
 */
export function toEpochMs(value: string | number): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** Whether two half-open intervals [aStart,aEnd) and [bStart,bEnd) overlap (touching is NOT overlap). */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * The deterministic scheduling function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own intervals (no randomness, no clock). It validates the requests (parseable start <
 * end), then runs the classic ACTIVITY-SELECTION greedy: it sorts the intervals by EARLIEST FINISH time
 * (ties by start, then request id) and admits each interval whose start is at or after the last admitted
 * interval's end — provably maximizing the number of non-overlapping appointments — waitlisting each one
 * that overlaps the last admitted (recording which scheduled interval it conflicts with). Nothing is
 * booked here — the schedule is handed to a scheduler.
 */
export function evaluateScheduleConflict(
  request: ScheduleConflictRequest
): ScheduleConflictDetermination {
  const rawRequests = Array.isArray(request.requests) ? request.requests : [];

  // Validate + resolve intervals.
  const intervals: EchoedInterval[] = [];
  const invalidRequests: string[] = [];
  const seenIds = new Set<string>();
  for (const r of rawRequests) {
    if (!r || typeof r.requestId !== "string" || typeof r.memberId !== "string" || seenIds.has(r.requestId)) {
      if (r && typeof r.requestId === "string") invalidRequests.push(r.requestId);
      continue;
    }
    const startMs = toEpochMs(r.start);
    const endMs = toEpochMs(r.end);
    if (startMs === null || endMs === null || startMs >= endMs) {
      invalidRequests.push(r.requestId);
      continue;
    }
    seenIds.add(r.requestId);
    intervals.push({ requestId: r.requestId, memberId: r.memberId, startMs, endMs });
  }

  // Activity-selection: sort by earliest finish, then start, then id.
  const order = intervals
    .slice()
    .sort(
      (a, b) =>
        a.endMs !== b.endMs
          ? a.endMs - b.endMs
          : a.startMs !== b.startMs
            ? a.startMs - b.startMs
            : a.requestId.localeCompare(b.requestId)
    );

  const scheduled: ScheduledSlot[] = [];
  const conflicts: ConflictingSlot[] = [];
  let lastAdmitted: EchoedInterval | null = null;
  for (const iv of order) {
    if (lastAdmitted === null || iv.startMs >= lastAdmitted.endMs) {
      scheduled.push({
        requestId: iv.requestId,
        memberId: iv.memberId,
        startMs: iv.startMs,
        endMs: iv.endMs
      });
      lastAdmitted = iv;
    } else {
      conflicts.push({
        requestId: iv.requestId,
        memberId: iv.memberId,
        startMs: iv.startMs,
        endMs: iv.endMs,
        conflictsWith: lastAdmitted.requestId
      });
    }
  }

  const bySlot = (a: { startMs: number; requestId: string }, b: { startMs: number; requestId: string }) =>
    a.startMs !== b.startMs ? a.startMs - b.startMs : a.requestId.localeCompare(b.requestId);
  scheduled.sort(bySlot);
  conflicts.sort(bySlot);

  const totalRequests = intervals.length;
  const scheduledCount = scheduled.length;
  const conflictCount = conflicts.length;

  const disposition: ScheduleConflictDisposition =
    conflictCount > 0 ? "conflicts-waitlisted" : "conflict-free";

  const reason =
    conflictCount > 0
      ? `Resource ${request.resourceRef}: ${scheduledCount} of ${totalRequests} request(s) fit conflict-free; ${conflictCount} waitlisted (they overlap a scheduled appointment on this resource).`
      : `Resource ${request.resourceRef}: all ${totalRequests} request(s) fit conflict-free — no double-booking.`;

  return {
    requestRef: request.requestRef,
    resourceRef: request.resourceRef,
    disposition,
    scheduled,
    conflicts,
    intervals,
    invalidRequests,
    totalRequests,
    scheduledCount,
    conflictCount,
    requiresSchedulerReview: true,
    autoBooked: false,
    reason,
    synthetic: true,
    note:
      `Schedule conflict guard ${request.requestRef}: ${disposition.toUpperCase()} — ${scheduledCount}/${totalRequests} request(s) scheduled conflict-free on ${request.resourceRef}, ${conflictCount} waitlisted.` +
      (invalidRequests.length > 0 ? ` ${invalidRequests.length} request(s) skipped as invalid.` : "") +
      " PHI-bearing — the requests reference the patients being scheduled. Synthetic/illustrative — NOT a certified scheduling system; real scheduling uses provider availability calendars, appointment-type durations, buffer / turnover times, and room / equipment constraints. The agent never books, cancels, or bumps an appointment on its own — a scheduler confirms every schedule."
  };
}

/**
 * Intervals-sourced + complete check: does every scheduled / conflicting appointment trace to a submitted
 * request (same id, member, start, end), and is every request accounted for exactly once across the two
 * sets? True only when the scheduled ids and the conflict ids are disjoint, together cover every submitted
 * interval exactly once, and each references a real interval with matching fields. Catches a fabricated
 * appointment, a dropped patient, or a double-count. Anything evaluateScheduleConflict() produces
 * satisfies it. This is the honest signal the route reports to policy.schedule.intervals-sourced. A
 * non-object / malformed input is a violation.
 */
export function scheduleIntervalsSourced(
  decision:
    | {
        intervals?: Array<{ requestId?: unknown; memberId?: unknown; startMs?: unknown; endMs?: unknown }>;
        scheduled?: Array<{ requestId?: unknown; memberId?: unknown; startMs?: unknown; endMs?: unknown }>;
        conflicts?: Array<{ requestId?: unknown; memberId?: unknown; startMs?: unknown; endMs?: unknown }>;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const intervals = Array.isArray(decision.intervals) ? decision.intervals : null;
  const scheduled = Array.isArray(decision.scheduled) ? decision.scheduled : null;
  const conflicts = Array.isArray(decision.conflicts) ? decision.conflicts : null;
  if (!intervals || !scheduled || !conflicts) return false;

  const byId = new Map<string, { memberId: string; startMs: number; endMs: number }>();
  for (const iv of intervals) {
    if (
      !iv ||
      typeof iv.requestId !== "string" ||
      typeof iv.memberId !== "string" ||
      typeof iv.startMs !== "number" ||
      typeof iv.endMs !== "number"
    ) {
      return false;
    }
    if (byId.has(iv.requestId)) return false; // duplicate submitted interval
    byId.set(iv.requestId, { memberId: iv.memberId, startMs: iv.startMs, endMs: iv.endMs });
  }

  const seen = new Set<string>();
  const check = (slot: { requestId?: unknown; memberId?: unknown; startMs?: unknown; endMs?: unknown }): boolean => {
    if (!slot || typeof slot.requestId !== "string") return false;
    if (seen.has(slot.requestId)) return false; // accounted for more than once
    const src = byId.get(slot.requestId);
    if (!src) return false; // fabricated — not a submitted request
    if (slot.memberId !== src.memberId || slot.startMs !== src.startMs || slot.endMs !== src.endMs) {
      return false; // altered attribution / times
    }
    seen.add(slot.requestId);
    return true;
  };

  for (const s of scheduled) if (!check(s)) return false;
  for (const c of conflicts) if (!check(c)) return false;

  // Every submitted interval accounted for exactly once.
  return seen.size === byId.size;
}

/**
 * Conflict-free check: is the scheduled set truly pairwise non-overlapping, and is every waitlist
 * justified? True only when no two scheduled appointments overlap (no double-booking), every conflicting
 * appointment's conflictsWith names a scheduled appointment it genuinely overlaps, and the counts add up.
 * Catches a double-booked resource or a request waitlisted while it actually fit. The load-bearing
 * correctness gate. Anything evaluateScheduleConflict() produces satisfies it. This is the honest signal
 * the route reports to policy.schedule.conflict-free. A non-object input is a violation.
 */
export function scheduleConflictFree(
  decision:
    | {
        scheduled?: Array<{ requestId?: unknown; startMs?: unknown; endMs?: unknown }>;
        conflicts?: Array<{ startMs?: unknown; endMs?: unknown; conflictsWith?: unknown }>;
        totalRequests?: number;
        scheduledCount?: number;
        conflictCount?: number;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const scheduled = Array.isArray(decision.scheduled) ? decision.scheduled : null;
  const conflicts = Array.isArray(decision.conflicts) ? decision.conflicts : null;
  if (!scheduled || !conflicts) return false;

  const sched: { requestId: string; startMs: number; endMs: number }[] = [];
  for (const s of scheduled) {
    if (!s || typeof s.requestId !== "string" || typeof s.startMs !== "number" || typeof s.endMs !== "number") {
      return false;
    }
    sched.push({ requestId: s.requestId, startMs: s.startMs, endMs: s.endMs });
  }

  // Scheduled set must be pairwise non-overlapping.
  for (let i = 0; i < sched.length; i++) {
    for (let j = i + 1; j < sched.length; j++) {
      if (intervalsOverlap(sched[i].startMs, sched[i].endMs, sched[j].startMs, sched[j].endMs)) {
        return false;
      }
    }
  }

  const schedById = new Map(sched.map((s) => [s.requestId, s]));

  // Every conflict must genuinely overlap the scheduled interval it names.
  for (const c of conflicts) {
    if (!c || typeof c.startMs !== "number" || typeof c.endMs !== "number" || typeof c.conflictsWith !== "string") {
      return false;
    }
    const against = schedById.get(c.conflictsWith);
    if (!against) return false; // conflictsWith must name a scheduled interval
    if (!intervalsOverlap(c.startMs, c.endMs, against.startMs, against.endMs)) {
      return false; // waitlisted but doesn't actually conflict
    }
  }

  // Counts must add up.
  if (typeof decision.scheduledCount === "number" && decision.scheduledCount !== sched.length) return false;
  if (typeof decision.conflictCount === "number" && decision.conflictCount !== conflicts.length) return false;
  if (
    typeof decision.totalRequests === "number" &&
    decision.totalRequests !== sched.length + conflicts.length
  ) {
    return false;
  }
  return true;
}

/**
 * No-autonomous-booking check: did the agent avoid autonomously booking / cancelling / bumping? True
 * unless the determination reports it auto-booked (autoBooked:true) or does not require scheduler review
 * (requiresSchedulerReview:false). Anything evaluateScheduleConflict() produces satisfies it. This is the
 * honest signal the route reports to policy.schedule.no-autonomous-booking. A non-object input is a
 * violation.
 */
export function scheduleNoAutonomousBooking(
  decision:
    | { autoBooked?: boolean; requiresSchedulerReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoBooked === true) return false;
  if (decision.requiresSchedulerReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a schedule — the shape stamped onto the Agent Fabric trace + the
 * response `meta`.
 */
export function scheduleConflictSummary(decision: ScheduleConflictDetermination): {
  requestRef: string;
  resourceRef: string;
  disposition: ScheduleConflictDisposition;
  totalRequests: number;
  scheduledCount: number;
  conflictCount: number;
  requiresSchedulerReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: decision.requestRef,
    resourceRef: decision.resourceRef,
    disposition: decision.disposition,
    totalRequests: decision.totalRequests,
    scheduledCount: decision.scheduledCount,
    conflictCount: decision.conflictCount,
    requiresSchedulerReview: decision.requiresSchedulerReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: 3 back-to-back / spaced requests on one resource that all fit
 * CONFLICT-FREE (no double-booking). Synthetic.
 */
export const DEMO_SCHEDULE_CONFLICT_REQUEST: ScheduleConflictRequest = {
  requestRef: "scr-001",
  resourceRef: "provider-mscp-day-2026-03-02",
  requests: [
    { requestId: "r1", memberId: "m1", start: "2026-03-02T09:00:00Z", end: "2026-03-02T09:30:00Z" },
    { requestId: "r2", memberId: "m2", start: "2026-03-02T09:30:00Z", end: "2026-03-02T10:00:00Z" },
    { requestId: "r3", memberId: "m3", start: "2026-03-02T10:15:00Z", end: "2026-03-02T10:45:00Z" }
  ]
};

/**
 * A representative demo request: 4 requests where two overlap the 9-10 appointment, so two are WAITLISTED
 * — the earliest-finish greedy admits r1 (9-10) and r3 (10-11) and waitlists r2 + r4. Synthetic.
 */
export const DEMO_SCHEDULE_CONFLICT_WAITLIST_REQUEST: ScheduleConflictRequest = {
  requestRef: "scr-002",
  resourceRef: "provider-mscp-day-2026-03-03",
  requests: [
    { requestId: "r1", memberId: "m1", start: "2026-03-03T09:00:00Z", end: "2026-03-03T10:00:00Z" },
    { requestId: "r2", memberId: "m2", start: "2026-03-03T09:30:00Z", end: "2026-03-03T10:30:00Z" },
    { requestId: "r3", memberId: "m3", start: "2026-03-03T10:00:00Z", end: "2026-03-03T11:00:00Z" },
    { requestId: "r4", memberId: "m4", start: "2026-03-03T09:45:00Z", end: "2026-03-03T10:15:00Z" }
  ]
};

/**
 * A representative demo request: 3 mutually-arranged requests where the earliest-finish greedy admits TWO
 * (r2 then r3) rather than the single long r1 — proving it MAXIMIZES the count, not "first request wins".
 * Synthetic.
 */
export const DEMO_SCHEDULE_CONFLICT_MAXIMIZE_REQUEST: ScheduleConflictRequest = {
  requestRef: "scr-003",
  resourceRef: "infusion-chair-7",
  requests: [
    { requestId: "r1", memberId: "m1", start: "2026-03-04T09:00:00Z", end: "2026-03-04T11:00:00Z" },
    { requestId: "r2", memberId: "m2", start: "2026-03-04T09:30:00Z", end: "2026-03-04T10:00:00Z" },
    { requestId: "r3", memberId: "m3", start: "2026-03-04T10:30:00Z", end: "2026-03-04T11:30:00Z" }
  ]
};
