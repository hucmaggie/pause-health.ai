/**
 * Primary Care Provider (PCP) Assignment / Member–Provider Matching — the deterministic, transparent
 * care-coordination layer that takes a panel of unassigned MEMBERS (each with a ranked list of preferred
 * primary care providers) plus a set of PROVIDERS (each with a panel CAPACITY and a ranked list of the
 * members it would accept) and produces a STABLE assignment of members to providers: a matching in which no
 * member and provider who both prefer each other over their current assignment are left apart (no BLOCKING
 * pair) and no provider is over capacity; never autonomously COMMITTING an assignment, REASSIGNING a
 * patient, or overriding a provider's panel.
 *
 * Deterministic, dependency-free domain core the PCP Matching agent (app/api/agents/pcp-matching) wraps — a
 * care-coordination service on the patient-care plane of Pause's Agent Fabric. UNLIKE the Network Adequacy
 * agent's GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM
 * (the NPI Luhn check digit), the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the
 * Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the Master-Patient-Index agent's WEIGHTED
 * identity MATCHING, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Claim Lifecycle agent's FSM
 * TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict
 * agent's GREEDY INTERVAL SELECTION, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage
 * Continuity agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment
 * Reconciliation agent's KEYED SET-DIFFERENCE, or the Audit Log Integrity agent's HASH CHAIN — and, CRUCIALLY,
 * UNLIKE the Caseload Balancing agent's GREEDY BIN-PACKING (worst-fit allocation of a panel across managers'
 * capacity by acuity, with NO preferences and NO stability guarantee) — the heart of this service is
 * TWO-SIDED STABLE MATCHING: the Gale–Shapley DEFERRED-ACCEPTANCE algorithm (the member-proposing,
 * many-to-one "hospitals/residents" variant) that, from both sides' preference lists + provider capacities,
 * produces the member-optimal STABLE matching — the unique assignment with no blocking pair. An assignment
 * that leaves a member and a provider who each prefer the other over their current lot (a blocking pair) is
 * UNSTABLE — it will unravel as the pair defects — so this service computes a provably stable matching
 * deterministically and hands it to a human.
 *
 *   Inbound:  a PcpMatchingRequest { panelRef, members[], providers[] }
 *   Outbound: a PcpMatchingDetermination { disposition, assignments[], providerLoads[], matchedCount,
 *             unmatchedCount, total, members[], providers[], requiresCoordinatorReview:true,
 *             autoAssigned:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other care-coordination agents: distinct from the Caseload
 * Balancing agent (which BIN-PACKS a panel across managers' capacity to balance load, no preferences), the
 * Care Team & Case Management agent (assembling the team around ONE patient), and the Population Health agent
 * (prioritizing a panel): this produces a STABLE two-sided matching of members to primary care providers.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every assignment is sourced and the panel is complete.
 * ─────────────────────────────────────────────────────────────────────
 *  A matching is trustworthy only if it assigns exactly the submitted members to submitted providers: one
 *  assignment per submitted member (all present, none dropped or invented), every assigned provider a
 *  submitted one, the provider loads echoing the submitted capacities and matching the actual assignment
 *  counts, and the matched / unmatched tallies adding up. A phantom assignment (a member not in the panel, or
 *  a provider not in the network) corrupts the panel. matchingSourced() verifies it; the Agent Fabric
 *  enforces it via policy.pcp.matching-sourced. (The sourced + completeness gate — mirrors the Network
 *  Adequacy Agent's providers-sourced and the Caseload Balancing Agent's assignment-complete.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the matching is stable (recomputes, no blocking pair).
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing the Gale–Shapley deferred acceptance from the echoed preferences + capacities must reproduce
 *  the reported assignment and each member's reported preference rank, no provider may be over capacity, and
 *  there must be NO blocking pair (a member and provider who both prefer each other over their current
 *  assignment). An unstable matching will unravel — a member and a provider defect to each other — leaving a
 *  patient without a real PCP. The whole point is the stability. matchingStable() recomputes it end-to-end;
 *  the Agent Fabric enforces it via policy.pcp.matching-stable. (The load-bearing correctness gate — mirrors
 *  the Network Adequacy Agent's distances-consistent and the Household Composition Agent's
 *  partition-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no assignment is ever autonomously committed.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent PROPOSES a matching — it never COMMITS an assignment, REASSIGNS a patient, or overrides a
 *  provider's panel (each is a care-ownership decision that must be authorized); every matching is a
 *  RECOMMENDATION requiring a care-coordination lead to confirm. noAutonomousAssignment() reports the honest
 *  signal the Agent Fabric enforces via policy.pcp.no-autonomous-assignment. (Mirrors the Caseload Balancing
 *  Agent's no-autonomous-assignment and the Care Team Agent's no-autonomous-assignment posture — the harmful
 *  action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A matching — all-matched or partial-match — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresCoordinatorReview:true, autoAssigned:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (a phantom assignment, an unstable / mis-recomputed matching, or an autonomous
 *  commit) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified panel-management system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real PCP assignment weighs geography, language, continuity of care, plan network rules, and member choice,
 *  and runs against a live panel-management / attribution system. This computes the member-optimal stable
 *  matching from the supplied preference lists + capacities only. It IS PHI-bearing — the members are
 *  patients — so it is on the HIPAA-audit policy. TIME IS DATA: the matching is a pure function of the
 *  preferences + capacities (no clock, no randomness), so the same panel always yields the same matching,
 *  which is what lets the demo, the seeded trace, and the tests agree. The members, providers, preferences,
 *  and capacities are clearly-labeled ILLUSTRATIVE synthetics.
 */

/** A member with a ranked list of preferred providers (most-preferred first). */
export type MemberPreference = {
  memberId: string;
  label?: string;
  /** Provider ids in preference order (most preferred first). */
  ranking: string[];
};

/** A provider with a panel capacity and a ranked list of acceptable members. */
export type ProviderPreference = {
  providerId: string;
  label?: string;
  /** Panel capacity — the maximum members this provider will accept. */
  capacity: number;
  /** Member ids in preference order (most preferred first); a member not listed is unacceptable. */
  ranking: string[];
};

/** A PCP-matching request. */
export type PcpMatchingRequest = {
  /** Synthetic panel reference. */
  panelRef: string;
  members: MemberPreference[];
  providers: ProviderPreference[];
};

/** A member's assignment. */
export type MemberAssignment = {
  memberId: string;
  label?: string;
  /** The assigned provider id, or null when the member is unmatched. */
  providerId: string | null;
  /** 1-based position of the assigned provider in the member's ranking, or null when unmatched. */
  memberRank: number | null;
};

/** A provider's realized load. */
export type ProviderLoad = {
  providerId: string;
  capacity: number;
  assignedCount: number;
};

/** The disposition of a matching. */
export type PcpMatchingDisposition = "all-matched" | "partial-match";

/** The deterministic finding the agent returns. */
export type PcpMatchingDetermination = {
  panelRef: string;
  /** The submitted members, echoed so the guards can recompute. */
  members: MemberPreference[];
  /** The submitted providers, echoed so the guards can recompute. */
  providers: ProviderPreference[];
  /** One assignment per submitted member, sorted by memberId. */
  assignments: MemberAssignment[];
  /** Realized load per submitted provider, sorted by providerId. */
  providerLoads: ProviderLoad[];
  matchedCount: number;
  unmatchedCount: number;
  total: number;
  disposition: PcpMatchingDisposition;
  /** Always true — a care-coordination lead confirms every matching. */
  requiresCoordinatorReview: true;
  /** Always false — the agent never autonomously commits an assignment. */
  autoAssigned: false;
  reason: string;
  synthetic: true;
  note: string;
};

/** The provider's preference rank of a member (lower = more preferred; Infinity = unacceptable). */
function providerRankOf(provider: ProviderPreference, memberId: string): number {
  const i = provider.ranking.indexOf(memberId);
  return i < 0 ? Infinity : i;
}

/**
 * The member-proposing, many-to-one Gale–Shapley DEFERRED-ACCEPTANCE algorithm — the heart of the service.
 * DETERMINISTIC: free members propose in id order; each provider tentatively holds up to its capacity of its
 * most-preferred acceptable proposers and rejects the rest; rejected members propose down their list. It
 * terminates at the member-optimal STABLE matching. Returns a map memberId → providerId | null. Pure.
 */
export function deferredAcceptance(
  members: MemberPreference[],
  providers: ProviderPreference[]
): Map<string, string | null> {
  const memberById = new Map(members.map((m) => [m.memberId, m]));
  const providerById = new Map(providers.map((p) => [p.providerId, p]));
  const assign = new Map<string, string | null>();
  const nextIdx = new Map<string, number>();
  const held = new Map<string, string[]>();
  for (const m of members) {
    assign.set(m.memberId, null);
    nextIdx.set(m.memberId, 0);
  }

  const free = members.map((m) => m.memberId).sort();
  while (free.length > 0) {
    const m = free.shift() as string;
    const mem = memberById.get(m);
    if (!mem) continue;
    while ((nextIdx.get(m) as number) < mem.ranking.length) {
      const pid = mem.ranking[nextIdx.get(m) as number];
      nextIdx.set(m, (nextIdx.get(m) as number) + 1);
      const p = providerById.get(pid);
      if (!p) continue;
      const pr = providerRankOf(p, m);
      if (pr === Infinity) continue; // provider will not accept this member
      const holds = held.get(pid) ?? [];
      if (holds.length < p.capacity) {
        holds.push(m);
        held.set(pid, holds);
        assign.set(m, pid);
        break;
      }
      // Provider is full — find its worst-ranked current hold.
      let worst = holds[0];
      let worstRank = providerRankOf(p, worst);
      for (const h of holds) {
        const r = providerRankOf(p, h);
        if (r > worstRank) {
          worstRank = r;
          worst = h;
        }
      }
      if (pr < worstRank) {
        const nextHolds = holds.filter((x) => x !== worst);
        nextHolds.push(m);
        held.set(pid, nextHolds);
        assign.set(m, pid);
        assign.set(worst, null);
        free.push(worst);
        free.sort();
        break;
      }
      // else provider rejects m; m keeps proposing down its list
    }
  }
  return assign;
}

/** 1-based rank of a provider in a member's ranking, or null when absent. */
function memberRankOf(member: MemberPreference, providerId: string | null): number | null {
  if (providerId === null) return null;
  const i = member.ranking.indexOf(providerId);
  return i < 0 ? null : i + 1;
}

/** Does the assignment contain a blocking pair or a capacity violation (i.e., is it UNSTABLE)? */
export function hasBlockingPair(
  members: MemberPreference[],
  providers: ProviderPreference[],
  assign: Map<string, string | null>
): boolean {
  const memberById = new Map(members.map((m) => [m.memberId, m]));
  const providerById = new Map(providers.map((p) => [p.providerId, p]));

  // Capacity violation.
  const loads = new Map<string, string[]>();
  for (const m of members) {
    const pid = assign.get(m.memberId) ?? null;
    if (pid !== null) loads.set(pid, [...(loads.get(pid) ?? []), m.memberId]);
  }
  for (const p of providers) {
    if ((loads.get(p.providerId) ?? []).length > p.capacity) return true;
  }

  // Blocking pair: a member m and provider p who each prefer the other over their current lot.
  for (const m of members) {
    const currentPid = assign.get(m.memberId) ?? null;
    const currentRank = currentPid === null ? Infinity : m.ranking.indexOf(currentPid);
    for (let i = 0; i < m.ranking.length; i++) {
      const pid = m.ranking[i];
      if (currentRank !== Infinity && i >= currentRank) break; // only providers m prefers over current
      const p = providerById.get(pid);
      if (!p) continue;
      const prM = providerRankOf(p, m.memberId);
      if (prM === Infinity) continue; // provider would not accept m
      const holdsIds = loads.get(p.providerId) ?? [];
      if (holdsIds.length < p.capacity) return true; // spare capacity — p would take m
      // p is full; would p rather have m than its worst current hold?
      let worstRank = -1;
      for (const h of holdsIds) {
        const r = providerRankOf(p, h);
        if (r > worstRank) worstRank = r;
      }
      if (prM < worstRank) return true;
    }
  }
  // Touch memberById so the (documented) member lookup is retained for clarity.
  void memberById;
  return false;
}

/** Derive the disposition from whether every member is matched. */
function matchingDisposition(unmatchedCount: number): PcpMatchingDisposition {
  return unmatchedCount === 0 ? "all-matched" : "partial-match";
}

/**
 * The deterministic matching function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own preferences + capacities (no randomness, no clock). It runs the member-proposing Gale–Shapley
 * deferred acceptance, records one assignment per member (with the member's preference rank), tallies the
 * provider loads, and derives all-matched / partial-match. Nothing is committed — the matching is handed to a
 * care-coordination lead.
 */
export function evaluatePcpMatching(request: PcpMatchingRequest): PcpMatchingDetermination {
  const members = Array.isArray(request.members) ? request.members : [];
  const providers = Array.isArray(request.providers) ? request.providers : [];

  const assign = deferredAcceptance(members, providers);

  const assignments: MemberAssignment[] = [...members]
    .sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0))
    .map((m) => {
      const pid = assign.get(m.memberId) ?? null;
      return {
        memberId: m.memberId,
        ...(m.label !== undefined ? { label: m.label } : {}),
        providerId: pid,
        memberRank: memberRankOf(m, pid)
      };
    });

  const providerLoads: ProviderLoad[] = [...providers]
    .sort((a, b) => (a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0))
    .map((p) => ({
      providerId: p.providerId,
      capacity: p.capacity,
      assignedCount: assignments.filter((a) => a.providerId === p.providerId).length
    }));

  const matchedCount = assignments.filter((a) => a.providerId !== null).length;
  const unmatchedCount = assignments.length - matchedCount;
  const disposition = matchingDisposition(unmatchedCount);

  const reason =
    disposition === "all-matched"
      ? `All ${assignments.length} member(s) matched to a preferred provider — a stable matching (no blocking pair).`
      : `${matchedCount} of ${assignments.length} member(s) matched; ${unmatchedCount} unmatched (capacity exhausted or short preference list) — a stable matching (no blocking pair).`;

  return {
    panelRef: request.panelRef,
    members,
    providers,
    assignments,
    providerLoads,
    matchedCount,
    unmatchedCount,
    total: assignments.length,
    disposition,
    requiresCoordinatorReview: true,
    autoAssigned: false,
    reason,
    synthetic: true,
    note:
      `PCP matching ${request.panelRef}: ${disposition.toUpperCase()} — ${matchedCount}/${assignments.length} member(s) matched across ${providers.length} provider(s) via member-proposing Gale–Shapley deferred acceptance (the member-optimal STABLE matching — no blocking pair).` +
      " Real PCP assignment also weighs geography, language, continuity of care, plan-network rules, and member choice, and runs against a live panel-management / attribution system. PHI-bearing — the members are patients. Synthetic/illustrative panel — NOT a certified panel-management system. The agent never commits an assignment, reassigns a patient, or overrides a provider's panel on its own — a care-coordination lead confirms every matching."
  };
}

/**
 * Sourced + completeness check: does the matching assign exactly the submitted members to submitted
 * providers? True only when there is one assignment per submitted member (all present, no duplicate, none
 * invented), every assigned provider is a submitted provider, the provider loads echo the submitted providers
 * (same id + capacity) with an assignedCount equal to the actual number of assignments to that provider, and
 * matchedCount / unmatchedCount / total agree with the assignments. Catches a phantom assignment (a member
 * not in the panel or a provider not in the network) or a miscount. Does NOT recompute the matching (that is
 * the stability check's job), so it is independent of it. Anything evaluatePcpMatching() produces satisfies
 * it. This is the honest signal the route reports to policy.pcp.matching-sourced. A non-object / malformed
 * input is a violation.
 */
export function matchingSourced(
  decision:
    | {
        members?: unknown;
        providers?: unknown;
        assignments?: unknown;
        providerLoads?: unknown;
        matchedCount?: unknown;
        unmatchedCount?: unknown;
        total?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const members = Array.isArray(decision.members) ? (decision.members as MemberPreference[]) : null;
  const providers = Array.isArray(decision.providers)
    ? (decision.providers as ProviderPreference[])
    : null;
  const assignments = Array.isArray(decision.assignments)
    ? (decision.assignments as MemberAssignment[])
    : null;
  const providerLoads = Array.isArray(decision.providerLoads)
    ? (decision.providerLoads as ProviderLoad[])
    : null;
  if (!members || !providers || !assignments || !providerLoads) return false;

  const submittedMemberIds = new Set(members.map((m) => m.memberId));
  const providerById = new Map(providers.map((p) => [p.providerId, p]));

  if (assignments.length !== members.length) return false;
  if (decision.total !== members.length) return false;

  const seen = new Set<string>();
  for (const a of assignments) {
    if (!a || typeof a.memberId !== "string") return false;
    if (seen.has(a.memberId)) return false;
    seen.add(a.memberId);
    if (!submittedMemberIds.has(a.memberId)) return false; // phantom member
    if (a.providerId !== null && !providerById.has(a.providerId)) return false; // phantom provider
  }
  // Every submitted member must be assigned exactly once.
  if (seen.size !== submittedMemberIds.size) return false;

  // Provider loads must echo the submitted providers and count the actual assignments.
  if (providerLoads.length !== providers.length) return false;
  const loadById = new Map(providerLoads.map((l) => [l.providerId, l]));
  for (const p of providers) {
    const load = loadById.get(p.providerId);
    if (!load) return false;
    if (load.capacity !== p.capacity) return false;
    const actual = assignments.filter((a) => a.providerId === p.providerId).length;
    if (load.assignedCount !== actual) return false;
  }

  const matched = assignments.filter((a) => a.providerId !== null).length;
  if (decision.matchedCount !== matched) return false;
  if (decision.unmatchedCount !== assignments.length - matched) return false;
  return true;
}

/**
 * Stability check: recomputing the Gale–Shapley deferred acceptance from the echoed preferences + capacities
 * must reproduce the reported assignment and each member's reported rank; no provider may be over capacity;
 * there must be no blocking pair; and each assigned provider must be on the member's ranking at the reported
 * rank. True only when they all hold. Catches an unstable / mis-recomputed matching. The load-bearing
 * correctness gate — it recomputes the matching from the preferences and does NOT check the
 * submitted-list↔assignment correspondence (that is the sourced check's job), so it is independent of it.
 * Anything evaluatePcpMatching() produces satisfies it. A non-object input is a violation.
 */
export function matchingStable(
  decision:
    | {
        members?: unknown;
        providers?: unknown;
        assignments?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const members = Array.isArray(decision.members) ? (decision.members as MemberPreference[]) : null;
  const providers = Array.isArray(decision.providers)
    ? (decision.providers as ProviderPreference[])
    : null;
  const assignments = Array.isArray(decision.assignments)
    ? (decision.assignments as MemberAssignment[])
    : null;
  if (!members || !providers || !assignments) return false;

  // Index the reported assignments by member; a member not in the submitted panel (a phantom) is the
  // sourced gate's concern, not stability's, so we evaluate only the submitted members here.
  const assignByMember = new Map<string, MemberAssignment>();
  for (const a of assignments) {
    if (!a || typeof a.memberId !== "string") return false;
    assignByMember.set(a.memberId, a);
  }

  const reported = new Map<string, string | null>();
  for (const m of members) {
    const a = assignByMember.get(m.memberId);
    const reportedPid = a ? (a.providerId ?? null) : null;
    reported.set(m.memberId, reportedPid);
    // Reported rank must match the member's own ranking.
    const expectedRank = memberRankOf(m, reportedPid);
    const reportedRank = a ? (a.memberRank ?? null) : null;
    if (reportedRank !== expectedRank) return false;
    if (reportedPid !== null && expectedRank === null) return false; // assigned provider not on ranking
  }

  // Recompute the member-optimal stable matching and compare (submitted members only).
  const recomputed = deferredAcceptance(members, providers);
  for (const m of members) {
    if ((reported.get(m.memberId) ?? null) !== (recomputed.get(m.memberId) ?? null)) return false;
  }

  // Independently verify stability of the reported assignment.
  if (hasBlockingPair(members, providers, reported)) return false;

  const unmatched = members.filter((m) => (reported.get(m.memberId) ?? null) === null).length;
  const expectedDisposition = matchingDisposition(unmatched);
  if (decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * No-autonomous-assignment check: did the agent avoid autonomously committing / reassigning? True unless the
 * determination reports it auto-assigned (autoAssigned:true) or does not require coordinator review
 * (requiresCoordinatorReview:false). Anything evaluatePcpMatching() produces satisfies it. This is the honest
 * signal the route reports to policy.pcp.no-autonomous-assignment. A non-object input is a violation.
 */
export function noAutonomousAssignment(
  decision:
    | { autoAssigned?: boolean; requiresCoordinatorReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoAssigned === true) return false;
  if (decision.requiresCoordinatorReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a matching. */
export function pcpMatchingSummary(decision: PcpMatchingDetermination): {
  panelRef: string;
  disposition: PcpMatchingDisposition;
  matchedCount: number;
  unmatchedCount: number;
  total: number;
  requiresCoordinatorReview: boolean;
  synthetic: boolean;
} {
  return {
    panelRef: decision.panelRef,
    disposition: decision.disposition,
    matchedCount: decision.matchedCount,
    unmatchedCount: decision.unmatchedCount,
    total: decision.total,
    requiresCoordinatorReview: decision.requiresCoordinatorReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: three members and three single-capacity providers with interlocking
 * preferences → a stable all-matched result (m1→p2, m2→p1, m3→p3). Synthetic.
 */
export const DEMO_PCP_MATCHING_REQUEST: PcpMatchingRequest = {
  panelRef: "pcp-panel-001",
  members: [
    { memberId: "m1", label: "Member 1", ranking: ["p1", "p2", "p3"] },
    { memberId: "m2", label: "Member 2", ranking: ["p1", "p3", "p2"] },
    { memberId: "m3", label: "Member 3", ranking: ["p2", "p1", "p3"] }
  ],
  providers: [
    { providerId: "p1", label: "Dr. Alpha", capacity: 1, ranking: ["m2", "m1", "m3"] },
    { providerId: "p2", label: "Dr. Beta", capacity: 1, ranking: ["m1", "m3", "m2"] },
    { providerId: "p3", label: "Dr. Gamma", capacity: 1, ranking: ["m1", "m2", "m3"] }
  ]
};

/**
 * A representative demo request: three members all preferring two single-capacity providers → one member is
 * left unmatched (m1→p1, m2→p2, m3→unassigned) — a stable partial-match. Synthetic.
 */
export const DEMO_PCP_MATCHING_PARTIAL_REQUEST: PcpMatchingRequest = {
  panelRef: "pcp-panel-002",
  members: [
    { memberId: "m1", label: "Member 1", ranking: ["p1", "p2"] },
    { memberId: "m2", label: "Member 2", ranking: ["p1", "p2"] },
    { memberId: "m3", label: "Member 3", ranking: ["p1", "p2"] }
  ],
  providers: [
    { providerId: "p1", label: "Dr. Alpha", capacity: 1, ranking: ["m1", "m2", "m3"] },
    { providerId: "p2", label: "Dr. Beta", capacity: 1, ranking: ["m1", "m2", "m3"] }
  ]
};

/**
 * A representative demo request: a capacity-2 provider absorbs two members → all matched (m1→p1, m2→p1,
 * m3→p2). Synthetic.
 */
export const DEMO_PCP_MATCHING_CAPACITY_REQUEST: PcpMatchingRequest = {
  panelRef: "pcp-panel-003",
  members: [
    { memberId: "m1", label: "Member 1", ranking: ["p1", "p2"] },
    { memberId: "m2", label: "Member 2", ranking: ["p1", "p2"] },
    { memberId: "m3", label: "Member 3", ranking: ["p1", "p2"] }
  ],
  providers: [
    { providerId: "p1", label: "Dr. Alpha", capacity: 2, ranking: ["m1", "m2", "m3"] },
    { providerId: "p2", label: "Dr. Beta", capacity: 1, ranking: ["m3", "m2", "m1"] }
  ]
};
