/**
 * Source-of-Truth Consensus / Golden-Record Field Reconciliation — the deterministic, transparent
 * data-substrate layer that, given a single logical FIELD (say a provider's specialty, an org's tax id, or a
 * plan's network status) whose VALUE is reported by several SOURCE SYSTEMS (an EHR feed, a claims feed, a
 * pharmacy feed, an HIE feed), decides whether those source votes have a STRICT MAJORITY — a consensus value
 * that more than half the sources agree on — and, if so, what it is, or honestly reports NO-CONSENSUS when no
 * value commands a strict majority; it never WRITES the consensus back to the golden record on its own. A
 * data steward confirms.
 *
 * Deterministic, dependency-free domain core the Source Consensus agent (app/api/agents/source-consensus)
 * wraps — a data-reconciliation / master-data service on the platform & data-substrate plane of Pause's Agent
 * Fabric. UNLIKE the Care Routing agent's DIJKSTRA'S WEIGHTED SHORTEST PATH, the KPI Trend agent's
 * LEAST-SQUARES LINEAR REGRESSION, the Outreach Prioritization agent's 0/1 KNAPSACK DYNAMIC PROGRAMMING, the
 * Quality Shift agent's CUSUM CHANGE-POINT DETECTION, the Timeline Merge agent's K-WAY MERGE OF SORTED
 * STREAMS, the Reportable Condition agent's RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP Matching
 * agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE
 * DISTANCE, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking
 * agent's PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the
 * Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL
 * SELECTION, the Audit Log Integrity agent's HASH CHAIN, or the Claim Lifecycle agent's BFS REACHABILITY —
 * and, CRUCIALLY, UNLIKE the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE (which diffs WHO is on
 * two rosters — enroll / terminate / update) and the Master-Patient-Index agent's WEIGHTED identity MATCHING
 * (which decides whether two RECORDS are the same person) — the heart of this service is the BOYER–MOORE
 * MAJORITY VOTE: the classic linear-time, constant-space algorithm that finds a strict-majority element in a
 * single cancellation pass (hold a candidate + a counter; on a matching vote increment, on a differing vote
 * decrement, and reset the candidate when the counter hits zero) followed by one verification pass that
 * confirms the surviving candidate actually occurs in more than half the votes. When two feeds disagree, a
 * naive "last write wins" or "first source wins" silently picks a wrong value; a majority vote picks the
 * value the SOURCES themselves corroborate — and honestly declines when they don't. So this reconciles
 * DETERMINISTICALLY and hands the golden-record write to a human.
 *
 *   Inbound:  a ConsensusRequest { fieldRef, votes[] }
 *   Outbound: a ConsensusDetermination { candidate, candidateCount, total, hasConsensus, agreements[],
 *             disposition, requiresStewardReview:true, autoWritten:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the reported agreements are sourced and complete.
 * ─────────────────────────────────────────────────────────────────────
 *  A reconciliation is trustworthy only if its per-source attribution corresponds EXACTLY to the submitted
 *  votes: every reported agreement must trace to a SUBMITTED vote (same sourceId + value; no FABRICATED
 *  source), every submitted vote must appear exactly once (none dropped, none double-listed), and the
 *  reported total must equal the number of votes. A fabricated source stuffs the ballot; a dropped source
 *  disenfranchises a feed. votesSourced() verifies it; the Agent Fabric enforces it via
 *  policy.consensus.votes-sourced. It does NOT recompute the winner or check the agreement flags — that is
 *  the consistency gate's job — so the two are isolable. (The sourced + completeness gate — mirrors the
 *  Enrollment Reconciliation Agent's reconciliation-complete and the Timeline Merge Agent's events-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the consensus recomputes.
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running the Boyer–Moore majority vote over the submitted votes must reproduce the reported candidate,
 *  its count, the has-consensus flag, and the disposition — and every real source's agreement flag must equal
 *  (its value === the candidate). A wrong winner writes a minority value to the golden record; a false
 *  consensus over a plurality corrupts it. consensusConsistent() recomputes it end-to-end, INDEPENDENT of the
 *  reported agreements (it filters them to the ones that correspond to a real submitted vote before checking
 *  their flags, and recomputes the winner from the votes, not the agreements), so a fabricated-source
 *  agreement that still reports the true winner fails sourced only, and a real-source but mis-flagged or
 *  wrong-winner determination fails consistent only — the two gates are isolable. The Agent Fabric enforces
 *  it via policy.consensus.consensus-consistent. (The load-bearing correctness gate — mirrors the Timeline
 *  Merge Agent's merge-consistent and the Identifier Validation Agent's checksum-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous write.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent RECONCILES on paper — it never writes the consensus value to the golden record / master data,
 *  overwrites a source system, or promotes a value to system-of-record on its own (each is a data-integrity
 *  action that must be authorized); every reconciliation is a RECOMMENDATION requiring a data steward to
 *  confirm. noAutonomousWrite() reports the honest signal the Agent Fabric enforces via
 *  policy.consensus.no-autonomous-write. (Mirrors the Timeline Merge Agent's no-autonomous-merge and the
 *  Enrollment Reconciliation Agent's no-autonomous-change — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A reconciliation — consensus or no-consensus — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresStewardReview:true, autoWritten:false). A GOVERNANCE BLOCK is when a caller PRESENTS an offending
 *  DETERMINATION (a fabricated / dropped source, a wrong-winner / false-consensus reconciliation, or an
 *  autonomous write) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified master-data-management / golden-record system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real MDM weights sources by trust and recency, resolves value semantics (units, formatting, aliases),
 *  survives field-by-field with lineage, and applies data-governance stewardship workflows — not a bare
 *  majority of raw string votes. This reconciles the supplied illustrative votes only. TIME IS DATA: the
 *  consensus is a pure function of the votes themselves (no clock, no randomness), so the same request always
 *  yields the same determination, which is what lets the demo, the seeded trace, and the tests agree. The
 *  fields, sources, and values are clearly-labeled ILLUSTRATIVE synthetics; DELIBERATELY NOT PHI-bearing — a
 *  golden-record reference attribute (a provider's specialty, an org's identifier), not patient health
 *  information.
 */

/** One source system's reported value for the field. */
export type SourceVote = {
  sourceId: string;
  value: string;
  label?: string;
};

/** A reconciliation request: one field, several source votes. */
export type ConsensusRequest = {
  fieldRef: string;
  votes: SourceVote[];
};

export type ConsensusDisposition = "consensus" | "no-consensus";

/** Per-source attribution: does this source agree with the consensus value? */
export type SourceAgreement = {
  sourceId: string;
  value: string;
  agreesWithConsensus: boolean;
};

/** The deterministic finding the agent returns. */
export type ConsensusDetermination = {
  fieldRef: string;
  /** The submitted votes, echoed so the guards can recompute. */
  votes: SourceVote[];
  /** The strict-majority value (null when no-consensus). */
  candidate: string | null;
  /** The number of votes for the candidate (0 when no-consensus). */
  candidateCount: number;
  /** The total number of votes. */
  total: number;
  /** True iff candidateCount > total / 2 (a strict majority). */
  hasConsensus: boolean;
  /** One entry per submitted vote: whether it agrees with the consensus value. */
  agreements: SourceAgreement[];
  disposition: ConsensusDisposition;
  /** Always true — a data steward confirms every reconciliation. */
  requiresStewardReview: true;
  /** Always false — the agent never autonomously writes the golden record. */
  autoWritten: false;
  reason: string;
  synthetic: true;
  note: string;
};

/**
 * BOYER–MOORE MAJORITY VOTE — the heart of the service. Finds a strict-majority element in linear time and
 * constant space: a single cancellation pass elects a surviving candidate (hold a candidate + counter; on a
 * matching vote increment, on a differing vote decrement, and adopt a new candidate when the counter hits
 * zero), then one verification pass confirms it actually occurs in more than half the votes. Returns the
 * candidate (null if none has a strict majority) and its count. Deterministic.
 */
export function boyerMooreMajority(
  values: string[]
): { candidate: string | null; count: number } {
  // Cancellation pass.
  let candidate: string | null = null;
  let counter = 0;
  for (const v of values) {
    if (counter === 0) {
      candidate = v;
      counter = 1;
    } else if (v === candidate) {
      counter += 1;
    } else {
      counter -= 1;
    }
  }
  if (candidate === null) return { candidate: null, count: 0 };

  // Verification pass — Boyer–Moore only guarantees a candidate IF a strict majority exists.
  let count = 0;
  for (const v of values) if (v === candidate) count += 1;
  if (count * 2 > values.length) return { candidate, count };
  return { candidate: null, count: 0 };
}

/**
 * The deterministic reconciliation function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own votes (no randomness, no clock). It runs the Boyer–Moore majority vote, derives the
 * consensus, and attributes each source. Nothing is written — the reconciliation is handed to a data steward.
 */
export function evaluateConsensus(request: ConsensusRequest): ConsensusDetermination {
  const votes = Array.isArray(request.votes) ? request.votes : [];
  const total = votes.length;
  const { candidate, count } = boyerMooreMajority(votes.map((v) => v.value));
  const hasConsensus = candidate !== null && count * 2 > total;
  const disposition: ConsensusDisposition = hasConsensus ? "consensus" : "no-consensus";

  const agreements: SourceAgreement[] = votes.map((v) => ({
    sourceId: v.sourceId,
    value: v.value,
    agreesWithConsensus: hasConsensus && v.value === candidate
  }));

  const reason = hasConsensus
    ? `Consensus on ${request.fieldRef}: "${candidate}" carries a strict majority (${count} of ${total} sources).`
    : `No consensus on ${request.fieldRef}: no value carries a strict majority across the ${total} source vote(s).`;

  return {
    fieldRef: request.fieldRef,
    votes,
    candidate: hasConsensus ? candidate : null,
    candidateCount: hasConsensus ? count : 0,
    total,
    hasConsensus,
    agreements,
    disposition,
    requiresStewardReview: true,
    autoWritten: false,
    reason,
    synthetic: true,
    note:
      `Source-of-truth reconciliation ${request.fieldRef}: ${disposition.toUpperCase()} \u2014 ` +
      (hasConsensus
        ? `"${candidate}" wins a strict majority (${count}/${total}) via the BOYER\u2013MOORE MAJORITY VOTE (single cancellation pass + one verification pass).`
        : `no value carries a strict majority across ${total} source vote(s); the field is left to a data steward to adjudicate.`) +
      " Real master-data management weights sources by trust and recency, resolves value semantics (units, formatting, aliases), and survives field-by-field with lineage \u2014 not a bare majority of raw string votes. Synthetic/illustrative fields + sources + values \u2014 NOT a certified master-data-management / golden-record system; DELIBERATELY NOT PHI-bearing. The agent never writes the consensus to the golden record, overwrites a source, or promotes a value to system-of-record on its own \u2014 a data steward confirms every reconciliation."
  };
}

/** Index the submitted votes by "sourceId|value" for O(1) membership lookup. */
function voteKeys(votes: SourceVote[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of votes) {
    const k = `${v.sourceId}|${v.value}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/**
 * Sourced + completeness check: does the reported per-source attribution correspond EXACTLY to the submitted
 * votes? Every agreement must trace to a submitted vote (same sourceId + value; no fabricated source), every
 * submitted vote must be attributed exactly once (none dropped, none double-listed), and the reported total
 * must equal the number of votes. Catches a fabricated or dropped source. Does NOT recompute the winner or
 * check the agreement flags (that is the consistency gate's job), so it is independent of it. Anything
 * evaluateConsensus() produces satisfies it. This is the honest signal the reconciliation reports to
 * policy.consensus.votes-sourced. A non-object / malformed input is a violation.
 */
export function votesSourced(
  decision:
    | { votes?: unknown; agreements?: unknown; total?: unknown }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const votes = Array.isArray(decision.votes) ? (decision.votes as SourceVote[]) : null;
  const agreements = Array.isArray(decision.agreements)
    ? (decision.agreements as SourceAgreement[])
    : null;
  if (!votes || !agreements) return false;
  if (typeof decision.total !== "number" || decision.total !== votes.length) return false;
  if (agreements.length !== votes.length) return false;

  // Every agreement must trace to a submitted vote, each consumed exactly once.
  const remaining = voteKeys(votes);
  for (const a of agreements) {
    if (typeof a.sourceId !== "string" || typeof a.value !== "string") return false;
    const k = `${a.sourceId}|${a.value}`;
    const n = remaining.get(k);
    if (!n) return false; // fabricated source or already consumed (double-listed)
    remaining.set(k, n - 1);
  }
  // With equal lengths and every agreement consumed from a real vote, none dropped.
  return true;
}

/**
 * Consistency check: recomputing the Boyer–Moore majority vote over the submitted votes must reproduce the
 * reported candidate, its count, the has-consensus flag, and the disposition; and every agreement that
 * corresponds to a REAL submitted vote must carry agreesWithConsensus === (its value === the candidate). True
 * only when the recompute agrees. Catches a wrong winner, a false consensus, or a mis-flagged source. The
 * load-bearing correctness gate — it recomputes the winner from the votes INDEPENDENT of the reported
 * agreements (it filters them to real votes before checking their flags), so a fabricated-source agreement
 * that still reports the true winner fails sourced while recomputing here, and a real-source but mis-flagged
 * or wrong-winner determination fails here while passing sourced — the two gates are isolable. Anything
 * evaluateConsensus() produces satisfies it. A non-object input is a violation.
 */
export function consensusConsistent(
  decision:
    | {
        votes?: unknown;
        agreements?: unknown;
        candidate?: unknown;
        candidateCount?: unknown;
        hasConsensus?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const votes = Array.isArray(decision.votes) ? (decision.votes as SourceVote[]) : null;
  const agreements = Array.isArray(decision.agreements)
    ? (decision.agreements as SourceAgreement[])
    : null;
  if (!votes || !agreements) return false;

  const total = votes.length;
  const { candidate, count } = boyerMooreMajority(votes.map((v) => v.value));
  const hasConsensus = candidate !== null && count * 2 > total;
  const expectedCandidate = hasConsensus ? candidate : null;
  const expectedCount = hasConsensus ? count : 0;
  const expectedDisposition: ConsensusDisposition = hasConsensus ? "consensus" : "no-consensus";

  if ((decision.candidate ?? null) !== expectedCandidate) return false;
  if (decision.candidateCount !== expectedCount) return false;
  if (decision.hasConsensus !== hasConsensus) return false;
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }

  // Every REAL-source agreement must carry the correct flag (filter phantom sources out).
  const real = voteKeys(votes);
  for (const a of agreements) {
    const k = `${a.sourceId}|${a.value}`;
    if (!real.get(k)) continue; // phantom source — isolated to the sourced gate
    const shouldAgree = hasConsensus && a.value === expectedCandidate;
    if (a.agreesWithConsensus !== shouldAgree) return false;
  }
  return true;
}

/**
 * No-autonomous-write check: did the agent avoid writing the golden record on its own? True unless the
 * determination reports it auto-wrote (autoWritten:true) or does not require steward review
 * (requiresStewardReview:false). Anything evaluateConsensus() produces satisfies it. This is the honest
 * signal the reconciliation reports to policy.consensus.no-autonomous-write. A non-object input is a
 * violation.
 */
export function noAutonomousWrite(
  decision: { autoWritten?: boolean; requiresStewardReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoWritten === true) return false;
  if (decision.requiresStewardReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a reconciliation. */
export function consensusSummary(decision: ConsensusDetermination): {
  fieldRef: string;
  disposition: ConsensusDisposition;
  voteCount: number;
  candidate: string | null;
  candidateCount: number;
  total: number;
  hasConsensus: boolean;
  requiresStewardReview: boolean;
  synthetic: boolean;
} {
  return {
    fieldRef: decision.fieldRef,
    disposition: decision.disposition,
    voteCount: decision.votes.length,
    candidate: decision.candidate,
    candidateCount: decision.candidateCount,
    total: decision.total,
    hasConsensus: decision.hasConsensus,
    requiresStewardReview: decision.requiresStewardReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request whose sources reach a strict-majority consensus (4 of 5 sources report the
 * same specialty). Synthetic reference-data field.
 */
export const DEMO_CONSENSUS_REQUEST: ConsensusRequest = {
  fieldRef: "provider-4417.specialty",
  votes: [
    { sourceId: "ehr-feed", value: "Endocrinology", label: "EHR directory" },
    { sourceId: "claims-feed", value: "Endocrinology", label: "Claims system" },
    { sourceId: "credentialing-feed", value: "Endocrinology", label: "Credentialing" },
    { sourceId: "hie-feed", value: "Endocrinology", label: "HIE roster" },
    { sourceId: "legacy-feed", value: "Internal Medicine", label: "Legacy import" }
  ]
};

/**
 * A representative demo request whose sources are split with no strict majority (a 2-2-1 plurality —
 * Boyer–Moore's candidate fails verification). Synthetic.
 */
export const DEMO_CONSENSUS_NO_MAJORITY_REQUEST: ConsensusRequest = {
  fieldRef: "provider-8829.network-status",
  votes: [
    { sourceId: "ehr-feed", value: "In-Network", label: "EHR directory" },
    { sourceId: "claims-feed", value: "In-Network", label: "Claims system" },
    { sourceId: "hie-feed", value: "Out-of-Network", label: "HIE roster" },
    { sourceId: "legacy-feed", value: "Out-of-Network", label: "Legacy import" },
    { sourceId: "portal-feed", value: "Pending", label: "Provider portal" }
  ]
};

/**
 * A representative demo request with a unanimous single source of truth (all three sources agree).
 * Synthetic.
 */
export const DEMO_CONSENSUS_UNANIMOUS_REQUEST: ConsensusRequest = {
  fieldRef: "org-201.tax-id",
  votes: [
    { sourceId: "erp-feed", value: "82-1147739", label: "ERP master" },
    { sourceId: "billing-feed", value: "82-1147739", label: "Billing" },
    { sourceId: "contracts-feed", value: "82-1147739", label: "Contracts" }
  ]
};
