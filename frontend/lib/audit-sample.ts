/**
 * Audit Sample Selection / Reservoir Sampling (Algorithm R, Seeded) — the deterministic, transparent
 * payer-operations layer that, given a large STREAM of record ids (claims / charts flagged for a compliance
 * audit) and a target sample size k plus an explicit SEED, draws a statistically-defensible k-record SAMPLE in a
 * SINGLE PASS — every record in the population having an equal k/n chance of selection — WITHOUT ever opening,
 * adjudicating, or acting on a single sampled record on its own. A compliance auditor runs the audit.
 *
 * Deterministic, dependency-free domain core the Audit Sample agent (app/api/agents/audit-sample) wraps — a
 * compliance-sampling agent on the PHI-bearing payer & plan operations plane of Pause's Agent Fabric. CRUCIALLY,
 * the heart of this service is RESERVOIR SAMPLING (Vitter's Algorithm R): fill a reservoir with the first k
 * items, then for each subsequent item at 0-indexed position i, draw a random integer j in [0, i]; if j < k,
 * replace reservoir[j] with the item. After one pass over a stream of unknown / unbounded length, every item has
 * been retained with uniform probability k/n — without ever holding the whole population in memory. The
 * randomness is a SEEDED PRNG (mulberry32), so the "random" sample is fully REPRODUCIBLE: the same stream + k +
 * seed always yields the same sample — which is exactly what makes an audit sample DEFENSIBLE (an auditor, or a
 * regulator, can re-run it and get the identical records). This is a genuinely NEW computation pattern for the
 * fabric: it is NOT the Duplicate-Claim Screen agent's BLOOM FILTER (a membership test, not a uniform draw), NOT
 * the Outreach Prioritization agent's 0/1 KNAPSACK (a value-maximizing subset, not an equal-probability sample),
 * NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, NOT the Provider Benchmarking agent's
 * PERCENTILE / RANK STATISTICS, NOT the Contact Rate Limit agent's TOKEN BUCKET, and NOT the Enrollment
 * Reconciliation agent's KEYED SET-DIFFERENCE — it is single-pass uniform reservoir sampling. The uniform
 * inclusion probability and the reproducibility of the seeded draw are the invariants this service reports and
 * defends.
 *
 *   Inbound:  an AuditSampleRequest { auditRef, sampleSize, seed, recordIds[] }
 *   Outbound: an AuditSampleDetermination { sample[], populationSize, sampleSize, effectiveSampleSize,
 *             inclusionProbability, seed, disposition, requiresAuditorReview:true, autoAudited:false, reason,
 *             synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the sample is sourced and self-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  A sample is trustworthy only if it is a REAL subset of the submitted stream: every selected id must appear in
 *  the submitted recordIds (no fabricated id), no id may be selected twice, the sample size must equal
 *  min(k, populationSize), the reported populationSize must equal the stream length, the inclusionProbability
 *  must equal effectiveSampleSize / populationSize, and the disposition must follow (full-population iff
 *  populationSize ≤ k). A fabricated id, a duplicate pick, or a mis-sized sample corrupts the draw.
 *  sampleSourced() verifies it; the Agent Fabric enforces it via policy.auditsample.sample-sourced. It does NOT
 *  re-run the seeded draw — that is the reproducibility gate's job — so the two are isolable. (The sourced +
 *  self-consistency gate — mirrors the Duplicate-Claim Screen Agent's filter-sourced and the Contact Rate Limit
 *  Agent's replay-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the selection is reproducible (the seeded Algorithm R re-runs).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running the seeded reservoir sampling over the submitted stream + (sampleSize, seed) must reproduce the
 *  EXACT sample — same ids, same order. A sample that cannot be reproduced from its own seed is not a defensible
 *  audit sample (an auditor could not stand behind it, and a "cherry-picked" set could hide behind a
 *  random-looking label). selectionReproducible() re-runs Algorithm R INDEPENDENT of the reported sample and
 *  compares, so a fabricated-but-in-population sample fails reproducibility while a real seeded draw with a
 *  fabricated id fails sourced — the two gates are isolable. The Agent Fabric enforces it via
 *  policy.auditsample.selection-reproducible. (The load-bearing correctness gate — mirrors the Duplicate-Claim
 *  Screen Agent's membership-exact and the Contact Rate Limit Agent's throttle-exact.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous audit action.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent SELECTS on paper — it never opens, adjudicates, flags, or acts on a sampled record on its own (each
 *  is an audit action that must be authorized); every sample is a RECOMMENDATION of WHICH records to pull,
 *  requiring a compliance auditor to run the actual audit. noAutonomousAudit() reports the honest signal the
 *  Agent Fabric enforces via policy.auditsample.no-autonomous-audit. (Mirrors the Duplicate-Claim Screen Agent's
 *  no-autonomous-reject and the Contact Rate Limit Agent's no-autonomous-send — the harmful action is
 *  enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A sample — sampled or full-population — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresAuditorReview:true, autoAudited:false). A full-population disposition is NOT a governance block — it is
 *  the honest finding that the population is at most k, so the "sample" is the whole set (nothing to draw). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (a fabricated / mis-sized sample, an
 *  unreproducible draw, or an autonomous audit action) — which the Agent Fabric rejects before it can leave the
 *  fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified statistical-sampling / audit system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real audit sampling weighs stratification, RAT-STATS / OIG sampling methodology, confidence intervals, and
 *  dollar-unit / probability-proportional-to-size designs — not a bare uniform reservoir over illustrative ids.
 *  This samples the supplied illustrative ids only. TIME IS DATA: the ids + k + seed are plain data and the draw
 *  is a pure function of them (a seeded PRNG — no real clock, no OS randomness), so the same request always
 *  yields the same sample, which is what lets the demo, the seeded trace, and the tests agree. The ids are a
 *  clearly-labeled ILLUSTRATIVE synthetic. The record ids are PHI-adjacent, so a determination is treated as
 *  PHI-bearing and the agent is on the HIPAA audit path.
 */

/** A request: the audit reference, the target sample size k, a seed, and the record-id stream. */
export type AuditSampleRequest = {
  auditRef: string;
  /** Target sample size k. */
  sampleSize: number;
  /** Deterministic seed — so the "random" sample is reproducible / defensible. */
  seed: number;
  /** The population of record ids to sample from. */
  recordIds: string[];
};

export type AuditSampleDisposition = "sampled" | "full-population";

/** The deterministic finding the agent returns. */
export type AuditSampleDetermination = {
  auditRef: string;
  /** The submitted record ids, echoed so the guards can recompute. */
  recordIds: string[];
  /** Target sample size requested. */
  sampleSize: number;
  /** The reproducible seed. */
  seed: number;
  /** The selected record ids (the reservoir), in reservoir order. */
  sample: string[];
  /** Population size n (stream length). */
  populationSize: number;
  /** min(k, n) — the actual number selected. */
  effectiveSampleSize: number;
  /** Uniform per-record inclusion probability, effectiveSampleSize / populationSize, rounded to 6 dp. */
  inclusionProbability: number;
  disposition: AuditSampleDisposition;
  /** Always true — a compliance auditor runs the audit. */
  requiresAuditorReview: true;
  /** Always false — the agent never autonomously audits a sampled record. */
  autoAudited: false;
  reason: string;
  synthetic: true;
  note: string;
};

/**
 * A tiny seeded PRNG (mulberry32) — deterministic, no OS randomness. Given the same seed it emits the same
 * sequence of floats in [0, 1), which is what makes the reservoir draw reproducible. Returns a generator
 * function.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic integer in [0, bound] (inclusive) from the PRNG. bound ≥ 0. */
function randIntInclusive(rng: () => number, bound: number): number {
  return Math.floor(rng() * (bound + 1));
}

/**
 * RESERVOIR SAMPLING — Vitter's Algorithm R, seeded. Fill the reservoir with the first k ids, then for each
 * subsequent id at 0-indexed position i, draw j in [0, i]; if j < k, replace reservoir[j]. Returns the reservoir
 * (the selected ids, in reservoir order). If n ≤ k the whole stream is returned (order preserved). Pure — a
 * function of the ids + k + seed.
 */
export function reservoirSample(recordIds: string[], sampleSize: number, seed: number): string[] {
  const ids = Array.isArray(recordIds) ? recordIds : [];
  const k = Math.max(0, Math.floor(sampleSize));
  if (k === 0) return [];
  if (ids.length <= k) return ids.slice();

  const rng = mulberry32(seed);
  const reservoir = ids.slice(0, k);
  for (let i = k; i < ids.length; i++) {
    const j = randIntInclusive(rng, i); // j in [0, i]
    if (j < k) reservoir[j] = ids[i];
  }
  return reservoir;
}

/** Round to 6 dp so inclusion-probability comparisons are stable. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * The deterministic sampling function — the heart of the service. DETERMINISTIC: a pure function of the request's
 * own ids + k + seed (seeded PRNG, no clock, no OS randomness). It runs the reservoir draw, computes the
 * population / effective sizes and the uniform inclusion probability, and derives the disposition. Nothing is
 * audited — the sample is handed to a compliance auditor.
 */
export function evaluateAuditSample(request: AuditSampleRequest): AuditSampleDetermination {
  const recordIds = Array.isArray(request.recordIds) ? request.recordIds : [];
  const sampleSize = Math.max(0, Math.floor(request.sampleSize));
  const seed = Math.floor(request.seed) >>> 0;
  const populationSize = recordIds.length;
  const sample = reservoirSample(recordIds, sampleSize, seed);
  const effectiveSampleSize = sample.length;
  const inclusionProbability =
    populationSize === 0 ? 0 : round6(effectiveSampleSize / populationSize);
  const disposition: AuditSampleDisposition =
    populationSize <= sampleSize ? "full-population" : "sampled";

  const reason =
    disposition === "full-population"
      ? `Population of ${populationSize} record(s) for ${request.auditRef} is at most the sample size ${sampleSize} — the whole population is selected (nothing to sample).`
      : `Selected a reproducible ${effectiveSampleSize}-record sample from ${populationSize} record(s) for ${request.auditRef} (seed ${seed}); each record had an equal ${inclusionProbability} inclusion probability.`;

  return {
    auditRef: request.auditRef,
    recordIds,
    sampleSize,
    seed,
    sample,
    populationSize,
    effectiveSampleSize,
    inclusionProbability,
    disposition,
    requiresAuditorReview: true,
    autoAudited: false,
    reason,
    synthetic: true,
    note:
      `Reservoir sample ${request.auditRef}: ${disposition.toUpperCase()} — ` +
      `${effectiveSampleSize} of ${populationSize} record(s) selected (k=${sampleSize}, seed=${seed}, ` +
      `p=${inclusionProbability}) via RESERVOIR SAMPLING (Algorithm R, seeded). ` +
      "The seeded draw is REPRODUCIBLE — the same stream + k + seed always yields the same sample, which is what makes an audit sample defensible. Real audit sampling weighs stratification, RAT-STATS / OIG methodology, confidence intervals, and dollar-unit / probability-proportional-to-size designs — not a bare uniform reservoir over illustrative ids. Synthetic/illustrative ids — NOT a certified statistical-sampling / audit system. The agent never opens, adjudicates, or acts on a sampled record on its own — a compliance auditor runs the audit. Record ids are PHI-adjacent, so a determination is on the HIPAA audit path."
  };
}

/**
 * Sourced + self-consistency check: is the reported sample a REAL subset of the submitted stream? Every selected
 * id must appear in the submitted recordIds (no fabricated id), no id selected twice, the sample size equal to
 * min(sampleSize, populationSize), the reported populationSize equal to the stream length, the
 * inclusionProbability equal to effectiveSampleSize / populationSize, and the disposition following. Catches a
 * fabricated id, a duplicate pick, or a mis-sized sample. Does NOT re-run the seeded draw (that is the
 * reproducibility gate's job), so it is independent of it. Anything evaluateAuditSample() produces satisfies it.
 * This is the honest signal the sample reports to policy.auditsample.sample-sourced. A non-object / malformed
 * input is a violation.
 */
export function sampleSourced(
  decision:
    | {
        recordIds?: unknown;
        sampleSize?: unknown;
        sample?: unknown;
        populationSize?: unknown;
        effectiveSampleSize?: unknown;
        inclusionProbability?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const recordIds = Array.isArray(decision.recordIds) ? (decision.recordIds as string[]) : null;
  const sample = Array.isArray(decision.sample) ? (decision.sample as string[]) : null;
  if (!recordIds || !sample) return false;
  for (const id of recordIds) if (typeof id !== "string") return false;
  for (const id of sample) if (typeof id !== "string") return false;
  if (typeof decision.sampleSize !== "number") return false;

  const k = Math.max(0, Math.floor(decision.sampleSize));
  const populationSize = recordIds.length;
  if (decision.populationSize !== undefined && decision.populationSize !== populationSize) return false;

  const expectedSize = Math.min(k, populationSize);
  if (sample.length !== expectedSize) return false;

  // Every selected id must be in the population, and no id may be picked more times than it appears in the
  // stream. Algorithm R stores VALUES in distinct reservoir slots, so we validate by multiset membership:
  // consume one occurrence of the population per selected id.
  const remaining = new Map<string, number>();
  for (const id of recordIds) remaining.set(id, (remaining.get(id) ?? 0) + 1);
  for (const id of sample) {
    const count = remaining.get(id) ?? 0;
    if (count <= 0) return false; // fabricated id or selected more times than it appears
    remaining.set(id, count - 1);
  }

  if (decision.effectiveSampleSize !== undefined && decision.effectiveSampleSize !== sample.length) {
    return false;
  }
  const expectedProb = populationSize === 0 ? 0 : round6(sample.length / populationSize);
  if (
    decision.inclusionProbability !== undefined &&
    round6(decision.inclusionProbability as number) !== expectedProb
  ) {
    return false;
  }
  const expectedDisposition: AuditSampleDisposition =
    populationSize <= k ? "full-population" : "sampled";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * Reproducibility check: re-running the seeded reservoir sampling over the submitted stream + (sampleSize, seed)
 * must reproduce the EXACT sample — same ids, same order. True only when the recompute agrees. Catches a
 * cherry-picked or otherwise non-reproducible sample masquerading as a random draw. The load-bearing correctness
 * gate — it re-runs Algorithm R INDEPENDENT of the reported sample, so a fabricated-but-in-population sample
 * fails here while a real seeded draw with a fabricated id fails sourced — the two gates are isolable. Anything
 * evaluateAuditSample() produces satisfies it. A non-object input is a violation.
 */
export function selectionReproducible(
  decision:
    | { recordIds?: unknown; sampleSize?: unknown; seed?: unknown; sample?: unknown }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const recordIds = Array.isArray(decision.recordIds) ? (decision.recordIds as string[]) : null;
  const sample = Array.isArray(decision.sample) ? (decision.sample as string[]) : null;
  if (!recordIds || !sample) return false;
  for (const id of recordIds) if (typeof id !== "string") return false;
  for (const id of sample) if (typeof id !== "string") return false;
  if (typeof decision.sampleSize !== "number" || typeof decision.seed !== "number") return false;

  const expected = reservoirSample(
    recordIds,
    Math.max(0, Math.floor(decision.sampleSize)),
    Math.floor(decision.seed) >>> 0
  );
  if (sample.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (sample[i] !== expected[i]) return false;
  }
  return true;
}

/**
 * No-autonomous-audit check: did the agent avoid auditing / acting on its own? True unless the determination
 * reports it auto-audited records (autoAudited:true) or does not require auditor review (requiresAuditorReview:
 * false). Anything evaluateAuditSample() produces satisfies it. This is the honest signal the sample reports to
 * policy.auditsample.no-autonomous-audit. A non-object input is a violation.
 */
export function noAutonomousAudit(
  decision: { autoAudited?: boolean; requiresAuditorReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoAudited === true) return false;
  if (decision.requiresAuditorReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a sample. */
export function auditSampleSummary(decision: AuditSampleDetermination): {
  auditRef: string;
  disposition: AuditSampleDisposition;
  populationSize: number;
  sampleSize: number;
  effectiveSampleSize: number;
  inclusionProbability: number;
  seed: number;
  requiresAuditorReview: boolean;
  synthetic: boolean;
} {
  return {
    auditRef: decision.auditRef,
    disposition: decision.disposition,
    populationSize: decision.populationSize,
    sampleSize: decision.sampleSize,
    effectiveSampleSize: decision.effectiveSampleSize,
    inclusionProbability: decision.inclusionProbability,
    seed: decision.seed,
    requiresAuditorReview: decision.requiresAuditorReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a population of 20 claim ids, sampling 5 with a fixed seed for an SIU audit
 * pull. "Sampled" — each record has a 0.25 inclusion probability. Synthetic; PHI-adjacent (claim ids).
 */
export const DEMO_AUDIT_SAMPLE_REQUEST: AuditSampleRequest = {
  auditRef: "siu-audit-2026-Q3-4402",
  sampleSize: 5,
  seed: 20260913,
  recordIds: Array.from({ length: 20 }, (_, i) => `CLM-4${(4200 + i).toString()}`)
};

/**
 * A representative demo request where the population (4) is smaller than the requested sample (10) — the whole
 * population is selected. "Full-population." Synthetic.
 */
export const DEMO_AUDIT_SAMPLE_FULL_REQUEST: AuditSampleRequest = {
  auditRef: "chart-audit-2026-Q3-88",
  sampleSize: 10,
  seed: 7,
  recordIds: ["CHART-1", "CHART-2", "CHART-3", "CHART-4"]
};

/**
 * A representative demo request with a different seed over the same-shaped population — a different reproducible
 * sample, illustrating that the seed (not chance) determines the draw. "Sampled." Synthetic.
 */
export const DEMO_AUDIT_SAMPLE_RESEED_REQUEST: AuditSampleRequest = {
  auditRef: "siu-audit-2026-Q3-4402-reseed",
  sampleSize: 5,
  seed: 42,
  recordIds: Array.from({ length: 20 }, (_, i) => `CLM-4${(4200 + i).toString()}`)
};
