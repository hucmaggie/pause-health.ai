/**
 * Eligibility & Enrollment (834) Reconciliation — the deterministic, transparent payer-operations
 * layer that compares a group's SOURCE-OF-TRUTH enrollment roster (e.g. the employer / HR feed)
 * against the CARRIER's current roster and produces the reconciliation actions (enroll / terminate /
 * update / no-change) that bring the carrier into agreement, never autonomously APPLYING an enrollment
 * change; a benefits administrator confirms and posts every action.
 *
 * Deterministic, dependency-free domain core the Enrollment Reconciliation Agent
 * (app/api/agents/enrollment-reconciliation) wraps — a claims / payer-operations service on the payer
 * & plan operations plane of Pause's Agent Fabric. UNLIKE the Member Cost-Share agent's SEQUENTIAL
 * dollar waterfall, the OIG Exclusion agent's identity MATCHING, the Drug Interaction agent's pairwise
 * LOOKUP, or the MLR Rebate agent's RATIO + apportionment, the heart of this service is a KEYED
 * SET-DIFFERENCE + a FIELD-LEVEL COMPARISON. The 834 EDI transaction is how employers send enrollment
 * to carriers; the two sides drift, and reconciliation finds the delta.
 *
 *   Inbound:  an EnrollmentReconciliationRequest { requestRef, groupRef, sourceOfTruth[], carrier[],
 *             comparedFields? }
 *   Outbound: an EnrollmentReconciliationDetermination { comparedFields, totalMembers, actions[],
 *             counts, requiresBenefitsAdminReview:true, autoApplied:false, reason, synthetic:true,
 *             note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other payer-operations agents: distinct from the Claims
 * Adjudication agent (WHAT the allowed amount is), the Member Cost-Share agent (SPLITTING a claim into
 * member vs. plan), the Coordination of Benefits agent (the ORDER of coverages), the MLR Rebate agent
 * (a plan-year rebate), and the OIG Exclusion agent (screening a party against the sanctions list):
 * this reconciles WHO is enrolled — the membership roster itself — between the employer and the
 * carrier.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the reconciliation is complete — every member is accounted for once.
 * ─────────────────────────────────────────────────────────────────────
 *  A reconciliation is trustworthy only if EVERY member present in either roster is classified EXACTLY
 *  once — a dropped member is the worst failure mode: a terminated employee who keeps coverage they
 *  shouldn't, or a new hire who never gets enrolled. reconciliationComplete() verifies the actions
 *  cover the full union of member ids with no member dropped, duplicated, or miscounted; it reports
 *  the honest signal the Agent Fabric enforces via policy.enrollment.reconciliation-complete. (The
 *  load-bearing correctness gate — mirrors the Member Cost-Share Agent's math-consistent and the MLR
 *  Rebate Agent's allocation-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: every action is sourced — no fabricated discrepancy.
 * ─────────────────────────────────────────────────────────────────────
 *  Every UPDATE action must carry at least one genuinely-differing field (each listed delta's source
 *  value actually differs from its carrier value), and every NO-CHANGE action must carry none — a
 *  fabricated discrepancy (an "update" whose fields don't actually differ, or a "no-change" that
 *  hides a real difference) drives wrong enrollment writes. reconciliationActionsSourced() verifies
 *  the shape + the deltas of every action; it reports the honest signal the Agent Fabric enforces via
 *  policy.enrollment.actions-sourced. (Mirrors the OIG Exclusion Agent's match-not-overstated and the
 *  Drug Interaction Agent's interaction-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: an enrollment change is never autonomously applied.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent RECONCILES — it never APPLIES an enrollment change to the system of record (enrolling,
 *  terminating, or updating a member is a coverage decision that must be authorized); every
 *  determination is a RECOMMENDATION requiring a benefits administrator to confirm and post.
 *  reconciliationNoAutonomousChange() reports the honest signal the Agent Fabric enforces via
 *  policy.enrollment.no-autonomous-change. (Mirrors the Member Cost-Share Agent's
 *  no-autonomous-member-charge and the MLR Rebate Agent's no-autonomous-disbursement posture — the
 *  harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE RECONCILIATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A reconciliation — any set of actions, including all-no-change — is a SAFE, honest OUTPUT: the task
 *  COMPLETES (it carries requiresBenefitsAdminReview:true, autoApplied:false). A GOVERNANCE BLOCK is
 *  when a caller PRESENTS an offending DETERMINATION (an incomplete / miscounted reconciliation, a
 *  fabricated discrepancy, or an autonomously-applied / unreviewed determination) — which the Agent
 *  Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified 834 / enrollment system.
 * ─────────────────────────────────────────────────────────────────────
 *  The rosters + compared fields below are clearly-labeled ILLUSTRATIVE synthetics chosen to model the
 *  SHAPE of an 834 reconciliation deterministically in the demo. Real enrollment reconciliation uses
 *  the full X12 834 transaction set, effective-dating and retroactivity rules, dependent / COBRA /
 *  qualifying-event handling, and the carrier's eligibility system. There is NO randomness and NO clock
 *  anywhere here: the determination is a pure function of the request's own fields, so the same two
 *  rosters always yield the same actions — which is what lets the demo, the seeded trace, and the tests
 *  agree.
 */

/** A single enrollment record on a roster (keyed by memberId). */
export type EnrollmentRecord = {
  /** The member identifier — the reconciliation key. */
  memberId: string;
  /** Member name. */
  name: string;
  /** Coverage tier, e.g. "employee-only" / "employee-spouse" / "family". */
  coverageTier: string;
  /** Plan identifier. */
  planId: string;
  /** Enrollment status, e.g. "active" / "cobra" / "terminated". */
  status: string;
};

/** The non-key fields compared to detect an UPDATE, by default. */
export const DEFAULT_COMPARED_FIELDS: Array<keyof EnrollmentRecord> = [
  "name",
  "coverageTier",
  "planId",
  "status"
];

/** An enrollment reconciliation request. */
export type EnrollmentReconciliationRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic group / employer reference. */
  groupRef: string;
  /** The source-of-truth roster (e.g. the employer / HR feed). */
  sourceOfTruth: EnrollmentRecord[];
  /** The carrier's current roster. */
  carrier: EnrollmentRecord[];
  /** Which non-key fields to compare for an UPDATE (defaults to DEFAULT_COMPARED_FIELDS). */
  comparedFields?: string[];
};

/** A single field difference between the source and carrier record. */
export type FieldDelta = {
  field: string;
  sourceValue: string;
  carrierValue: string;
};

/** The kind of reconciliation action for a member. */
export type ReconciliationActionKind = "enroll" | "terminate" | "update" | "no-change";

/** A single reconciliation action. */
export type ReconciliationAction = {
  memberId: string;
  action: ReconciliationActionKind;
  /** For an UPDATE, the genuinely-differing fields; omitted / empty otherwise. */
  differingFields?: FieldDelta[];
};

/** The per-kind tallies. */
export type ReconciliationCounts = {
  enroll: number;
  terminate: number;
  update: number;
  noChange: number;
};

/** The deterministic reconciliation determination the agent returns. */
export type EnrollmentReconciliationDetermination = {
  requestRef: string;
  groupRef: string;
  /** The fields compared to detect an UPDATE. */
  comparedFields: string[];
  /** The number of DISTINCT members across both rosters (the union). */
  totalMembers: number;
  /** The reconciliation actions, sorted by memberId. */
  actions: ReconciliationAction[];
  /** The per-kind tallies (sum to actions.length). */
  counts: ReconciliationCounts;
  /** Always true — every action is confirmed + posted by a benefits administrator. */
  requiresBenefitsAdminReview: true;
  /** Always false — the agent never autonomously applies an enrollment change. */
  autoApplied: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the rosters are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Index a roster by memberId (last record wins on a duplicate id, deterministically). */
function indexByMemberId(records: EnrollmentRecord[]): Map<string, EnrollmentRecord> {
  const map = new Map<string, EnrollmentRecord>();
  for (const r of records) {
    if (r && typeof r.memberId === "string" && r.memberId) map.set(r.memberId, r);
  }
  return map;
}

/** Compute the field-level deltas between two records over the compared fields. */
export function fieldDeltas(
  source: EnrollmentRecord,
  carrier: EnrollmentRecord,
  comparedFields: string[]
): FieldDelta[] {
  const deltas: FieldDelta[] = [];
  for (const field of comparedFields) {
    const sourceValue = String((source as Record<string, unknown>)[field] ?? "");
    const carrierValue = String((carrier as Record<string, unknown>)[field] ?? "");
    if (sourceValue !== carrierValue) deltas.push({ field, sourceValue, carrierValue });
  }
  return deltas;
}

/**
 * The deterministic reconciliation function — the heart of the service. DETERMINISTIC: a pure function
 * of the request's own fields (no randomness, no clock). It keys both rosters by memberId, walks the
 * UNION of member ids, and classifies each: in source only → enroll; in carrier only → terminate; in
 * both with a differing compared field → update (with the deltas); in both and identical → no-change.
 * Nothing is applied here — every action is handed to a benefits administrator.
 */
export function evaluateEnrollmentReconciliation(
  request: EnrollmentReconciliationRequest
): EnrollmentReconciliationDetermination {
  const comparedFields =
    Array.isArray(request.comparedFields) && request.comparedFields.length > 0
      ? request.comparedFields.slice()
      : DEFAULT_COMPARED_FIELDS.slice();

  const source = indexByMemberId(Array.isArray(request.sourceOfTruth) ? request.sourceOfTruth : []);
  const carrier = indexByMemberId(Array.isArray(request.carrier) ? request.carrier : []);

  const memberIds = Array.from(new Set([...source.keys(), ...carrier.keys()])).sort();

  const actions: ReconciliationAction[] = [];
  const counts: ReconciliationCounts = { enroll: 0, terminate: 0, update: 0, noChange: 0 };

  for (const memberId of memberIds) {
    const inSource = source.get(memberId);
    const inCarrier = carrier.get(memberId);
    if (inSource && !inCarrier) {
      actions.push({ memberId, action: "enroll" });
      counts.enroll += 1;
    } else if (!inSource && inCarrier) {
      actions.push({ memberId, action: "terminate" });
      counts.terminate += 1;
    } else if (inSource && inCarrier) {
      const deltas = fieldDeltas(inSource, inCarrier, comparedFields);
      if (deltas.length > 0) {
        actions.push({ memberId, action: "update", differingFields: deltas });
        counts.update += 1;
      } else {
        actions.push({ memberId, action: "no-change" });
        counts.noChange += 1;
      }
    }
  }

  const totalMembers = memberIds.length;
  const reason = `Reconciliation ${request.requestRef} for ${request.groupRef}: ${totalMembers} member(s) across both rosters — ${counts.enroll} enroll, ${counts.terminate} terminate, ${counts.update} update, ${counts.noChange} no-change.`;

  return {
    requestRef: request.requestRef,
    groupRef: request.groupRef,
    comparedFields,
    totalMembers,
    actions,
    counts,
    requiresBenefitsAdminReview: true,
    autoApplied: false,
    reason,
    synthetic: true,
    note:
      `Reconciliation ${request.requestRef}: ${counts.enroll} enroll / ${counts.terminate} terminate / ${counts.update} update / ${counts.noChange} no-change across ${totalMembers} member(s). ` +
      "PHI-bearing — the rosters reference members and their coverage. Synthetic/illustrative rosters — NOT a certified 834 / enrollment system; real reconciliation uses the full X12 834 transaction set, effective-dating / retroactivity rules, dependent / COBRA / qualifying-event handling, and the carrier's eligibility system. The agent never applies an enrollment change on its own — a benefits administrator confirms and posts every action."
  };
}

/**
 * Reconciliation-complete check: is every member accounted for exactly once? True only when the
 * per-kind counts sum to actions.length, totalMembers equals actions.length, the counts match the
 * actual per-kind tallies, and no memberId appears twice. Catches a dropped, duplicated, or miscounted
 * member — the worst failure mode of a reconciliation. The load-bearing correctness gate. Anything
 * evaluateEnrollmentReconciliation() produces satisfies it. This is the honest signal the route
 * reports to policy.enrollment.reconciliation-complete. A non-object / malformed input is a violation.
 */
export function reconciliationComplete(
  decision:
    | {
        totalMembers?: number;
        actions?: Array<{ memberId?: string; action?: string }>;
        counts?: { enroll?: number; terminate?: number; update?: number; noChange?: number };
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const actions = Array.isArray(decision.actions) ? decision.actions : null;
  if (!actions) return false;
  const counts = decision.counts;
  if (!counts || typeof counts !== "object") return false;
  if (typeof decision.totalMembers !== "number") return false;

  // No duplicate member ids.
  const ids = new Set<string>();
  const tally = { enroll: 0, terminate: 0, update: 0, "no-change": 0 } as Record<string, number>;
  for (const a of actions) {
    if (!a || typeof a !== "object" || typeof a.memberId !== "string") return false;
    if (ids.has(a.memberId)) return false;
    ids.add(a.memberId);
    if (typeof a.action !== "string" || !(a.action in tally)) return false;
    tally[a.action] += 1;
  }

  if (decision.totalMembers !== actions.length) return false;
  if ((counts.enroll ?? -1) !== tally.enroll) return false;
  if ((counts.terminate ?? -1) !== tally.terminate) return false;
  if ((counts.update ?? -1) !== tally.update) return false;
  if ((counts.noChange ?? -1) !== tally["no-change"]) return false;

  const sum =
    (counts.enroll ?? 0) + (counts.terminate ?? 0) + (counts.update ?? 0) + (counts.noChange ?? 0);
  if (sum !== actions.length) return false;
  return true;
}

/**
 * Actions-sourced check: is every action well-formed and free of fabricated discrepancies? True only
 * when every UPDATE carries at least one delta and each delta's source value genuinely differs from
 * its carrier value, and every NO-CHANGE / ENROLL / TERMINATE carries no deltas. Catches a fabricated
 * discrepancy (an "update" whose fields don't differ) or a mis-shaped action. Anything
 * evaluateEnrollmentReconciliation() produces satisfies it. This is the honest signal the route
 * reports to policy.enrollment.actions-sourced. A non-object / malformed input is a violation.
 */
export function reconciliationActionsSourced(
  decision:
    | {
        actions?: Array<{
          action?: string;
          differingFields?: Array<{ field?: string; sourceValue?: string; carrierValue?: string }>;
        }>;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const actions = Array.isArray(decision.actions) ? decision.actions : null;
  if (!actions) return false;

  for (const a of actions) {
    if (!a || typeof a !== "object") return false;
    const deltas = Array.isArray(a.differingFields) ? a.differingFields : [];
    if (a.action === "update") {
      if (deltas.length === 0) return false; // an update must have a real diff
      for (const d of deltas) {
        if (!d || typeof d !== "object") return false;
        if (typeof d.field !== "string" || !d.field) return false;
        // A fabricated discrepancy: values that don't actually differ.
        if (String(d.sourceValue ?? "") === String(d.carrierValue ?? "")) return false;
      }
    } else if (a.action === "no-change" || a.action === "enroll" || a.action === "terminate") {
      if (deltas.length > 0) return false; // these carry no diffs
    } else {
      return false; // unknown action kind
    }
  }
  return true;
}

/**
 * No-autonomous-change check: did the agent avoid autonomously applying an enrollment change? True
 * unless the determination reports it autonomously applied the actions (autoApplied:true) or does not
 * require benefits-admin review (requiresBenefitsAdminReview:false). Anything
 * evaluateEnrollmentReconciliation() produces satisfies it. This is the honest signal the route
 * reports to policy.enrollment.no-autonomous-change. A non-object input is a violation.
 */
export function reconciliationNoAutonomousChange(
  decision:
    | { autoApplied?: boolean; requiresBenefitsAdminReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoApplied === true) return false;
  if (decision.requiresBenefitsAdminReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric trace +
 * the response `meta`.
 */
export function enrollmentReconciliationSummary(
  decision: EnrollmentReconciliationDetermination
): {
  requestRef: string;
  groupRef: string;
  totalMembers: number;
  enroll: number;
  terminate: number;
  update: number;
  noChange: number;
  requiresBenefitsAdminReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: decision.requestRef,
    groupRef: decision.groupRef,
    totalMembers: decision.totalMembers,
    enroll: decision.counts.enroll,
    terminate: decision.counts.terminate,
    update: decision.counts.update,
    noChange: decision.counts.noChange,
    requiresBenefitsAdminReview: decision.requiresBenefitsAdminReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a group whose employer feed and carrier roster have drifted — one
 * member unchanged, one member's coverage tier changed (update), one new hire (enroll), and one
 * terminated employee still on the carrier (terminate). Synthetic.
 */
export const DEMO_ENROLLMENT_RECONCILIATION_REQUEST: EnrollmentReconciliationRequest = {
  requestRef: "recon-001",
  groupRef: "group-4821",
  sourceOfTruth: [
    { memberId: "M1", name: "Dana Lee", coverageTier: "family", planId: "PPO-100", status: "active" },
    { memberId: "M2", name: "Sam Ortiz", coverageTier: "employee-only", planId: "PPO-100", status: "active" },
    { memberId: "M3", name: "Priya Rao", coverageTier: "employee-spouse", planId: "HDHP-200", status: "active" }
  ],
  carrier: [
    { memberId: "M1", name: "Dana Lee", coverageTier: "family", planId: "PPO-100", status: "active" },
    { memberId: "M2", name: "Sam Ortiz", coverageTier: "family", planId: "PPO-100", status: "active" },
    { memberId: "M4", name: "Alex Kim", coverageTier: "employee-only", planId: "PPO-100", status: "active" }
  ]
};

/**
 * A representative demo request: the two rosters agree exactly → all no-change. Synthetic.
 */
export const DEMO_ENROLLMENT_RECONCILIATION_CLEAN_REQUEST: EnrollmentReconciliationRequest = {
  requestRef: "recon-002",
  groupRef: "group-7799",
  sourceOfTruth: [
    { memberId: "N1", name: "Jordan Fox", coverageTier: "employee-only", planId: "PPO-100", status: "active" },
    { memberId: "N2", name: "Chris Diaz", coverageTier: "family", planId: "PPO-100", status: "active" }
  ],
  carrier: [
    { memberId: "N1", name: "Jordan Fox", coverageTier: "employee-only", planId: "PPO-100", status: "active" },
    { memberId: "N2", name: "Chris Diaz", coverageTier: "family", planId: "PPO-100", status: "active" }
  ]
};

/**
 * A representative demo request: a brand-new group the carrier has no roster for yet → every member is
 * an enroll. Synthetic.
 */
export const DEMO_ENROLLMENT_RECONCILIATION_NEW_GROUP_REQUEST: EnrollmentReconciliationRequest = {
  requestRef: "recon-003",
  groupRef: "group-9001",
  sourceOfTruth: [
    { memberId: "P1", name: "Robin Vale", coverageTier: "employee-only", planId: "HMO-050", status: "active" },
    { memberId: "P2", name: "Toni West", coverageTier: "employee-spouse", planId: "HMO-050", status: "active" }
  ],
  carrier: []
};
