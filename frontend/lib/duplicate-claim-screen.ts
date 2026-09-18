/**
 * Duplicate-Claim Pre-Screen / Bloom-Filter Membership Test — the deterministic, transparent payer-operations
 * layer that, given a set of already-PROCESSED claim ids and a batch of INCOMING claim ids, builds a BLOOM FILTER
 * over the processed ids (a fixed bit array of size m, probed by k hash functions) and screens each incoming id:
 * a query whose k bits are all set is a POSSIBLE-DUPLICATE (route to the authoritative check), and a query with
 * ANY zero bit is DEFINITELY-NEW (provably never processed — a Bloom filter has NO false negatives) — so the
 * expensive exact duplicate lookup runs only on the small suspected set, and a genuinely-new claim is never held
 * up — without ever rejecting, denying, or paying a single claim on its own. A claims adjudicator confirms.
 *
 * Deterministic, dependency-free domain core the Duplicate-Claim Screen agent (app/api/agents/duplicate-claim-
 * screen) wraps — a claims pre-screen agent on the PHI-bearing payer & plan operations plane of Pause's Agent
 * Fabric. CRUCIALLY, the heart of this service is the BLOOM FILTER: a space-efficient PROBABILISTIC set-
 * membership structure. Insert each processed id by setting the k bits at hash_1(id)..hash_k(id) mod m; query an
 * incoming id by testing those same k bits — all set ⇒ possibly present (a true member OR a false positive), any
 * clear ⇒ definitely absent (never a false negative). This is a genuinely NEW computation pattern for the fabric:
 * it is NOT the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE (an EXACT two-roster diff — this is a
 * probabilistic one-sided membership pre-screen with a tunable false-positive rate and NO per-key storage), NOT
 * the Source Consensus agent's BOYER–MOORE MAJORITY VOTE, NOT the Timeline Merge agent's K-WAY MERGE, NOT the
 * Audit Log Integrity agent's HASH CHAIN (a tamper-evidence chain, not a membership set), NOT the Identifier
 * Validation agent's MODULAR-ARITHMETIC CHECKSUM, and NOT the Code Taxonomy agent's TRIE LONGEST-PREFIX MATCH —
 * it is Bloom-filter membership. The one-sided guarantee (NO false negatives) and the honest false-positive rate
 * are the invariants this service reports and defends.
 *
 *   Inbound:  a DuplicateScreenRequest { batchRef, bitSize, hashCount, processedIds[], incomingIds[] }
 *   Outbound: a DuplicateScreenDetermination { bits[], setBitCount, results[], possibleDuplicateCount,
 *             definitelyNewCount, estimatedFalsePositiveRate, bitSize, hashCount, processedCount, incomingCount,
 *             disposition, requiresAdjudicatorReview:true, autoRejected:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the filter is sourced and self-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  A screen is trustworthy only if the reported bit array is the EXACT array produced by inserting the submitted
 *  processed ids with the submitted (bitSize, hashCount) — reproduced bit-for-bit — the reported setBitCount
 *  equal to the number of 1-bits, each result's queried id one of the submitted incoming ids (all covered, none
 *  fabricated), each result's verdict consistent with the array (possibly-duplicate iff ALL k bits are set), the
 *  tallies matching, and the disposition following. A fabricated bit, a mis-tallied count, or a verdict that
 *  contradicts the array corrupts the screen. filterSourced() verifies it; the Agent Fabric enforces it via
 *  policy.dupscreen.filter-sourced. It does NOT re-derive the membership independently — that is the exactness
 *  gate's job — so the two are isolable. (The sourced + self-consistency gate — mirrors the Contact Rate Limit
 *  Agent's replay-sourced and the Referral Throughput Agent's flow-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the membership is exact — NO false negatives.
 * ─────────────────────────────────────────────────────────────────────
 *  Re-building the Bloom filter from the submitted processed ids + config and re-querying every incoming id must
 *  reproduce the reported verdict for each — and, load-bearingly, NO FALSE NEGATIVE: any incoming id that IS one
 *  of the processed ids must be reported possibly-duplicate (never definitely-new), and the estimated false-
 *  positive rate must equal the standard (1 − e^(−k·n/m))^k for the submitted m, k, n. A screen that reports a
 *  known-duplicate as definitely-new would let a duplicate claim through — the one failure a Bloom filter must
 *  never make. membershipExact() re-derives all of this INDEPENDENT of the reported bit array, so a fabricated
 *  array that still reports the right verdicts fails filter-sourced only, and a real-array-but-mislabeled verdict
 *  fails exactness only — the two gates are isolable. The Agent Fabric enforces it via policy.dupscreen.membership
 *  -exact. (The load-bearing correctness gate — mirrors the Contact Rate Limit Agent's throttle-exact and the
 *  Referral Throughput Agent's throughput-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous rejection.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent PRE-SCREENS on paper — a possibly-duplicate is a ROUTING SIGNAL to the authoritative exact check,
 *  NEVER a denial; it never rejects, denies, or pays a claim on its own (each is an adjudication action that must
 *  be authorized), and every screen is a RECOMMENDATION requiring a claims adjudicator to confirm.
 *  noAutonomousReject() reports the honest signal the Agent Fabric enforces via policy.dupscreen.no-autonomous-
 *  reject. (Mirrors the Contact Rate Limit Agent's no-autonomous-send and the Referral Throughput Agent's
 *  no-autonomous-route — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A screen — all-clear or possible-duplicates — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresAdjudicatorReview:true, autoRejected:false). A possible-duplicates disposition is NOT a governance
 *  block — it is the honest finding that some incoming ids need the authoritative check (surfacing which is the
 *  whole point). A GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (a fabricated / mis-
 *  tallied filter, a false-negative verdict, or an autonomous rejection) — which the Agent Fabric rejects before
 *  it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified claims-dedup / payment-integrity system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real duplicate-claim detection weighs the full claim key (member, provider, DOS, procedure, units), adjustment
 *  / void logic, and an authoritative claims store — not a bare Bloom pre-screen over illustrative ids. This
 *  screens the supplied illustrative ids only, and its "possibly-duplicate" ALWAYS defers to an exact check. TIME
 *  IS DATA: the ids + config are plain data and the filter is a pure function of them (a fixed, seeded hash — no
 *  clock, no randomness), so the same request always yields the same determination, which is what lets the demo,
 *  the seeded trace, and the tests agree. The ids are a clearly-labeled ILLUSTRATIVE synthetic. Claim ids are
 *  PHI-adjacent, so a determination is treated as PHI-bearing and the agent is on the HIPAA audit path.
 */

/** A request: the Bloom config + the processed ids to insert + the incoming ids to screen. */
export type DuplicateScreenRequest = {
  batchRef: string;
  /** Bit-array size m (number of bits). */
  bitSize: number;
  /** Number of hash functions k. */
  hashCount: number;
  /** Already-processed claim ids to insert into the filter. */
  processedIds: string[];
  /** Incoming claim ids to screen. */
  incomingIds: string[];
};

export type DuplicateScreenDisposition = "all-clear" | "possible-duplicates";

/** One screened incoming id + its verdict. */
export type ScreenResult = {
  id: string;
  verdict: "definitely-new" | "possibly-duplicate";
};

/** The deterministic finding the agent returns. */
export type DuplicateScreenDetermination = {
  batchRef: string;
  bitSize: number;
  hashCount: number;
  /** The submitted processed ids, echoed so the guards can recompute. */
  processedIds: string[];
  /** The submitted incoming ids, echoed so the guards can recompute. */
  incomingIds: string[];
  /** The Bloom filter bit array (0/1), length bitSize. */
  bits: number[];
  /** Number of set (1) bits. */
  setBitCount: number;
  /** Per-incoming-id verdicts, in submitted order. */
  results: ScreenResult[];
  possibleDuplicateCount: number;
  definitelyNewCount: number;
  /** Estimated false-positive rate (1 - e^(-k*n/m))^k, rounded to 6 dp. */
  estimatedFalsePositiveRate: number;
  processedCount: number;
  incomingCount: number;
  disposition: DuplicateScreenDisposition;
  /** Always true — a claims adjudicator confirms every screen. */
  requiresAdjudicatorReview: true;
  /** Always false — the agent never autonomously rejects a claim. */
  autoRejected: false;
  reason: string;
  synthetic: true;
  note: string;
};

/**
 * A fixed, seeded string hash (FNV-1a 32-bit) — deterministic, no randomness. The k Bloom hash slots are derived
 * by double hashing: slot_i = (h1 + i*h2) mod m, a standard technique that yields k independent-enough indices
 * from two base hashes. Pure.
 */
function fnv1a(str: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** The k bit indices an id maps to, via double hashing, all in [0, m). Deterministic. */
export function bloomSlots(id: string, bitSize: number, hashCount: number): number[] {
  const m = Math.max(1, Math.floor(bitSize));
  const k = Math.max(1, Math.floor(hashCount));
  const h1 = fnv1a(id, 0);
  const h2 = fnv1a(id, 0x9e3779b9) | 1; // odd, so successive offsets don't immediately collide
  const slots: number[] = [];
  for (let i = 0; i < k; i++) {
    // Double hashing: slot_i = (h1 + i*h2) mod m. Math.imul keeps the product in 32-bit range; the extra
    // (+ m) % m guards against any negative intermediate so the index is always in [0, m).
    slots.push(((((h1 >>> 0) + Math.imul(i, h2)) >>> 0) % m + m) % m);
  }
  return slots;
}

/** Build the Bloom bit array by inserting every processed id. Pure; a function of ids + config. */
export function buildBloomBits(request: DuplicateScreenRequest): number[] {
  const m = Math.max(1, Math.floor(request.bitSize));
  const k = Math.max(1, Math.floor(request.hashCount));
  const bits = new Array<number>(m).fill(0);
  for (const id of Array.isArray(request.processedIds) ? request.processedIds : []) {
    for (const slot of bloomSlots(id, m, k)) bits[slot] = 1;
  }
  return bits;
}

/** Query the filter: possibly-duplicate iff ALL k bits are set; definitely-new if any bit is 0. */
export function bloomQuery(id: string, bits: number[], hashCount: number): ScreenResult["verdict"] {
  const m = bits.length;
  const k = Math.max(1, Math.floor(hashCount));
  for (const slot of bloomSlots(id, m, k)) {
    if (bits[slot] !== 1) return "definitely-new";
  }
  return "possibly-duplicate";
}

/** The standard Bloom false-positive rate estimate (1 - e^(-k*n/m))^k, rounded to 6 dp. */
export function estimateFalsePositiveRate(bitSize: number, hashCount: number, insertedCount: number): number {
  const m = Math.max(1, Math.floor(bitSize));
  const k = Math.max(1, Math.floor(hashCount));
  const n = Math.max(0, Math.floor(insertedCount));
  const rate = Math.pow(1 - Math.exp((-k * n) / m), k);
  return Math.round(rate * 1e6) / 1e6;
}

/**
 * The deterministic pre-screen function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own ids + config (seeded hash, no clock, no randomness). It builds the filter, screens each incoming
 * id, tallies the verdicts, estimates the false-positive rate, and derives the disposition. Nothing is rejected —
 * the screen is handed to a claims adjudicator.
 */
export function evaluateDuplicateScreen(request: DuplicateScreenRequest): DuplicateScreenDetermination {
  const bitSize = Math.max(1, Math.floor(request.bitSize));
  const hashCount = Math.max(1, Math.floor(request.hashCount));
  const processedIds = Array.isArray(request.processedIds) ? request.processedIds : [];
  const incomingIds = Array.isArray(request.incomingIds) ? request.incomingIds : [];

  const bits = buildBloomBits({ ...request, bitSize, hashCount, processedIds });
  const setBitCount = bits.reduce((s, b) => s + b, 0);
  const results: ScreenResult[] = incomingIds.map((id) => ({
    id,
    verdict: bloomQuery(id, bits, hashCount)
  }));
  const possibleDuplicateCount = results.filter((r) => r.verdict === "possibly-duplicate").length;
  const definitelyNewCount = results.length - possibleDuplicateCount;
  // Estimate over the number of DISTINCT inserted ids (n), which is what the formula assumes.
  const distinctProcessed = new Set(processedIds).size;
  const estimatedFalsePositiveRate = estimateFalsePositiveRate(bitSize, hashCount, distinctProcessed);
  const disposition: DuplicateScreenDisposition =
    possibleDuplicateCount === 0 ? "all-clear" : "possible-duplicates";

  const reason =
    disposition === "all-clear"
      ? `All ${incomingIds.length} incoming claim id(s) in ${request.batchRef} are definitely new — none match the ${distinctProcessed} processed id(s) in the Bloom pre-screen.`
      : `${possibleDuplicateCount} of ${incomingIds.length} incoming claim id(s) in ${request.batchRef} are possible duplicates (route to the authoritative check); ${definitelyNewCount} are definitely new. Estimated false-positive rate ${estimatedFalsePositiveRate}.`;

  return {
    batchRef: request.batchRef,
    bitSize,
    hashCount,
    processedIds,
    incomingIds,
    bits,
    setBitCount,
    results,
    possibleDuplicateCount,
    definitelyNewCount,
    estimatedFalsePositiveRate,
    processedCount: processedIds.length,
    incomingCount: incomingIds.length,
    disposition,
    requiresAdjudicatorReview: true,
    autoRejected: false,
    reason,
    synthetic: true,
    note:
      `Bloom pre-screen ${request.batchRef}: ${disposition.toUpperCase()} — ` +
      `${possibleDuplicateCount} possible-duplicate / ${definitelyNewCount} definitely-new of ${incomingIds.length} incoming ` +
      `(m=${bitSize}, k=${hashCount}, n=${distinctProcessed}, est. FP ${estimatedFalsePositiveRate}) via BLOOM-FILTER MEMBERSHIP. ` +
      "A Bloom filter has NO false negatives — a definitely-new id was provably never processed — and a possibly-duplicate ALWAYS defers to the authoritative exact check, never a denial. Real duplicate-claim detection weighs the full claim key (member, provider, DOS, procedure, units), adjustment / void logic, and an authoritative claims store — not a bare Bloom pre-screen over illustrative ids. Synthetic/illustrative ids — NOT a certified claims-dedup / payment-integrity system. The agent never rejects, denies, or pays a claim on its own — a claims adjudicator confirms every screen. Claim ids are PHI-adjacent, so a determination is on the HIPAA audit path."
  };
}

/**
 * Sourced + self-consistency check: is the reported bit array the EXACT array produced by inserting the submitted
 * processed ids with the submitted config, the setBitCount honest, each result's id one of the submitted incoming
 * ids (all covered, in order, none fabricated), each verdict consistent with the REPORTED array (possibly-
 * duplicate iff all k bits set), the tallies matching, and the disposition following? Catches a fabricated bit, a
 * mis-tallied count, or a verdict that contradicts the array. Does NOT independently re-derive membership from
 * the submitted ids (that is the exactness gate's job — this checks internal consistency against the reported
 * array), so the two are isolable. Anything evaluateDuplicateScreen() produces satisfies it. This is the honest
 * signal the screen reports to policy.dupscreen.filter-sourced. A non-object / malformed input is a violation.
 */
export function filterSourced(
  decision:
    | {
        bitSize?: unknown;
        hashCount?: unknown;
        processedIds?: unknown;
        incomingIds?: unknown;
        bits?: unknown;
        setBitCount?: unknown;
        results?: unknown;
        possibleDuplicateCount?: unknown;
        definitelyNewCount?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const bits = Array.isArray(decision.bits) ? (decision.bits as number[]) : null;
  const processedIds = Array.isArray(decision.processedIds) ? (decision.processedIds as string[]) : null;
  const incomingIds = Array.isArray(decision.incomingIds) ? (decision.incomingIds as string[]) : null;
  const results = Array.isArray(decision.results) ? (decision.results as ScreenResult[]) : null;
  if (!bits || !processedIds || !incomingIds || !results) return false;
  if (typeof decision.bitSize !== "number" || typeof decision.hashCount !== "number") return false;
  const m = Math.max(1, Math.floor(decision.bitSize));
  const k = Math.max(1, Math.floor(decision.hashCount));
  if (bits.length !== m) return false;
  for (const b of bits) if (b !== 0 && b !== 1) return false;
  for (const id of processedIds) if (typeof id !== "string") return false;
  for (const id of incomingIds) if (typeof id !== "string") return false;

  // The reported bits must equal the exact insert of the processed ids.
  const rebuilt = buildBloomBits({ batchRef: "", bitSize: m, hashCount: k, processedIds, incomingIds: [] });
  for (let i = 0; i < m; i++) if (bits[i] !== rebuilt[i]) return false;

  const setBitCount = bits.reduce((s, b) => s + b, 0);
  if (decision.setBitCount !== undefined && decision.setBitCount !== setBitCount) return false;

  // Results must cover exactly the incoming ids, in order, each verdict consistent with the REPORTED array.
  if (results.length !== incomingIds.length) return false;
  let possible = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r || typeof r.id !== "string" || r.id !== incomingIds[i]) return false;
    if (r.verdict !== "definitely-new" && r.verdict !== "possibly-duplicate") return false;
    const consistent = bloomQuery(r.id, bits, k);
    if (r.verdict !== consistent) return false; // verdict contradicts the reported array
    if (r.verdict === "possibly-duplicate") possible++;
  }
  const definitelyNew = results.length - possible;
  if (decision.possibleDuplicateCount !== undefined && decision.possibleDuplicateCount !== possible) return false;
  if (decision.definitelyNewCount !== undefined && decision.definitelyNewCount !== definitelyNew) return false;

  const expectedDisposition: DuplicateScreenDisposition = possible === 0 ? "all-clear" : "possible-duplicates";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * Exactness check: re-building the Bloom filter from the submitted processed ids + config and re-querying every
 * incoming id must reproduce the reported verdict for each — and, load-bearingly, NO FALSE NEGATIVE: any incoming
 * id that IS one of the processed ids must be reported possibly-duplicate (never definitely-new). The estimated
 * false-positive rate must equal the standard formula for the submitted m, k, and distinct-n. True only when the
 * recompute agrees. The load-bearing correctness gate — it re-derives the membership INDEPENDENT of the reported
 * bit array, so a fabricated array that still reports the right verdicts fails filter-sourced only while a
 * mislabeled verdict (especially a false negative) fails here. Anything evaluateDuplicateScreen() produces
 * satisfies it. A non-object input is a violation.
 */
export function membershipExact(
  decision:
    | {
        batchRef?: unknown;
        bitSize?: unknown;
        hashCount?: unknown;
        processedIds?: unknown;
        incomingIds?: unknown;
        results?: unknown;
        estimatedFalsePositiveRate?: unknown;
        // membershipExact re-derives membership from the ids and ignores the
        // reported bit array, but callers legitimately pass the full
        // DuplicateScreenDetermination (which carries bits/setBitCount), so the
        // param type tolerates those extra fields.
        bits?: unknown;
        setBitCount?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const processedIds = Array.isArray(decision.processedIds) ? (decision.processedIds as string[]) : null;
  const incomingIds = Array.isArray(decision.incomingIds) ? (decision.incomingIds as string[]) : null;
  const results = Array.isArray(decision.results) ? (decision.results as ScreenResult[]) : null;
  if (!processedIds || !incomingIds || !results) return false;
  if (typeof decision.bitSize !== "number" || typeof decision.hashCount !== "number") return false;
  for (const id of processedIds) if (typeof id !== "string") return false;
  for (const id of incomingIds) if (typeof id !== "string") return false;
  if (results.length !== incomingIds.length) return false;

  const m = Math.max(1, Math.floor(decision.bitSize));
  const k = Math.max(1, Math.floor(decision.hashCount));
  const bits = buildBloomBits({ batchRef: "", bitSize: m, hashCount: k, processedIds, incomingIds: [] });
  const processedSet = new Set(processedIds);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r || typeof r.id !== "string" || r.id !== incomingIds[i]) return false;
    const expected = bloomQuery(r.id, bits, k);
    if (r.verdict !== expected) return false;
    // The one-sided guarantee: a known member must NEVER be reported definitely-new (no false negative).
    if (processedSet.has(r.id) && r.verdict === "definitely-new") return false;
  }

  const distinctProcessed = new Set(processedIds).size;
  const expectedRate = estimateFalsePositiveRate(m, k, distinctProcessed);
  if (
    decision.estimatedFalsePositiveRate !== undefined &&
    decision.estimatedFalsePositiveRate !== expectedRate
  ) {
    return false;
  }
  return true;
}

/**
 * No-autonomous-rejection check: did the agent avoid rejecting / denying on its own? True unless the
 * determination reports it auto-rejected a claim (autoRejected:true) or does not require adjudicator review
 * (requiresAdjudicatorReview:false). Anything evaluateDuplicateScreen() produces satisfies it. This is the honest
 * signal the screen reports to policy.dupscreen.no-autonomous-reject. A non-object input is a violation.
 */
export function noAutonomousReject(
  decision: { autoRejected?: boolean; requiresAdjudicatorReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoRejected === true) return false;
  if (decision.requiresAdjudicatorReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a screen. */
export function duplicateScreenSummary(decision: DuplicateScreenDetermination): {
  batchRef: string;
  disposition: DuplicateScreenDisposition;
  processedCount: number;
  incomingCount: number;
  possibleDuplicateCount: number;
  definitelyNewCount: number;
  setBitCount: number;
  estimatedFalsePositiveRate: number;
  requiresAdjudicatorReview: boolean;
  synthetic: boolean;
} {
  return {
    batchRef: decision.batchRef,
    disposition: decision.disposition,
    processedCount: decision.processedCount,
    incomingCount: decision.incomingCount,
    possibleDuplicateCount: decision.possibleDuplicateCount,
    definitelyNewCount: decision.definitelyNewCount,
    setBitCount: decision.setBitCount,
    estimatedFalsePositiveRate: decision.estimatedFalsePositiveRate,
    requiresAdjudicatorReview: decision.requiresAdjudicatorReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: 6 processed claim ids inserted into a 64-bit filter with 3 hashes, then 5
 * incoming ids screened — three are re-submissions of processed ids (possible-duplicate, and provably so: no
 * false negatives), two are genuinely new. "Possible-duplicates." Synthetic; PHI-adjacent (claim ids).
 */
export const DEMO_DUPLICATE_SCREEN_REQUEST: DuplicateScreenRequest = {
  batchRef: "claims-batch-2026-09-1180",
  bitSize: 64,
  hashCount: 3,
  processedIds: [
    "CLM-88001",
    "CLM-88002",
    "CLM-88003",
    "CLM-88004",
    "CLM-88005",
    "CLM-88006"
  ],
  incomingIds: ["CLM-88002", "CLM-90010", "CLM-88005", "CLM-90011", "CLM-88001"]
};

/**
 * A representative demo request where every incoming id is genuinely new — none was processed, so all are
 * definitely-new. "All-clear." Synthetic.
 */
export const DEMO_DUPLICATE_SCREEN_CLEAR_REQUEST: DuplicateScreenRequest = {
  batchRef: "claims-batch-2026-09-1181",
  bitSize: 128,
  hashCount: 4,
  processedIds: ["CLM-70001", "CLM-70002", "CLM-70003"],
  incomingIds: ["CLM-99001", "CLM-99002"]
};

/**
 * A representative demo request with a deliberately-undersized filter (few bits, many inserts) so the estimated
 * false-positive rate is high — illustrating the space/accuracy trade-off. "Possible-duplicates." Synthetic.
 */
export const DEMO_DUPLICATE_SCREEN_SATURATED_REQUEST: DuplicateScreenRequest = {
  batchRef: "claims-batch-2026-09-1182",
  bitSize: 16,
  hashCount: 3,
  processedIds: ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"],
  incomingIds: ["Z9", "A3"]
};
