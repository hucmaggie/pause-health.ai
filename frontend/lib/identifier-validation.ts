/**
 * Provider Identifier (NPI) Validation & Integrity — the deterministic, transparent data-substrate layer
 * that takes a batch of National Provider Identifiers and validates each one with the CMS check-digit
 * algorithm (the Luhn / mod-10 checksum computed over the "80840" prefix + the 9-digit base), classifying
 * each as valid / invalid-format / invalid-checksum and flagging the invalid ones for a data steward;
 * never autonomously REJECTING a claim, REMOVING a provider from the directory, or CORRECTING a number.
 *
 * Deterministic, dependency-free domain core the Identifier Validation agent
 * (app/api/agents/identifier-validation) wraps — a data-substrate integrity service on the platform plane
 * of Pause's Agent Fabric. UNLIKE the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the
 * Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the Claim Lifecycle agent's FSM TRANSITION
 * VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's
 * GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's
 * SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care Pathway agent's
 * TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share
 * agent's SEQUENTIAL dollar waterfall, the DDI agent's PAIRWISE KNOWLEDGE-BASE LOOKUP, the OIG Exclusion
 * agent's EXACT identity MATCHING, or the Audit Log Integrity agent's HASH CHAIN — the heart of this
 * service is a MODULAR-ARITHMETIC CHECKSUM: the Luhn (mod-10) check-digit computation that the NPI
 * standard uses. An NPI with a transposed or mistyped digit fails the checksum; catching it before it
 * lands on a claim or in a provider directory prevents a claim rejection or a ghost-directory entry, so
 * this service verifies the check digit deterministically and hands the invalid ones to a human.
 *
 *   Inbound:  an IdentifierValidationRequest { batchRef, identifiers[] }
 *   Outbound: an IdentifierValidationDetermination { disposition, results[], total, validCount,
 *             invalidFormatCount, invalidChecksumCount, identifiers[], requiresStewardReview:true,
 *             autoRejected:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other provider-data agents: distinct from the Provider
 * Credentialing agent (which cites an npi-registry as a verification SOURCE but does not validate the
 * check digit) and the OIG Exclusion agent (which MATCHES an NPI as an identifier against the sanctions
 * list): this validates that the NPI itself is well-formed and its check digit is correct.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every result is sourced and the batch is complete.
 * ─────────────────────────────────────────────────────────────────────
 *  A validation run is trustworthy only if it reports exactly what was submitted: one result per submitted
 *  identifier, each result's NPI equal to the submitted one (no fabricated result, no dropped identifier),
 *  and the reported counts adding up to the batch size with the batch disposition following. A dropped or
 *  invented identifier silently mis-states the integrity of the batch. identifiersSourced() verifies it;
 *  the Agent Fabric enforces it via policy.identifier.identifiers-sourced. (The sourced + completeness gate
 *  — mirrors the Household Composition Agent's links-sourced and the Enrollment Reconciliation Agent's
 *  reconciliation-complete.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the checksum is recomputed correctly.
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing each identifier's format classification and Luhn check digit from the NPI itself must
 *  reproduce the reported disposition, expected check digit, and per-kind counts. A miscomputed checksum
 *  waves through a mistyped NPI (a claim rejection waiting to happen) or fails a correct one. The whole
 *  point is the arithmetic. checksumConsistent() recomputes it end-to-end; the Agent Fabric enforces it via
 *  policy.identifier.checksum-consistent. (The load-bearing correctness gate — mirrors the Provider
 *  Benchmarking Agent's stats-consistent and the OIG Exclusion Agent's match-not-overstated.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a claim / provider is never autonomously rejected.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent VALIDATES and FLAGS — it never REJECTS the claim, REMOVES the provider from the directory, or
 *  CORRECTS the number (each is a consequential action that must be authorized); every finding is a
 *  RECOMMENDATION requiring a data steward to confirm. identifierNoAutonomousReject() reports the honest
 *  signal the Agent Fabric enforces via policy.identifier.no-autonomous-reject. (Mirrors the Provider
 *  Credentialing Agent's no-referral-to-expired-or-sanctioned and the Enrollment Reconciliation Agent's
 *  no-autonomous-change posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A finding — all-valid or invalids-flagged — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresStewardReview:true, autoRejected:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (one that fabricates / drops an identifier, miscomputes the checksum, or
 *  autonomously rejects) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified NPPES / registry lookup.
 * ─────────────────────────────────────────────────────────────────────
 *  This validates the NPI's STRUCTURE + CHECK DIGIT (the CMS Luhn algorithm) only — it does NOT confirm the
 *  NPI is ASSIGNED, ACTIVE, or belongs to a particular provider (that requires an NPPES / registry lookup).
 *  The identifiers below are clearly-labeled ILLUSTRATIVE synthetics. It is DELIBERATELY NOT PHI-BEARING —
 *  an NPI is a provider identifier, not a patient's health information — so, like the OIG Exclusion agent,
 *  it is NOT on the HIPAA-audit policy. TIME IS DATA: the finding is a pure function of the identifiers (no
 *  clock, no randomness), so the same batch always yields the same result, which is what lets the demo, the
 *  seeded trace, and the tests agree.
 */

/** A submitted identifier (an NPI, with an optional provider label). */
export type IdentifierRecord = {
  /** The National Provider Identifier to validate. */
  npi: string;
  /** An optional human label for the provider. */
  providerLabel?: string;
};

/** An identifier-validation request. */
export type IdentifierValidationRequest = {
  /** Synthetic batch reference. */
  batchRef: string;
  /** The identifiers to validate. */
  identifiers: IdentifierRecord[];
};

/** The disposition of a single identifier. */
export type IdentifierDisposition = "valid" | "invalid-format" | "invalid-checksum";

/** The per-identifier result. */
export type IdentifierResult = {
  /** The NPI as submitted. */
  npi: string;
  /** The optional provider label, echoed. */
  providerLabel?: string;
  /** The disposition. */
  disposition: IdentifierDisposition;
  /** The Luhn check digit the algorithm expects (null when the format is invalid). */
  expectedCheckDigit: number | null;
  /** The 10th digit as submitted (null when the format is invalid). */
  actualCheckDigit: number | null;
  /** Human-readable reason. */
  reason: string;
};

/** The disposition of a validation batch. */
export type IdentifierValidationDisposition = "all-valid" | "invalids-flagged";

/** The deterministic finding the agent returns. */
export type IdentifierValidationDetermination = {
  batchRef: string;
  /** The submitted identifiers, echoed so the sourced guard can check correspondence. */
  identifiers: IdentifierRecord[];
  /** One result per submitted identifier, in order. */
  results: IdentifierResult[];
  /** The number of identifiers. */
  total: number;
  /** The number of valid identifiers. */
  validCount: number;
  /** The number of format-invalid identifiers. */
  invalidFormatCount: number;
  /** The number of checksum-invalid identifiers. */
  invalidChecksumCount: number;
  /** The batch disposition. */
  disposition: IdentifierValidationDisposition;
  /** Always true — a data steward confirms every finding. */
  requiresStewardReview: true;
  /** Always false — the agent never autonomously rejects a claim / provider. */
  autoRejected: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the identifiers are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** The NPI's ISO issuer prefix used by the CMS check-digit algorithm. */
export const NPI_PREFIX = "80840";

/** True when a string is exactly 10 characters, all decimal digits. */
function isTenDigits(npi: string): boolean {
  if (typeof npi !== "string" || npi.length !== 10) return false;
  for (let i = 0; i < npi.length; i++) {
    const c = npi.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/**
 * Compute the NPI Luhn (mod-10) check digit over the "80840" prefix + the 9-digit base. Shared by the
 * engine + the consistency guard so they compute identically. `base` must be 9 decimal digits.
 */
export function npiCheckDigit(base: string): number {
  const payload = NPI_PREFIX + base;
  let sum = 0;
  let doubleIt = true; // the rightmost payload digit is doubled
  for (let i = payload.length - 1; i >= 0; i--) {
    let d = payload.charCodeAt(i) - 48;
    if (doubleIt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    doubleIt = !doubleIt;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Validate a single NPI. Format rule: exactly 10 decimal digits with a leading 1 or 2 (the NPPES-assigned
 * range). If the format is invalid, expected/actual check digits are null. Otherwise the Luhn check digit
 * is computed over the first 9 digits and compared to the 10th. Pure + deterministic.
 */
export function validateNpi(record: IdentifierRecord): IdentifierResult {
  const npi = typeof record?.npi === "string" ? record.npi : "";
  const base = { npi, providerLabel: record?.providerLabel };

  if (!isTenDigits(npi) || (npi[0] !== "1" && npi[0] !== "2")) {
    return {
      ...base,
      disposition: "invalid-format",
      expectedCheckDigit: null,
      actualCheckDigit: null,
      reason: `"${npi}" is not a well-formed NPI (must be 10 digits beginning with 1 or 2).`
    };
  }

  const expected = npiCheckDigit(npi.slice(0, 9));
  const actual = npi.charCodeAt(9) - 48;
  if (expected === actual) {
    return {
      ...base,
      disposition: "valid",
      expectedCheckDigit: expected,
      actualCheckDigit: actual,
      reason: `"${npi}" is a well-formed NPI with a valid Luhn check digit (${expected}).`
    };
  }
  return {
    ...base,
    disposition: "invalid-checksum",
    expectedCheckDigit: expected,
    actualCheckDigit: actual,
    reason: `"${npi}" has an invalid check digit — expected ${expected}, found ${actual} (a likely transposition / typo).`
  };
}

/** Derive the batch disposition from the per-kind counts. */
function batchDisposition(
  invalidFormatCount: number,
  invalidChecksumCount: number
): IdentifierValidationDisposition {
  return invalidFormatCount === 0 && invalidChecksumCount === 0 ? "all-valid" : "invalids-flagged";
}

/**
 * The deterministic validation function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own identifiers (no randomness, no clock). It validates every identifier with the Luhn
 * check-digit algorithm, tallies the per-kind counts, and derives the batch disposition (all-valid /
 * invalids-flagged). Nothing is rejected — the finding is handed to a data steward.
 */
export function evaluateIdentifierValidation(
  request: IdentifierValidationRequest
): IdentifierValidationDetermination {
  const identifiers = (Array.isArray(request.identifiers) ? request.identifiers : []).map((r) => ({
    npi: typeof r?.npi === "string" ? r.npi : "",
    ...(r?.providerLabel !== undefined ? { providerLabel: r.providerLabel } : {})
  }));
  const results = identifiers.map((r) => validateNpi(r));
  const total = results.length;
  const validCount = results.filter((r) => r.disposition === "valid").length;
  const invalidFormatCount = results.filter((r) => r.disposition === "invalid-format").length;
  const invalidChecksumCount = results.filter((r) => r.disposition === "invalid-checksum").length;
  const disposition = batchDisposition(invalidFormatCount, invalidChecksumCount);

  const reason =
    disposition === "all-valid"
      ? `All ${total} NPI(s) are well-formed with valid check digits.`
      : `${invalidFormatCount + invalidChecksumCount} of ${total} NPI(s) failed validation (${invalidFormatCount} format, ${invalidChecksumCount} checksum) — flagged for steward review.`;

  return {
    batchRef: request.batchRef,
    identifiers,
    results,
    total,
    validCount,
    invalidFormatCount,
    invalidChecksumCount,
    disposition,
    requiresStewardReview: true,
    autoRejected: false,
    reason,
    synthetic: true,
    note:
      `Identifier validation ${request.batchRef}: ${disposition.toUpperCase()} — ${validCount} valid, ${invalidFormatCount} invalid-format, ${invalidChecksumCount} invalid-checksum of ${total}.` +
      " Validates the NPI's STRUCTURE + Luhn check digit (CMS mod-10 over the 80840 prefix) only — does NOT confirm the NPI is assigned / active / belongs to a provider (that needs an NPPES lookup). NOT PHI-bearing — an NPI is a provider identifier, not patient health information. Synthetic/illustrative identifiers — NOT a certified registry lookup. The agent never rejects a claim, removes a provider, or corrects a number on its own — a data steward confirms every finding."
  };
}

/**
 * Identifiers-sourced + completeness check: does the run report exactly what was submitted? True only when
 * there is one result per submitted identifier (same order, same NPI), the reported total equals the
 * identifier count, the per-kind counts sum to the total, and the batch disposition follows from the
 * reported counts. Catches a fabricated result or a dropped identifier. Anything
 * evaluateIdentifierValidation() produces satisfies it. This is the honest signal the route reports to
 * policy.identifier.identifiers-sourced. A non-object / malformed input is a violation.
 */
export function identifiersSourced(
  decision:
    | {
        identifiers?: unknown;
        results?: unknown;
        total?: unknown;
        validCount?: unknown;
        invalidFormatCount?: unknown;
        invalidChecksumCount?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const identifiers = Array.isArray(decision.identifiers) ? decision.identifiers : null;
  const results = Array.isArray(decision.results) ? decision.results : null;
  if (!identifiers || !results) return false;
  if (results.length !== identifiers.length) return false;
  for (let i = 0; i < identifiers.length; i++) {
    const id = identifiers[i] as IdentifierRecord;
    const r = results[i] as IdentifierResult;
    if (!id || !r || typeof id.npi !== "string" || typeof r.npi !== "string") return false;
    if (id.npi !== r.npi) return false;
  }
  if (decision.total !== results.length) return false;
  const vc = decision.validCount;
  const fc = decision.invalidFormatCount;
  const cc = decision.invalidChecksumCount;
  if (typeof vc !== "number" || typeof fc !== "number" || typeof cc !== "number") return false;
  if (vc + fc + cc !== results.length) return false;
  if (decision.disposition !== batchDisposition(fc, cc)) return false;
  return true;
}

/**
 * Checksum-consistent check: recomputing each identifier's format classification + Luhn check digit from
 * the NPI must reproduce the reported disposition, expected check digit, and per-kind counts. True only
 * when they all match. Catches a miscomputed checksum (a mistyped NPI waved through, or a correct one
 * failed). The load-bearing correctness gate — it recomputes each result from its own NPI and does NOT
 * check the identifiers↔results correspondence (that is the sourced check's job), so it is independent of
 * it. Anything evaluateIdentifierValidation() produces satisfies it. A non-object input is a violation.
 */
export function checksumConsistent(
  decision:
    | {
        results?: unknown;
        validCount?: unknown;
        invalidFormatCount?: unknown;
        invalidChecksumCount?: unknown;
        total?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const results = Array.isArray(decision.results) ? decision.results : null;
  if (!results) return false;

  let vc = 0;
  let fc = 0;
  let cc = 0;
  for (const r of results) {
    const row = r as IdentifierResult;
    if (!row || typeof row.npi !== "string") return false;
    const expected = validateNpi({ npi: row.npi, providerLabel: row.providerLabel });
    if (row.disposition !== expected.disposition) return false;
    if ((row.expectedCheckDigit ?? null) !== expected.expectedCheckDigit) return false;
    if ((row.actualCheckDigit ?? null) !== expected.actualCheckDigit) return false;
    if (expected.disposition === "valid") vc++;
    else if (expected.disposition === "invalid-format") fc++;
    else cc++;
  }
  if (decision.total !== results.length) return false;
  if (decision.validCount !== vc) return false;
  if (decision.invalidFormatCount !== fc) return false;
  if (decision.invalidChecksumCount !== cc) return false;
  return true;
}

/**
 * No-autonomous-reject check: did the agent avoid autonomously rejecting a claim / removing a provider /
 * correcting a number? True unless the determination reports it auto-rejected (autoRejected:true) or does
 * not require steward review (requiresStewardReview:false). Anything evaluateIdentifierValidation()
 * produces satisfies it. This is the honest signal the route reports to
 * policy.identifier.no-autonomous-reject. A non-object input is a violation.
 */
export function identifierNoAutonomousReject(
  decision:
    | { autoRejected?: boolean; requiresStewardReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoRejected === true) return false;
  if (decision.requiresStewardReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a finding — the shape stamped onto the Agent Fabric trace + the
 * response `meta`.
 */
export function identifierValidationSummary(decision: IdentifierValidationDetermination): {
  batchRef: string;
  disposition: IdentifierValidationDisposition;
  total: number;
  validCount: number;
  invalidFormatCount: number;
  invalidChecksumCount: number;
  requiresStewardReview: boolean;
  synthetic: boolean;
} {
  return {
    batchRef: decision.batchRef,
    disposition: decision.disposition,
    total: decision.total,
    validCount: decision.validCount,
    invalidFormatCount: decision.invalidFormatCount,
    invalidChecksumCount: decision.invalidChecksumCount,
    requiresStewardReview: decision.requiresStewardReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a batch with one valid NPI, one checksum-invalid (a transposed digit),
 * and one format-invalid identifier. Synthetic.
 */
export const DEMO_IDENTIFIER_VALIDATION_REQUEST: IdentifierValidationRequest = {
  batchRef: "npi-batch-001",
  identifiers: [
    { npi: "1234567893", providerLabel: "Dr. Alice Valid" },
    { npi: "1234567890", providerLabel: "Dr. Bob Transposed" },
    { npi: "99999", providerLabel: "Dr. Carol Malformed" }
  ]
};

/** A representative demo request: a batch of three valid NPIs. Synthetic. */
export const DEMO_IDENTIFIER_VALIDATION_ALL_VALID_REQUEST: IdentifierValidationRequest = {
  batchRef: "npi-batch-002",
  identifiers: [
    { npi: "1234567893", providerLabel: "Dr. Alice" },
    { npi: "1987654328", providerLabel: "Dr. Dan" },
    { npi: "2345678900", providerLabel: "Dr. Erin" }
  ]
};

/** A representative demo request: a single malformed NPI (leading digit out of range). Synthetic. */
export const DEMO_IDENTIFIER_VALIDATION_FORMAT_REQUEST: IdentifierValidationRequest = {
  batchRef: "npi-batch-003",
  identifiers: [{ npi: "3234567893", providerLabel: "Dr. Frank Out-of-range" }]
};
