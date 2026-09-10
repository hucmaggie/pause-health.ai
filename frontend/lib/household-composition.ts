/**
 * Household / Family-Unit Composition — the deterministic, transparent payer-operations layer that takes a
 * batch of plan members plus a set of PAIRWISE relationship LINKS (shared subscriber, shared address, a
 * tax-dependent tie) and groups the members into HOUSEHOLDS by computing the CONNECTED COMPONENTS of the
 * relationship graph — so a member linked to a member linked to a third all land in ONE household even
 * when the first and third are not directly linked (transitivity) — proposing the grouping for a data
 * steward to confirm; never autonomously MERGING member records, changing enrollment, or applying a family
 * accumulator.
 *
 * Deterministic, dependency-free domain core the Household Composition agent
 * (app/api/agents/household-composition) wraps — a claims / payer-operations service on the payer & plan
 * operations plane of Pause's Agent Fabric. UNLIKE the Provider Benchmarking agent's PERCENTILE / RANK
 * STATISTICS, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's
 * STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing
 * agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity
 * agent's INTERVAL MERGING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation
 * agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar waterfall, the DDI agent's
 * PAIRWISE KNOWLEDGE-BASE LOOKUP, or the Audit Log Integrity agent's HASH CHAIN — and CRUCIALLY distinct
 * from the Master-Patient-Index agent's identity MATCHING (which links records of the SAME person across
 * systems) — the heart of this service is UNION-FIND / DISJOINT-SET CONNECTED COMPONENTS: it clusters
 * DIFFERENT people who share a household by taking the transitive closure of the relationship links. A
 * household drives a family deductible / out-of-pocket maximum, household-level outreach, and consent
 * scoping; a wrong grouping mis-applies a family accumulator or leaks one member's data to another, so
 * this service surfaces the grouping deterministically and hands it to a human.
 *
 *   Inbound:  a HouseholdCompositionRequest { batchRef, members[], links[] }
 *   Outbound: a HouseholdCompositionDetermination { disposition, households[], householdCount,
 *             largestHouseholdSize, memberCount, members[], links[], requiresStewardReview:true,
 *             autoMerged:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other member / enrollment agents: distinct from the
 * Master-Patient-Index agent (which matches records of the SAME person), the Enrollment Reconciliation
 * agent (which reconciles WHO is enrolled between employer and carrier via a keyed set-difference), and
 * the Coordination of Benefits agent (the ORDER of a member's coverages): this GROUPS distinct members
 * into family units by the transitive closure of their relationship links.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the links + partition are sourced and complete.
 * ─────────────────────────────────────────────────────────────────────
 *  A grouping is trustworthy only if it is built from the submitted batch: every relationship link must
 *  connect two SUBMITTED members (no phantom relationship to a member not in the batch), and the resulting
 *  households must PARTITION exactly the submitted members — every member in exactly one household, all
 *  members covered, none invented. A phantom link or a dropped / invented member silently mis-groups a
 *  family. householdLinksSourced() verifies it; the Agent Fabric enforces it via
 *  policy.household.links-sourced. (The sourced + completeness gate — mirrors the Enrollment Reconciliation
 *  Agent's reconciliation-complete and the Caseload Balancing Agent's assignment-complete.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the partition is the correct connected components.
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing the union-find from the echoed members + links must reproduce the reported households (same
 *  ids, same members, same sizes), the household count, the largest-household size, the member count, and
 *  the disposition. A wrong grouping — two unlinked members merged, or two linked members split apart —
 *  mis-applies a family accumulator or leaks data. householdPartitionConsistent() recomputes it end-to-end
 *  from the echoed links; the Agent Fabric enforces it via policy.household.partition-consistent. (The
 *  load-bearing correctness gate — mirrors the Provider Benchmarking Agent's stats-consistent and the
 *  Claim Lifecycle Agent's transition-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: member records are never autonomously merged.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent PROPOSES a household grouping — it never MERGES member records, changes enrollment, or
 *  applies a family accumulator (each is a consequential action that must be authorized); every grouping is
 *  a RECOMMENDATION requiring a data steward to confirm. householdNoAutonomousMerge() reports the honest
 *  signal the Agent Fabric enforces via policy.household.no-autonomous-merge. (Mirrors the Enrollment
 *  Reconciliation Agent's no-autonomous-change and the Master-Patient-Index Agent's no-autonomous-merge
 *  posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A finding — all-singletons or households-formed — is a SAFE, honest OUTPUT: the task COMPLETES (it
 *  carries requiresStewardReview:true, autoMerged:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (one that references a phantom member, mis-groups the partition, or
 *  autonomously merges) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified enrollment / MDM system.
 * ─────────────────────────────────────────────────────────────────────
 *  The members + links below are clearly-labeled ILLUSTRATIVE synthetics chosen to model the SHAPE of a
 *  household grouping deterministically in the demo. Real household / family-unit composition uses the
 *  subscriber / dependent structure of the 834 enrollment feed, address normalization, tax-household
 *  rules, and a master-data-management steward's judgment. TIME IS DATA: the finding is a pure function of
 *  the request's own members + links (no clock, no randomness), so the same input always yields the same
 *  grouping, which is what lets the demo, the seeded trace, and the tests agree.
 */

/** A pairwise relationship link between two members. */
export type HouseholdLink = {
  /** One member of the pair. */
  a: string;
  /** The other member of the pair. */
  b: string;
  /** The basis for the link (e.g., shared-subscriber, shared-address, tax-dependent). */
  basis: string;
};

/** A household-composition request. */
export type HouseholdCompositionRequest = {
  /** Synthetic batch reference. */
  batchRef: string;
  /** The member ids in the batch. */
  members: string[];
  /** The pairwise relationship links. */
  links: HouseholdLink[];
};

/** A computed household (a connected component). */
export type Household = {
  /** Deterministic household id (hh-1, hh-2, … assigned by the component's minimum member). */
  householdId: string;
  /** The member ids in the household, sorted. */
  members: string[];
  /** The number of members. */
  size: number;
};

/** The disposition of a composition finding. */
export type HouseholdCompositionDisposition = "all-singletons" | "households-formed";

/** The deterministic finding the agent returns. */
export type HouseholdCompositionDetermination = {
  batchRef: string;
  /** The de-duplicated submitted members, echoed so the guards can recompute. */
  members: string[];
  /** The applied links (endpoints that are submitted members), echoed. */
  links: HouseholdLink[];
  /** The computed households (connected components), sorted by household id. */
  households: Household[];
  /** The number of households. */
  householdCount: number;
  /** The size of the largest household (0 for no members). */
  largestHouseholdSize: number;
  /** The number of distinct members. */
  memberCount: number;
  /** The disposition. */
  disposition: HouseholdCompositionDisposition;
  /** Always true — a data steward confirms every grouping. */
  requiresStewardReview: true;
  /** Always false — the agent never autonomously merges member records. */
  autoMerged: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the members + links are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * Compute the connected-component partition via union-find (disjoint-set). DETERMINISTIC: de-dupes the
 * members, unions every link whose BOTH endpoints are submitted members (a link to a non-member is
 * ignored — it can't join the graph), groups members by their set representative, sorts each household's
 * members, and assigns household ids (hh-1, hh-2, …) in order of each component's minimum member. Shared
 * by the engine + the consistency guard so they compute identically.
 */
function computePartition(members: string[], links: HouseholdLink[]): Household[] {
  const uniq = Array.from(new Set(members.filter((m) => typeof m === "string")));
  const parent = new Map<string, string>();
  uniq.forEach((m) => parent.set(m, m));

  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    // Path compression.
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // Deterministic: the lexicographically smaller id becomes the root.
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  for (const link of Array.isArray(links) ? links : []) {
    if (link && parent.has(link.a) && parent.has(link.b)) union(link.a, link.b);
  }

  const groups = new Map<string, string[]>();
  for (const m of uniq) {
    const root = find(m);
    const g = groups.get(root);
    if (g) g.push(m);
    else groups.set(root, [m]);
  }

  const comps = Array.from(groups.values()).map((ms) => [...ms].sort());
  comps.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return comps.map((ms, i) => ({ householdId: `hh-${i + 1}`, members: ms, size: ms.length }));
}

/** Only the links whose both endpoints are submitted members (the links actually applied). */
function appliedLinks(members: string[], links: HouseholdLink[]): HouseholdLink[] {
  const set = new Set(members);
  return (Array.isArray(links) ? links : []).filter(
    (l) => l && set.has(l.a) && set.has(l.b)
  );
}

/**
 * The deterministic composition function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own members + links (no randomness, no clock). It de-dupes the members, applies the links
 * (only those between submitted members), computes the connected components via union-find, and derives
 * the disposition — all-singletons (no household has more than one member — no links formed a group) or
 * households-formed (at least one multi-member household). Nothing is merged — the grouping is handed to a
 * data steward.
 */
export function evaluateHouseholdComposition(
  request: HouseholdCompositionRequest
): HouseholdCompositionDetermination {
  const members = Array.from(
    new Set((Array.isArray(request.members) ? request.members : []).filter((m) => typeof m === "string"))
  );
  const links = appliedLinks(members, request.links).map((l) => ({
    a: l.a,
    b: l.b,
    basis: l.basis
  }));
  const households = computePartition(members, links);
  const memberCount = members.length;
  const householdCount = households.length;
  const largestHouseholdSize = households.reduce((mx, h) => Math.max(mx, h.size), 0);
  const disposition: HouseholdCompositionDisposition =
    largestHouseholdSize > 1 ? "households-formed" : "all-singletons";

  const reason =
    disposition === "households-formed"
      ? `${householdCount} household(s) formed from ${memberCount} member(s) via the transitive closure of ${links.length} link(s); the largest has ${largestHouseholdSize} members.`
      : `No households formed — all ${memberCount} member(s) are singletons (no relationship links joined any two).`;

  return {
    batchRef: request.batchRef,
    members,
    links,
    households,
    householdCount,
    largestHouseholdSize,
    memberCount,
    disposition,
    requiresStewardReview: true,
    autoMerged: false,
    reason,
    synthetic: true,
    note:
      `Household composition ${request.batchRef}: ${disposition.toUpperCase()} — ${householdCount} household(s) over ${memberCount} member(s) (largest ${largestHouseholdSize}, ${links.length} link(s) applied).` +
      " PHI-bearing — the members are patients. Synthetic/illustrative members + links — NOT a certified enrollment / MDM system; real household composition uses the 834 subscriber / dependent structure, address normalization, and tax-household rules. The agent never merges member records, changes enrollment, or applies a family accumulator on its own — a data steward confirms every grouping."
  };
}

/**
 * Links-sourced + completeness check: is the grouping built from the submitted batch? True only when every
 * echoed link connects two SUBMITTED members (no phantom relationship), and the households PARTITION
 * exactly the submitted members — each household well-formed ({ householdId, members[], size===members.length }),
 * every household member a submitted member, every submitted member in exactly one household, all covered,
 * none invented. Anything evaluateHouseholdComposition() produces satisfies it. This is the honest signal
 * the route reports to policy.household.links-sourced. A non-object / malformed input is a violation.
 */
export function householdLinksSourced(
  decision:
    | {
        members?: unknown;
        links?: unknown;
        households?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const members = Array.isArray(decision.members) ? decision.members : null;
  if (!members) return false;
  for (const m of members) if (typeof m !== "string") return false;
  const memberSet = new Set(members as string[]);

  const links = Array.isArray(decision.links) ? decision.links : null;
  if (!links) return false;
  for (const l of links) {
    if (
      !l ||
      typeof l !== "object" ||
      typeof (l as HouseholdLink).a !== "string" ||
      typeof (l as HouseholdLink).b !== "string" ||
      !memberSet.has((l as HouseholdLink).a) ||
      !memberSet.has((l as HouseholdLink).b)
    ) {
      return false;
    }
  }

  const households = Array.isArray(decision.households) ? decision.households : null;
  if (!households) return false;
  const seen = new Set<string>();
  for (const h of households) {
    if (!h || typeof h !== "object") return false;
    const hm = (h as Household).members;
    if (!Array.isArray(hm)) return false;
    if ((h as Household).size !== hm.length) return false;
    if (typeof (h as Household).householdId !== "string") return false;
    for (const m of hm) {
      if (typeof m !== "string" || !memberSet.has(m)) return false;
      if (seen.has(m)) return false; // a member in two households
      seen.add(m);
    }
  }
  // Every submitted member covered exactly once.
  if (seen.size !== memberSet.size) return false;
  return true;
}

/**
 * Partition-consistent check: recomputing the union-find from the echoed members + links must reproduce
 * the reported households (same ids, members, sizes), household count, largest-household size, member
 * count, and disposition. True only when they all match. Catches a wrong grouping — two unlinked members
 * merged, or two linked members split. The load-bearing correctness gate — it recomputes the connected
 * components from the links (ignoring the reported households' grouping), independent of the sourced
 * check. Anything evaluateHouseholdComposition() produces satisfies it. A non-object input is a violation.
 */
export function householdPartitionConsistent(
  decision:
    | {
        members?: unknown;
        links?: unknown;
        households?: unknown;
        householdCount?: unknown;
        largestHouseholdSize?: unknown;
        memberCount?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const members = Array.isArray(decision.members)
    ? (decision.members as unknown[]).filter((m): m is string => typeof m === "string")
    : null;
  if (!members) return false;
  const links = Array.isArray(decision.links) ? (decision.links as HouseholdLink[]) : [];

  const uniq = Array.from(new Set(members));
  const expected = computePartition(uniq, links);
  const expectedLargest = expected.reduce((mx, h) => Math.max(mx, h.size), 0);
  const expectedDisposition: HouseholdCompositionDisposition =
    expectedLargest > 1 ? "households-formed" : "all-singletons";

  const reported = Array.isArray(decision.households) ? (decision.households as Household[]) : null;
  if (!reported) return false;
  if (reported.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const r = reported[i];
    if (!r || r.householdId !== e.householdId) return false;
    if (r.size !== e.size) return false;
    if (!Array.isArray(r.members) || r.members.length !== e.members.length) return false;
    for (let j = 0; j < e.members.length; j++) {
      if (r.members[j] !== e.members[j]) return false;
    }
  }

  if (decision.householdCount !== expected.length) return false;
  if (decision.largestHouseholdSize !== expectedLargest) return false;
  if (decision.memberCount !== uniq.length) return false;
  if (decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * No-autonomous-merge check: did the agent avoid autonomously merging member records / changing
 * enrollment / applying a family accumulator? True unless the determination reports it auto-merged
 * (autoMerged:true) or does not require steward review (requiresStewardReview:false). Anything
 * evaluateHouseholdComposition() produces satisfies it. This is the honest signal the route reports to
 * policy.household.no-autonomous-merge. A non-object input is a violation.
 */
export function householdNoAutonomousMerge(
  decision:
    | { autoMerged?: boolean; requiresStewardReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoMerged === true) return false;
  if (decision.requiresStewardReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a finding — the shape stamped onto the Agent Fabric trace + the
 * response `meta`.
 */
export function householdCompositionSummary(decision: HouseholdCompositionDetermination): {
  batchRef: string;
  disposition: HouseholdCompositionDisposition;
  householdCount: number;
  largestHouseholdSize: number;
  memberCount: number;
  linkCount: number;
  requiresStewardReview: boolean;
  synthetic: boolean;
} {
  return {
    batchRef: decision.batchRef,
    disposition: decision.disposition,
    householdCount: decision.householdCount,
    largestHouseholdSize: decision.largestHouseholdSize,
    memberCount: decision.memberCount,
    linkCount: decision.links.length,
    requiresStewardReview: decision.requiresStewardReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: six members forming three households (a 3-member family via a transitive
 * chain, a 2-member pair, and a singleton). Synthetic.
 */
export const DEMO_HOUSEHOLD_COMPOSITION_REQUEST: HouseholdCompositionRequest = {
  batchRef: "hh-batch-001",
  members: ["m1", "m2", "m3", "m4", "m5", "m6"],
  links: [
    { a: "m1", b: "m2", basis: "shared-subscriber" },
    { a: "m2", b: "m3", basis: "shared-address" },
    { a: "m4", b: "m5", basis: "shared-subscriber" }
  ]
};

/**
 * A representative demo request: a five-member transitive chain forming ONE household — demonstrates that
 * m1 and m5 land together even though they are not directly linked. Synthetic.
 */
export const DEMO_HOUSEHOLD_COMPOSITION_CHAIN_REQUEST: HouseholdCompositionRequest = {
  batchRef: "hh-batch-002",
  members: ["m1", "m2", "m3", "m4", "m5"],
  links: [
    { a: "m1", b: "m2", basis: "shared-subscriber" },
    { a: "m2", b: "m3", basis: "shared-address" },
    { a: "m3", b: "m4", basis: "tax-dependent" },
    { a: "m4", b: "m5", basis: "shared-address" }
  ]
};

/** A representative demo request: three members with no links — all singletons. Synthetic. */
export const DEMO_HOUSEHOLD_COMPOSITION_SINGLETONS_REQUEST: HouseholdCompositionRequest = {
  batchRef: "hh-batch-003",
  members: ["m1", "m2", "m3"],
  links: []
};
