/**
 * Caseload Balancing (Care-Manager Panel Assignment) — the deterministic, transparent care-coordination
 * layer that takes a panel of MEMBERS (each with an acuity weight) and a set of CARE MANAGERS (each with
 * a weighted-slot CAPACITY), and ALLOCATES the members across the managers WITHOUT exceeding any
 * manager's capacity — balancing the load and WAITLISTING the members that do not fit — never
 * autonomously COMMITTING the assignment, reassigning a patient, or overriding a manager's caseload; a
 * care-management lead confirms every allocation.
 *
 * Deterministic, dependency-free domain core the Caseload Balancing agent
 * (app/api/agents/caseload-balancing) wraps — a care-coordination service on the patient / clinical
 * plane of Pause's Agent Fabric. UNLIKE the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage
 * Continuity agent's INTERVAL MERGING + GAP DETECTION, the Care Pathway agent's TOPOLOGICAL ORDERING, the
 * Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar
 * waterfall, the OIG Exclusion agent's identity MATCHING, or the Audit Log Integrity agent's HASH CHAIN
 * — and UNLIKE the DATE-DEADLINE agents (Timely Filing, Right of Access, Amendment) that add N days to a
 * single date — the heart of this service is GREEDY ALLOCATION UNDER A CAPACITY CONSTRAINT (a
 * bin-packing / worst-fit-decreasing assignment of weighted items into capacity-limited bins). A care
 * manager's "panel" is the set of patients they actively manage; each patient carries an acuity (how much
 * attention they need), and each manager has a finite capacity — over-loading a panel is a patient-safety
 * risk, so the allocation must respect capacity and surface the overflow rather than silently drop it.
 *
 *   Inbound:  a CaseloadBalancingRequest { requestRef, panelRef, members[], managers[] }
 *   Outbound: a CaseloadBalancingDetermination { disposition, assignments[], managerLoads[],
 *             waitlisted[], members[], invalidMembers[], invalidManagers[], totalMembers, assignedCount,
 *             waitlistedCount, totalCapacity, totalAssignedAcuity, requiresCareLeadReview: true,
 *             autoAssigned:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other care-coordination agents: distinct from the Care
 * Team & Case Management agent (which assembles the multi-disciplinary team around ONE patient and picks
 * that patient's case manager), the Complex Care Management agent (CCM time-tracking + billing for ONE
 * patient), the Transitions of Care agent (moving ONE patient between settings), and the Population
 * Health agent (which PRIORITIZES / stratifies a panel): this ALLOCATES a whole panel of members across
 * the managers' finite capacity — the balancing of caseloads, not the coordination of one patient's care.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every member is accounted for exactly once.
 * ─────────────────────────────────────────────────────────────────────
 *  An allocation is trustworthy only if EVERY submitted member is either assigned to exactly one manager
 *  OR explicitly waitlisted — never dropped, and never double-counted. A dropped member is a patient who
 *  falls through the cracks (no manager owns their care); a double-assigned member is confusing ownership.
 *  caseloadAssignmentComplete() verifies the assigned set and the waitlisted set are disjoint, cover every
 *  member exactly once, and match the reported counts; it reports the honest signal the Agent Fabric
 *  enforces via policy.caseload.assignment-complete. (The completeness gate — mirrors the Enrollment
 *  Reconciliation Agent's reconciliation-complete and the Accounting of Disclosures Agent's
 *  accountable-disclosures-complete.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no manager is over capacity, and the loads add up.
 * ─────────────────────────────────────────────────────────────────────
 *  The allocation must respect every manager's capacity: each manager's assigned acuity must equal the
 *  sum of their assigned members' acuities, must not exceed their capacity, and the remaining capacity
 *  must be exact; and a waitlisted member must genuinely not fit — its acuity must exceed EVERY manager's
 *  final remaining capacity (a member waitlisted while a manager had room is a wrong, unsafe allocation).
 *  caseloadCapacityRespected() recomputes each manager's load from the assignments, checks it against
 *  capacity, and verifies every waitlist is justified; it reports the honest signal the Agent Fabric
 *  enforces via policy.caseload.capacity-respected. (The load-bearing correctness gate — mirrors the
 *  Access Anomaly Agent's window-count-consistent and the Member Cost-Share Agent's math-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: an assignment is never autonomously committed.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent RECOMMENDS — it never COMMITS the assignment, reassigns a patient, or overrides a manager's
 *  caseload (each is a care-ownership decision that must be authorized); every allocation is a
 *  RECOMMENDATION requiring a care-management lead to confirm. caseloadNoAutonomousAssignment() reports
 *  the honest signal the Agent Fabric enforces via policy.caseload.no-autonomous-assignment. (Mirrors the
 *  Care Team Agent's no-autonomous-assignment and the Coverage Continuity Agent's
 *  no-autonomous-determination posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE ALLOCATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  An allocation — fully assigned OR partially assigned with a waitlist — is a SAFE, honest OUTPUT: the
 *  task COMPLETES (it carries requiresCareLeadReview:true, autoAssigned:false). A GOVERNANCE BLOCK is when
 *  a caller PRESENTS an offending DETERMINATION (one that drops / double-counts a member, over-loads a
 *  manager or miscounts a load, unjustly waitlists a member who fit, or autonomously commits the
 *  assignment) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified caseload / staffing system.
 * ─────────────────────────────────────────────────────────────────────
 *  The members + managers + acuity + capacity below are clearly-labeled ILLUSTRATIVE synthetics chosen to
 *  model the SHAPE of a caseload-balancing allocation deterministically in the demo. Real panel assignment
 *  uses validated acuity instruments, care-manager licensure / specialty match, geographic and language
 *  fit, continuity of an existing relationship, and the care lead's judgment. TIME IS DATA: the allocation
 *  is a pure function of the request's own members + managers — there is NO reliance on the real clock —
 *  so the same panel always yields the same assignment, which is what lets the demo, the seeded trace, and
 *  the tests agree.
 */

/** A single member on the panel to be assigned. */
export type CaseloadMember = {
  /** The member identifier. */
  memberId: string;
  /** The member's acuity — a positive integer weight of how much care attention they need. */
  acuity: number;
};

/** A care manager with a finite weighted-slot capacity. */
export type CareManager = {
  /** The care-manager identifier. */
  managerId: string;
  /** The manager's capacity — the total acuity weight they can hold. */
  capacity: number;
};

/** A caseload-balancing request. */
export type CaseloadBalancingRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic panel reference. */
  panelRef: string;
  /** The members to allocate. */
  members: CaseloadMember[];
  /** The care managers to allocate across. */
  managers: CareManager[];
};

/** A validated, echoed member (acuity a positive integer). */
export type EchoedMember = { memberId: string; acuity: number };

/** A single assignment of a member to a manager. */
export type Assignment = {
  /** The assigned member. */
  memberId: string;
  /** The manager they were assigned to. */
  managerId: string;
  /** The member's acuity (echoed for self-contained guards). */
  acuity: number;
};

/** A manager's resulting load after allocation. */
export type ManagerLoad = {
  /** The manager. */
  managerId: string;
  /** Their capacity. */
  capacity: number;
  /** The total assigned acuity. */
  assignedAcuity: number;
  /** The remaining capacity = capacity − assignedAcuity. */
  remainingCapacity: number;
  /** The number of members assigned. */
  memberCount: number;
  /** The assigned member ids (sorted). */
  memberIds: string[];
};

/** A member who could not be placed within capacity. */
export type WaitlistedMember = {
  /** The member. */
  memberId: string;
  /** Their acuity. */
  acuity: number;
  /** Why they were waitlisted. */
  reason: string;
};

/** The disposition of a caseload-balancing allocation. */
export type CaseloadBalancingDisposition = "fully-assigned" | "partially-assigned-waitlist";

/** The deterministic allocation the agent returns. */
export type CaseloadBalancingDetermination = {
  requestRef: string;
  panelRef: string;
  disposition: CaseloadBalancingDisposition;
  /** The member→manager assignments (sorted by member id). */
  assignments: Assignment[];
  /** The per-manager loads (sorted by manager id). */
  managerLoads: ManagerLoad[];
  /** The members who could not be placed (sorted by member id). */
  waitlisted: WaitlistedMember[];
  /** The validated members, echoed so the honesty guards are self-contained. */
  members: EchoedMember[];
  /** Any members that could not be parsed (missing id / non-positive acuity). */
  invalidMembers: string[];
  /** Any managers that could not be parsed (missing id / negative capacity / duplicate id). */
  invalidManagers: string[];
  /** The number of valid members. */
  totalMembers: number;
  /** The number of assigned members. */
  assignedCount: number;
  /** The number of waitlisted members. */
  waitlistedCount: number;
  /** The sum of the managers' capacities. */
  totalCapacity: number;
  /** The sum of the assigned members' acuities. */
  totalAssignedAcuity: number;
  /** Always true — a care-management lead confirms every allocation. */
  requiresCareLeadReview: true;
  /** Always false — the agent never autonomously commits an assignment. */
  autoAssigned: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the panel is illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Whether a value is a positive integer (acuity). */
function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n) && n > 0;
}

/** Whether a value is a non-negative integer (capacity). */
function isNonNegativeInt(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}

/**
 * The deterministic allocation function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own members + managers (no randomness, no clock). It validates the members (positive
 * integer acuity) and managers (non-negative integer capacity, unique id), then runs a
 * WORST-FIT-DECREASING greedy bin-packing: it processes members in DESCENDING acuity (ties by member id),
 * and for each places it into the manager with the GREATEST remaining capacity that can still fit it
 * (remaining ≥ acuity; ties by manager id) — spreading load evenly — or WAITLISTS it when no manager has
 * room. Nothing is committed here — every allocation is handed to a care-management lead.
 */
export function evaluateCaseloadBalancing(
  request: CaseloadBalancingRequest
): CaseloadBalancingDetermination {
  const rawMembers = Array.isArray(request.members) ? request.members : [];
  const rawManagers = Array.isArray(request.managers) ? request.managers : [];

  // Validate members.
  const echoedMembers: EchoedMember[] = [];
  const invalidMembers: string[] = [];
  for (const m of rawMembers) {
    if (!m || typeof m.memberId !== "string" || !isPositiveInt(m.acuity)) {
      if (m && typeof m.memberId === "string") invalidMembers.push(m.memberId);
      continue;
    }
    echoedMembers.push({ memberId: m.memberId, acuity: m.acuity });
  }

  // Validate managers (unique id, non-negative capacity).
  const seenManagerIds = new Set<string>();
  const validManagers: CareManager[] = [];
  const invalidManagers: string[] = [];
  for (const g of rawManagers) {
    if (!g || typeof g.managerId !== "string" || !isNonNegativeInt(g.capacity) || seenManagerIds.has(g.managerId)) {
      if (g && typeof g.managerId === "string") invalidManagers.push(g.managerId);
      continue;
    }
    seenManagerIds.add(g.managerId);
    validManagers.push({ managerId: g.managerId, capacity: g.capacity });
  }

  // Mutable per-manager state, sorted by manager id for deterministic tie-breaks.
  const state = validManagers
    .slice()
    .sort((a, b) => a.managerId.localeCompare(b.managerId))
    .map((g) => ({ managerId: g.managerId, capacity: g.capacity, remaining: g.capacity, memberIds: [] as string[] }));

  // Worst-fit-decreasing: process members by acuity desc, then id asc.
  const processing = echoedMembers
    .slice()
    .sort((a, b) => (a.acuity !== b.acuity ? b.acuity - a.acuity : a.memberId.localeCompare(b.memberId)));

  const assignments: Assignment[] = [];
  const waitlisted: WaitlistedMember[] = [];
  for (const member of processing) {
    // Eligible = managers whose remaining capacity can still fit this member.
    let chosen: (typeof state)[number] | null = null;
    for (const g of state) {
      if (g.remaining >= member.acuity) {
        // Worst-fit: greatest remaining capacity; ties broken by manager id
        // (state is already sorted by id, so the first max wins deterministically).
        if (chosen === null || g.remaining > chosen.remaining) {
          chosen = g;
        }
      }
    }
    if (chosen) {
      chosen.remaining -= member.acuity;
      chosen.memberIds.push(member.memberId);
      assignments.push({ memberId: member.memberId, managerId: chosen.managerId, acuity: member.acuity });
    } else {
      waitlisted.push({
        memberId: member.memberId,
        acuity: member.acuity,
        reason: `No care manager has remaining capacity ≥ acuity ${member.acuity}.`
      });
    }
  }

  const managerLoads: ManagerLoad[] = state.map((g) => {
    const assignedAcuity = g.capacity - g.remaining;
    return {
      managerId: g.managerId,
      capacity: g.capacity,
      assignedAcuity,
      remainingCapacity: g.remaining,
      memberCount: g.memberIds.length,
      memberIds: g.memberIds.slice().sort((a, b) => a.localeCompare(b))
    };
  });

  assignments.sort((a, b) => a.memberId.localeCompare(b.memberId));
  waitlisted.sort((a, b) => a.memberId.localeCompare(b.memberId));

  const totalCapacity = validManagers.reduce((n, g) => n + g.capacity, 0);
  const totalAssignedAcuity = assignments.reduce((n, a) => n + a.acuity, 0);
  const totalMembers = echoedMembers.length;
  const assignedCount = assignments.length;
  const waitlistedCount = waitlisted.length;

  const disposition: CaseloadBalancingDisposition =
    waitlistedCount > 0 ? "partially-assigned-waitlist" : "fully-assigned";

  const reason =
    waitlistedCount > 0
      ? `Panel ${request.panelRef}: ${assignedCount} of ${totalMembers} member(s) assigned across ${managerLoads.length} manager(s); ${waitlistedCount} waitlisted — total acuity ${totalAssignedAcuity + waitlisted.reduce((n, w) => n + w.acuity, 0)} exceeds total capacity ${totalCapacity}.`
      : `Panel ${request.panelRef}: all ${totalMembers} member(s) assigned across ${managerLoads.length} manager(s) within capacity (assigned acuity ${totalAssignedAcuity} of ${totalCapacity}).`;

  return {
    requestRef: request.requestRef,
    panelRef: request.panelRef,
    disposition,
    assignments,
    managerLoads,
    waitlisted,
    members: echoedMembers,
    invalidMembers,
    invalidManagers,
    totalMembers,
    assignedCount,
    waitlistedCount,
    totalCapacity,
    totalAssignedAcuity,
    requiresCareLeadReview: true,
    autoAssigned: false,
    reason,
    synthetic: true,
    note:
      `Caseload balancing ${request.requestRef}: ${disposition.toUpperCase()} — ${assignedCount}/${totalMembers} member(s) assigned across ${managerLoads.length} manager(s), ${waitlistedCount} waitlisted (assigned acuity ${totalAssignedAcuity} of capacity ${totalCapacity}).` +
      (invalidMembers.length > 0 ? ` ${invalidMembers.length} member(s) skipped as invalid.` : "") +
      (invalidManagers.length > 0 ? ` ${invalidManagers.length} manager(s) skipped as invalid.` : "") +
      " PHI-bearing — the members reference the patients on the panel. Synthetic/illustrative panel — NOT a certified caseload / staffing system; real panel assignment uses validated acuity instruments, care-manager licensure / specialty / language fit, and continuity of an existing relationship. The agent never commits an assignment on its own — a care-management lead confirms every allocation."
  };
}

/**
 * Assignment-complete check: is every member accounted for exactly once? True only when the assigned
 * member ids and the waitlisted member ids are disjoint, together cover every submitted member exactly
 * once (no drop, no duplicate), and the reported counts match. Catches a dropped member (a patient with
 * no owner) or a double-assignment. Anything evaluateCaseloadBalancing() produces satisfies it. This is
 * the honest signal the route reports to policy.caseload.assignment-complete. A non-object / malformed
 * input is a violation.
 */
export function caseloadAssignmentComplete(
  decision:
    | {
        members?: Array<{ memberId?: unknown }>;
        assignments?: Array<{ memberId?: unknown }>;
        waitlisted?: Array<{ memberId?: unknown }>;
        totalMembers?: number;
        assignedCount?: number;
        waitlistedCount?: number;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const members = Array.isArray(decision.members) ? decision.members : null;
  const assignments = Array.isArray(decision.assignments) ? decision.assignments : null;
  const waitlisted = Array.isArray(decision.waitlisted) ? decision.waitlisted : null;
  if (!members || !assignments || !waitlisted) return false;

  const memberIds = new Set<string>();
  for (const m of members) {
    if (!m || typeof m.memberId !== "string") return false;
    if (memberIds.has(m.memberId)) return false; // no duplicate members
    memberIds.add(m.memberId);
  }

  const placed = new Set<string>();
  for (const a of assignments) {
    if (!a || typeof a.memberId !== "string") return false;
    if (placed.has(a.memberId)) return false; // no double-assignment
    if (!memberIds.has(a.memberId)) return false; // must be a real member
    placed.add(a.memberId);
  }
  for (const w of waitlisted) {
    if (!w || typeof w.memberId !== "string") return false;
    if (placed.has(w.memberId)) return false; // not both assigned and waitlisted
    if (!memberIds.has(w.memberId)) return false;
    placed.add(w.memberId);
  }

  // Every member accounted for exactly once.
  if (placed.size !== memberIds.size) return false;

  // Reported counts must match.
  if (typeof decision.totalMembers === "number" && decision.totalMembers !== memberIds.size) return false;
  if (typeof decision.assignedCount === "number" && decision.assignedCount !== assignments.length) return false;
  if (typeof decision.waitlistedCount === "number" && decision.waitlistedCount !== waitlisted.length) return false;
  return true;
}

/**
 * Capacity-respected check: is every manager within capacity, do the loads add up, and is every waitlist
 * justified? True only when each manager's assigned acuity equals the sum of their assigned members'
 * acuities, does not exceed their capacity, and the remaining capacity is exact; every assignment's
 * acuity matches the echoed member; and every waitlisted member's acuity exceeds EVERY manager's final
 * remaining capacity (a waitlist while a manager had room is a wrong allocation). Catches an over-loaded
 * manager, a miscounted load, or an unjust waitlist. The load-bearing correctness gate. Anything
 * evaluateCaseloadBalancing() produces satisfies it. This is the honest signal the route reports to
 * policy.caseload.capacity-respected. A non-object input is a violation.
 */
export function caseloadCapacityRespected(
  decision:
    | {
        members?: Array<{ memberId?: unknown; acuity?: unknown }>;
        assignments?: Array<{ memberId?: unknown; managerId?: unknown; acuity?: unknown }>;
        managerLoads?: Array<{
          managerId?: unknown;
          capacity?: unknown;
          assignedAcuity?: unknown;
          remainingCapacity?: unknown;
          memberCount?: unknown;
          memberIds?: unknown;
        }>;
        waitlisted?: Array<{ acuity?: unknown }>;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const members = Array.isArray(decision.members) ? decision.members : null;
  const assignments = Array.isArray(decision.assignments) ? decision.assignments : null;
  const managerLoads = Array.isArray(decision.managerLoads) ? decision.managerLoads : null;
  const waitlisted = Array.isArray(decision.waitlisted) ? decision.waitlisted : null;
  if (!members || !assignments || !managerLoads || !waitlisted) return false;

  // Member acuity map.
  const acuityOf = new Map<string, number>();
  for (const m of members) {
    if (!m || typeof m.memberId !== "string" || typeof m.acuity !== "number") return false;
    acuityOf.set(m.memberId, m.acuity);
  }

  // Every assignment's acuity must match the echoed member.
  const assignedByManager = new Map<string, { ids: string[]; acuity: number }>();
  for (const a of assignments) {
    if (!a || typeof a.memberId !== "string" || typeof a.managerId !== "string" || typeof a.acuity !== "number") {
      return false;
    }
    if (acuityOf.get(a.memberId) !== a.acuity) return false;
    const bucket = assignedByManager.get(a.managerId) ?? { ids: [], acuity: 0 };
    bucket.ids.push(a.memberId);
    bucket.acuity += a.acuity;
    assignedByManager.set(a.managerId, bucket);
  }

  // Per-manager loads recompute exactly and stay within capacity.
  for (const load of managerLoads) {
    if (
      !load ||
      typeof load.managerId !== "string" ||
      typeof load.capacity !== "number" ||
      typeof load.assignedAcuity !== "number" ||
      typeof load.remainingCapacity !== "number" ||
      typeof load.memberCount !== "number" ||
      !Array.isArray(load.memberIds)
    ) {
      return false;
    }
    const bucket = assignedByManager.get(load.managerId) ?? { ids: [], acuity: 0 };
    if (load.assignedAcuity !== bucket.acuity) return false;
    if (load.memberCount !== bucket.ids.length) return false;
    if (load.memberIds.length !== bucket.ids.length) return false;
    if (load.assignedAcuity > load.capacity) return false; // over capacity
    if (load.remainingCapacity !== load.capacity - load.assignedAcuity) return false;
    if (load.remainingCapacity < 0) return false;
  }

  // Every assignment's manager must be a known managerLoad (no assignment to a phantom manager).
  const knownManagers = new Set(managerLoads.map((l) => l.managerId as string));
  for (const managerId of assignedByManager.keys()) {
    if (!knownManagers.has(managerId)) return false;
  }

  // Every waitlist must be justified: acuity exceeds every manager's final remaining capacity.
  const maxRemaining = managerLoads.reduce(
    (mx, l) => Math.max(mx, l.remainingCapacity as number),
    0
  );
  for (const w of waitlisted) {
    if (!w || typeof w.acuity !== "number") return false;
    if (w.acuity <= maxRemaining) return false; // could have fit → unjust waitlist
  }
  return true;
}

/**
 * No-autonomous-assignment check: did the agent avoid autonomously committing an assignment? True unless
 * the determination reports it auto-committed (autoAssigned:true) or does not require care-lead review
 * (requiresCareLeadReview:false). Anything evaluateCaseloadBalancing() produces satisfies it. This is the
 * honest signal the route reports to policy.caseload.no-autonomous-assignment. A non-object input is a
 * violation.
 */
export function caseloadNoAutonomousAssignment(
  decision:
    | { autoAssigned?: boolean; requiresCareLeadReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoAssigned === true) return false;
  if (decision.requiresCareLeadReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of an allocation — the shape stamped onto the Agent Fabric trace + the
 * response `meta`.
 */
export function caseloadBalancingSummary(decision: CaseloadBalancingDetermination): {
  requestRef: string;
  panelRef: string;
  disposition: CaseloadBalancingDisposition;
  managerCount: number;
  assignedCount: number;
  waitlistedCount: number;
  totalAssignedAcuity: number;
  totalCapacity: number;
  requiresCareLeadReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: decision.requestRef,
    panelRef: decision.panelRef,
    disposition: decision.disposition,
    managerCount: decision.managerLoads.length,
    assignedCount: decision.assignedCount,
    waitlistedCount: decision.waitlistedCount,
    totalAssignedAcuity: decision.totalAssignedAcuity,
    totalCapacity: decision.totalCapacity,
    requiresCareLeadReview: decision.requiresCareLeadReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a 6-member panel across 3 managers (capacities 10 / 8 / 6, total 24;
 * total acuity 21) that FULLY ASSIGNS within capacity, spreading the load. Synthetic.
 */
export const DEMO_CASELOAD_BALANCING_REQUEST: CaseloadBalancingRequest = {
  requestRef: "cbl-001",
  panelRef: "panel-4821",
  managers: [
    { managerId: "mgr-a", capacity: 10 },
    { managerId: "mgr-b", capacity: 8 },
    { managerId: "mgr-c", capacity: 6 }
  ],
  members: [
    { memberId: "m1", acuity: 5 },
    { memberId: "m2", acuity: 4 },
    { memberId: "m3", acuity: 4 },
    { memberId: "m4", acuity: 3 },
    { memberId: "m5", acuity: 3 },
    { memberId: "m6", acuity: 2 }
  ]
};

/**
 * A representative demo request: a 4-member panel whose total acuity (16) exceeds the managers' total
 * capacity (11), so two members are WAITLISTED — partially assigned. Synthetic.
 */
export const DEMO_CASELOAD_BALANCING_WAITLIST_REQUEST: CaseloadBalancingRequest = {
  requestRef: "cbl-002",
  panelRef: "panel-7799",
  managers: [
    { managerId: "mgr-a", capacity: 6 },
    { managerId: "mgr-b", capacity: 5 }
  ],
  members: [
    { memberId: "m1", acuity: 5 },
    { memberId: "m2", acuity: 4 },
    { memberId: "m3", acuity: 4 },
    { memberId: "m4", acuity: 3 }
  ]
};

/**
 * A representative demo request: 4 equal-acuity members across 2 equal-capacity managers — the worst-fit
 * greedy spreads them 2-and-2 into perfectly BALANCED loads. Synthetic.
 */
export const DEMO_CASELOAD_BALANCING_BALANCED_REQUEST: CaseloadBalancingRequest = {
  requestRef: "cbl-003",
  panelRef: "panel-9001",
  managers: [
    { managerId: "mgr-a", capacity: 10 },
    { managerId: "mgr-b", capacity: 10 }
  ],
  members: [
    { memberId: "m1", acuity: 5 },
    { memberId: "m2", acuity: 5 },
    { memberId: "m3", acuity: 5 },
    { memberId: "m4", acuity: 5 }
  ]
};
