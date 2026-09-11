/**
 * Clinical List Reconciliation / Longest-Common-Subsequence (LCS) Diff — the deterministic, transparent
 * care-coordination layer that, given TWO ordered clinical lists for one record — a PRIOR list (the
 * medication list at admission, the problem list at last visit, the care-plan steps as last agreed) and a
 * CURRENT list (the same list now) — reconciles them by finding the LONGEST COMMON SUBSEQUENCE (the items
 * PRESERVED in both, in order) and derives what was RETAINED, ADDED, and REMOVED — without ever writing the
 * reconciled list back, updating the chart, or discontinuing anything. A clinician confirms.
 *
 * Deterministic, dependency-free domain core the List Reconciliation agent (app/api/agents/list-reconciliation)
 * wraps — a reconciliation agent on the care-coordination plane of Pause's Agent Fabric. CRUCIALLY, this is
 * NOT the Medication Name Safety agent's LEVENSHTEIN EDIT DISTANCE (which measures CHARACTER-level edit
 * distance between two drug-name STRINGS to catch look-alike/sound-alike confusability) and NOT the
 * Enrollment Reconciliation agent's KEYED SET RECONCILIATION (which joins two record sets on a key to find
 * adds/drops/mismatches, order-independent). It is also UNLIKE the Timeline Merge agent's K-WAY MERGE (which
 * interleaves already-sorted streams), the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, the
 * Peak-Window agent's KADANE MAXIMUM-SUBARRAY, the Care Routing agent's DIJKSTRA'S SHORTEST PATH, the Outreach
 * agent's 0/1 KNAPSACK, the Source Consensus agent's MAJORITY VOTE, the Code Taxonomy agent's TRIE
 * LONGEST-PREFIX MATCH, the Household Composition agent's UNION-FIND, the Care Pathway agent's TOPOLOGICAL
 * ORDERING, or the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM. The heart of this service is the
 * LONGEST COMMON SUBSEQUENCE: a dynamic-programming table over the two ORDERED lists finds the longest
 * subsequence common to both (the items kept, in their shared order), and its complement in each list is what
 * was removed (in prior only) and added (in current only). Order matters — LCS respects the sequence — which
 * is exactly what set reconciliation throws away.
 *
 *   Inbound:  a ListReconciliationRequest { recordRef, prior[], current[] }  (two ordered item lists)
 *   Outbound: a ListReconciliationDetermination { retained[], added[], removed[], lcsLength, disposition,
 *             requiresClinicianReview:true, autoApplied:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the diff is sourced and self-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  A reconciliation is trustworthy only if it is a REAL, self-consistent accounting of the two submitted
 *  lists: the reported RETAINED list must be a GENUINE COMMON SUBSEQUENCE of both lists (it appears in order
 *  within prior AND within current — nothing fabricated, nothing reordered), the REMOVED list must be exactly
 *  the prior items left unmatched (in order), the ADDED list must be exactly the current items left unmatched
 *  (in order), the reported lcsLength must match the retained length, and the disposition must follow. A
 *  fabricated "retained" item, a reordered subsequence, or a mis-stated add/remove corrupts the diff.
 *  diffSourced() verifies it; the Agent Fabric enforces it via policy.listdiff.diff-sourced. It does NOT
 *  recompute the LCS DP — that is the optimality gate's job — so the two are isolable. (The sourced +
 *  self-consistency gate — mirrors the SLA Worklist Agent's schedule-sourced and the Peak-Window Agent's
 *  window-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the common subsequence is the longest.
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running the LCS dynamic program over the two submitted lists must reproduce the reported lcsLength (and
 *  disposition). A shorter-than-optimal common subsequence OVER-reports change — it lists items as
 *  removed+added that were really preserved, alarming a clinician needlessly. diffOptimal() recomputes the LCS
 *  length INDEPENDENT of the reported retained list (it recomputes the scalar optimum from the two lists, not
 *  from the reported subsequence), so a fabricated retained list that still reports the optimal length fails
 *  sourced only, and a real-but-sub-optimal subsequence fails optimal only — the two gates are isolable. The
 *  Agent Fabric enforces it via policy.listdiff.lcs-optimal. (The load-bearing correctness gate — mirrors the
 *  SLA Worklist Agent's edf-ordered and the Care Routing Agent's route-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous update.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent RECONCILES on paper — it never writes the reconciled list back, updates the chart, or
 *  starts/stops a medication on its own (each is a clinical write that must be authorized); every
 *  reconciliation is a RECOMMENDATION requiring a clinician to confirm. noAutonomousUpdate() reports the
 *  honest signal the Agent Fabric enforces via policy.listdiff.no-autonomous-update. (Mirrors the SLA Worklist
 *  Agent's no-autonomous-dispatch and the Resource Scheduling Agent's no-autonomous-booking — the harmful
 *  action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A reconciliation — lists-match or changes-present — is a SAFE, honest OUTPUT: the task COMPLETES (it
 *  carries requiresClinicianReview:true, autoApplied:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (a fabricated / reordered retained list, a sub-optimal common subsequence, or an
 *  autonomous update) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified medication-reconciliation system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real medication / problem-list reconciliation normalizes to RxNorm / SNOMED, accounts for dose + route +
 *  frequency, therapeutic equivalence, and clinical intent — not a bare token-level LCS over a handful of
 *  labels. This reconciles the supplied illustrative lists only. TIME IS DATA: the two lists are plain ordered
 *  tokens and the diff is a pure function of them (no clock, no randomness), so the same request always yields
 *  the same determination, which is what lets the demo, the seeded trace, and the tests agree. The lists are a
 *  clearly-labeled ILLUSTRATIVE synthetic. It IS PHI-bearing — the lists are one patient's clinical record.
 */

/** A request: one record + its prior and current ordered item lists (tokens: med names, problem codes, ...). */
export type ListReconciliationRequest = {
  recordRef: string;
  /** The prior ordered list (e.g., medication list at admission). */
  prior: string[];
  /** The current ordered list (e.g., medication list now). */
  current: string[];
};

export type ListReconciliationDisposition = "lists-match" | "changes-present";

/** The deterministic finding the agent returns. */
export type ListReconciliationDetermination = {
  recordRef: string;
  /** The submitted lists, echoed so the guards can recompute. */
  prior: string[];
  current: string[];
  /** The longest common subsequence — the items preserved in both, in their shared order. */
  retained: string[];
  /** Current items with no match — the additions (in current order). */
  added: string[];
  /** Prior items with no match — the removals (in prior order). */
  removed: string[];
  /** The length of the longest common subsequence. */
  lcsLength: number;
  disposition: ListReconciliationDisposition;
  /** Always true — a clinician confirms every reconciliation. */
  requiresClinicianReview: true;
  /** Always false — the agent never autonomously writes the reconciled list. */
  autoApplied: false;
  reason: string;
  synthetic: true;
  note: string;
};

/**
 * The LONGEST COMMON SUBSEQUENCE via dynamic programming + backtrack — the heart of the service. Fills an
 * (n+1)×(m+1) table from the bottom-right so dp[i][j] is the LCS length of prior[i:] and current[j:], then
 * backtracks from (0,0) preferring to advance in prior on ties (documented, deterministic) to recover the
 * actual subsequence. Returns the retained items in their shared order.
 */
export function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const retained: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      retained.push(a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return retained;
}

/** The LCS length only (the scalar optimum) — recomputed by the optimality gate independent of any subsequence. */
export function lcsLength(a: string[], b: string[]): number {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp[0][0];
}

/**
 * Greedy earliest-match: the indices of `seq` that match `sub` as a subsequence (in order), or null when
 * `sub` is not a subsequence of `seq`. Deterministic. Used to derive the removed/added complements and by the
 * sourced guard to verify the reported retained list is a genuine subsequence.
 */
function subsequenceMatchedIndices(sub: string[], seq: string[]): number[] | null {
  const indices: number[] = [];
  let k = 0;
  for (let i = 0; i < seq.length && k < sub.length; i++) {
    if (seq[i] === sub[k]) {
      indices.push(i);
      k++;
    }
  }
  return k === sub.length ? indices : null;
}

/** The items of `seq` NOT at the matched indices, in order — the complement (removals or additions). */
function complement(seq: string[], matched: number[]): string[] {
  const matchedSet = new Set(matched);
  const out: string[] = [];
  for (let i = 0; i < seq.length; i++) {
    if (!matchedSet.has(i)) out.push(seq[i]);
  }
  return out;
}

/**
 * The deterministic reconciliation function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own two lists (no randomness, no clock). It computes the LCS (retained), then derives removed /
 * added as the unmatched complements, and the disposition. Nothing is written back — the diff is handed to a
 * clinician.
 */
export function evaluateListReconciliation(
  request: ListReconciliationRequest
): ListReconciliationDetermination {
  const prior = Array.isArray(request.prior) ? request.prior : [];
  const current = Array.isArray(request.current) ? request.current : [];
  const retained = longestCommonSubsequence(prior, current);
  // The LCS is a subsequence of both by construction, so both matches are non-null.
  const priorMatched = subsequenceMatchedIndices(retained, prior) ?? [];
  const currentMatched = subsequenceMatchedIndices(retained, current) ?? [];
  const removed = complement(prior, priorMatched);
  const added = complement(current, currentMatched);
  const disposition: ListReconciliationDisposition =
    removed.length === 0 && added.length === 0 ? "lists-match" : "changes-present";

  const reason =
    disposition === "lists-match"
      ? `Reconciled ${current.length} item(s) for ${request.recordRef} \u2014 the lists match; no changes.`
      : `Reconciled ${request.recordRef} \u2014 ${retained.length} retained, ${added.length} added, ${removed.length} removed.`;

  return {
    recordRef: request.recordRef,
    prior,
    current,
    retained,
    added,
    removed,
    lcsLength: retained.length,
    disposition,
    requiresClinicianReview: true,
    autoApplied: false,
    reason,
    synthetic: true,
    note:
      `List reconciliation ${request.recordRef}: ${disposition.toUpperCase()} \u2014 ` +
      `${retained.length} retained / ${added.length} added / ${removed.length} removed via LONGEST COMMON SUBSEQUENCE over the two ordered lists. ` +
      "Real medication / problem-list reconciliation normalizes to RxNorm / SNOMED and accounts for dose, route, frequency, therapeutic equivalence, and clinical intent \u2014 not a bare token-level LCS over a handful of labels. Synthetic/illustrative lists \u2014 NOT a certified medication-reconciliation system. The agent never writes the reconciled list back, updates the chart, or starts/stops a medication on its own \u2014 a clinician confirms every reconciliation. PHI-bearing \u2014 the lists are one patient's clinical record."
  };
}

/**
 * Sourced + self-consistency check: is the reported diff a REAL, self-consistent accounting of the two
 * submitted lists? The reported RETAINED list must be a genuine COMMON SUBSEQUENCE of both lists (a
 * subsequence of prior AND of current, in order — nothing fabricated, nothing reordered), the REMOVED list
 * must equal exactly the prior items left unmatched (in order), the ADDED list must equal exactly the current
 * items left unmatched (in order), the reported lcsLength must equal the retained length, and the disposition
 * must follow. Catches a fabricated / reordered retained item or a mis-stated add/remove. Does NOT recompute
 * the LCS DP (that is the optimality gate's job), so it is independent of it. Anything
 * evaluateListReconciliation() produces satisfies it. This is the honest signal the diff reports to
 * policy.listdiff.diff-sourced. A non-object / malformed input is a violation.
 */
export function diffSourced(
  decision:
    | {
        prior?: unknown;
        current?: unknown;
        retained?: unknown;
        added?: unknown;
        removed?: unknown;
        lcsLength?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const prior = Array.isArray(decision.prior) ? (decision.prior as unknown[]) : null;
  const current = Array.isArray(decision.current) ? (decision.current as unknown[]) : null;
  const retained = Array.isArray(decision.retained) ? (decision.retained as unknown[]) : null;
  const added = Array.isArray(decision.added) ? (decision.added as unknown[]) : null;
  const removed = Array.isArray(decision.removed) ? (decision.removed as unknown[]) : null;
  if (!prior || !current || !retained || !added || !removed) return false;
  if (!prior.every((x) => typeof x === "string")) return false;
  if (!current.every((x) => typeof x === "string")) return false;
  if (!retained.every((x) => typeof x === "string")) return false;

  const priorS = prior as string[];
  const currentS = current as string[];
  const retainedS = retained as string[];

  // retained must be a genuine common subsequence of both submitted lists.
  const priorMatched = subsequenceMatchedIndices(retainedS, priorS);
  const currentMatched = subsequenceMatchedIndices(retainedS, currentS);
  if (!priorMatched || !currentMatched) return false;

  // removed / added must be exactly the unmatched complements, in order.
  const expectedRemoved = complement(priorS, priorMatched);
  const expectedAdded = complement(currentS, currentMatched);
  if (removed.length !== expectedRemoved.length) return false;
  if (added.length !== expectedAdded.length) return false;
  for (let i = 0; i < expectedRemoved.length; i++) {
    if (removed[i] !== expectedRemoved[i]) return false;
  }
  for (let i = 0; i < expectedAdded.length; i++) {
    if (added[i] !== expectedAdded[i]) return false;
  }

  // lcsLength must match the retained length.
  if (typeof decision.lcsLength !== "number" || decision.lcsLength !== retainedS.length) return false;

  // disposition must follow from the complements.
  const expectedDisposition: ListReconciliationDisposition =
    expectedRemoved.length === 0 && expectedAdded.length === 0 ? "lists-match" : "changes-present";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }
  return true;
}

/**
 * Optimality check: re-running the LCS dynamic program over the two submitted lists must reproduce the
 * reported lcsLength (and disposition). True only when the recompute agrees. Catches a shorter-than-optimal
 * common subsequence that over-reports change. The load-bearing correctness gate — it recomputes the LCS
 * length from the two lists INDEPENDENT of the reported retained subsequence (it compares the scalar optimum,
 * not the reported items), so a fabricated retained list that still reports the optimal length fails sourced
 * only while a real-but-sub-optimal subsequence fails here — the two gates are isolable. Anything
 * evaluateListReconciliation() produces satisfies it. A non-object input is a violation.
 */
export function diffOptimal(
  decision: { prior?: unknown; current?: unknown; lcsLength?: unknown; disposition?: unknown } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const prior = Array.isArray(decision.prior) ? (decision.prior as unknown[]) : null;
  const current = Array.isArray(decision.current) ? (decision.current as unknown[]) : null;
  if (!prior || !current) return false;
  if (!prior.every((x) => typeof x === "string")) return false;
  if (!current.every((x) => typeof x === "string")) return false;
  const priorS = prior as string[];
  const currentS = current as string[];

  const trueLength = lcsLength(priorS, currentS);
  if (typeof decision.lcsLength !== "number" || decision.lcsLength !== trueLength) return false;

  const expectedDisposition: ListReconciliationDisposition =
    trueLength === priorS.length && trueLength === currentS.length ? "lists-match" : "changes-present";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }
  return true;
}

/**
 * No-autonomous-update check: did the agent avoid writing on its own? True unless the determination reports it
 * auto-applied the reconciliation (autoApplied:true) or does not require clinician review
 * (requiresClinicianReview:false). Anything evaluateListReconciliation() produces satisfies it. This is the
 * honest signal the diff reports to policy.listdiff.no-autonomous-update. A non-object input is a violation.
 */
export function noAutonomousUpdate(
  decision: { autoApplied?: boolean; requiresClinicianReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoApplied === true) return false;
  if (decision.requiresClinicianReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a reconciliation. */
export function listReconciliationSummary(decision: ListReconciliationDetermination): {
  recordRef: string;
  disposition: ListReconciliationDisposition;
  priorCount: number;
  currentCount: number;
  retainedCount: number;
  addedCount: number;
  removedCount: number;
  lcsLength: number;
  requiresClinicianReview: boolean;
  synthetic: boolean;
} {
  return {
    recordRef: decision.recordRef,
    disposition: decision.disposition,
    priorCount: decision.prior.length,
    currentCount: decision.current.length,
    retainedCount: decision.retained.length,
    addedCount: decision.added.length,
    removedCount: decision.removed.length,
    lcsLength: decision.lcsLength,
    requiresClinicianReview: decision.requiresClinicianReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: one patient's medication list reconciled between admission and discharge. The
 * LCS is metformin → atorvastatin → aspirin (retained, length 3); lisinopril was stopped (removed) and
 * estradiol was started (added). Synthetic; PHI-bearing.
 */
export const DEMO_LIST_RECONCILIATION_REQUEST: ListReconciliationRequest = {
  recordRef: "med-list-mrn-4821",
  prior: ["lisinopril", "metformin", "atorvastatin", "aspirin"],
  current: ["metformin", "atorvastatin", "estradiol", "aspirin"]
};

/** A representative demo request whose two lists are identical (lists-match; no changes). Synthetic. */
export const DEMO_LIST_RECONCILIATION_MATCH_REQUEST: ListReconciliationRequest = {
  recordRef: "med-list-mrn-7702",
  prior: ["estradiol", "progesterone", "calcium-vitamin-d"],
  current: ["estradiol", "progesterone", "calcium-vitamin-d"]
};

/**
 * A representative demo request over a problem list with several changes — the LCS keeps insomnia →
 * hypertension (retained, length 2); hot-flashes + osteopenia were removed and osteoporosis + anxiety added.
 * Synthetic; PHI-bearing.
 */
export const DEMO_LIST_RECONCILIATION_CHANGED_REQUEST: ListReconciliationRequest = {
  recordRef: "problem-list-mrn-5530",
  prior: ["hot-flashes", "insomnia", "osteopenia", "hypertension"],
  current: ["insomnia", "osteoporosis", "hypertension", "anxiety"]
};
