/**
 * OIG Exclusion / Sanctions Screening — the deterministic, transparent payment-integrity layer that
 * screens a party (a provider, a vendor, an employee) against the OIG List of Excluded Individuals /
 * Entities (LEIE) BEFORE a health plan pays or contracts with them, computing a HONEST match strength
 * from explicit identifier signals — never OVERSTATING a name coincidence into a confirmed exclusion,
 * and never autonomously blocking a payment or clearing a party.
 *
 * Deterministic, dependency-free domain core the Exclusion Screening Agent
 * (app/api/agents/exclusion-screening) wraps — a claims / payer-operations service on the payer & plan
 * operations plane of Pause's Agent Fabric. Federal law (Social Security Act §1128 / §1128A(a)(6);
 * 42 CFR §1001) prohibits payment by a federal health-care program for items or services furnished,
 * ordered, or prescribed by an OIG-EXCLUDED party — so plans and providers must SCREEN parties against
 * the LEIE (and SAM.gov debarment) before payment / contracting. Given a screening request (a party
 * reference and the party's identifiers — last name, first name, and optionally an NPI and a date of
 * birth), it DETERMINISTICALLY matches the party against the recorded exclusion list and reports a
 * match STRENGTH grounded in which identifiers actually matched.
 *
 *   Inbound:  a ScreeningRequest { partyRef, lastName, firstName, npi?, dob? }
 *   Outbound: a ScreeningDetermination { matchStrength, matchedExclusionId, exclusionType,
 *             npiMatch, nameMatch, dobMatch, disposition, requiresComplianceReview:true,
 *             autoBlockedPayment:false, autoCleared:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other agents: distinct from the Provider Credentialing
 * agent (whether a provider is QUALIFIED — license, board certification, education), the Claims
 * Adjudication agent (the allowed amount), and the FWA agent (suspected fraud on a claim): this
 * screens a party's IDENTITY against the OIG exclusion list to prevent an improper PAYMENT to a
 * sanctioned party — an integrity screen, not a qualification review.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: a reported match traces to a recorded exclusion record.
 * ─────────────────────────────────────────────────────────────────────
 *  A match (anything other than no-match) must cite a matchedExclusionId that resolves in the recorded
 *  LEIE catalog — a match asserted without a sourced exclusion record is not a lawful basis to hold a
 *  payment. exclusionMatchSourced() reports the honest signal the Agent Fabric enforces via
 *  policy.exclusion.match-record-sourced. (Mirrors the Right of Access Agent's ground-sourced and the
 *  Subrogation Agent's basis-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the match strength is never overstated.
 * ─────────────────────────────────────────────────────────────────────
 *  The reported match strength must not exceed what the identifier signals support — a confirmed match
 *  requires an NPI match OR (a full-name match AND a date-of-birth match); a name-only coincidence must
 *  never be reported as confirmed. Overstating a match is how a LEGITIMATE provider's payment is
 *  wrongly held on a shared name. exclusionMatchNotOverstated() recomputes the maximum supportable
 *  strength from the determination's own signals and verifies the reported strength does not exceed it;
 *  it reports the honest signal the Agent Fabric enforces via policy.exclusion.match-not-overstated.
 *  (The load-bearing correctness gate — mirrors the Member Cost-Share Agent's math-consistent and the
 *  Subrogation Agent's recoverable-within-paid posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a payment is never autonomously blocked, and a party is never
 *  autonomously cleared.
 * ─────────────────────────────────────────────────────────────────────
 *  The screening is a RECOMMENDATION — the agent never autonomously blocks a payment (which denies a
 *  legitimate provider income) or clears a party (which risks paying a sanctioned party); a compliance
 *  officer confirms the identity and acts. exclusionNoAutonomousBlockOrClear() reports the honest
 *  signal the Agent Fabric enforces via policy.exclusion.no-autonomous-block-or-clear. (Mirrors the
 *  Advance Beneficiary Notice Agent's no-autonomous-beneficiary-liability and the Member Cost-Share
 *  Agent's no-autonomous-member-charge posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  NOT PHI-BEARING.
 * ─────────────────────────────────────────────────────────────────────
 *  Screening a PROVIDER / vendor's identity against a public exclusion list is a payment-integrity
 *  control — it does NOT touch a patient's health information, so this agent is deliberately NOT on the
 *  HIPAA-audit policy (phiAccessed:false throughout). The party's name / DOB are provider PII, handled
 *  under the payer's vendor-screening controls, not PHI.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — match or no-match — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresComplianceReview:true, autoBlockedPayment:false, autoCleared:false). A GOVERNANCE BLOCK is
 *  when a caller PRESENTS an offending DETERMINATION (a match with no sourced exclusion record, an
 *  overstated match strength, or an autonomously-blocked / -cleared party) — which the Agent Fabric
 *  rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified exclusion-screening system.
 * ─────────────────────────────────────────────────────────────────────
 *  The exclusion catalog + the match rules below are clearly-labeled ILLUSTRATIVE synthetics chosen to
 *  model the SHAPE of LEIE screening deterministically in the demo — they are NOT a complete
 *  implementation (no fuzzy / phonetic matching, no monthly LEIE reload, no SAM.gov / state Medicaid
 *  exclusion lists, no reinstatement handling). Real screening is governed by the OIG LEIE, the OIG
 *  Special Advisory Bulletin on the effect of exclusion, and the payer's screening policy. There is NO
 *  randomness and NO clock anywhere here: the match is a pure function of the request's own fields + the
 *  catalog, so the same party always yields the same match strength — which is what lets the demo, the
 *  seeded trace, and the tests agree.
 */

/** A recorded OIG-exclusion record (a catalog entry a match must trace to). */
export type ExclusionRecord = {
  /** Stable record id. */
  id: string;
  /** Excluded party's last name (screened case-insensitively). */
  lastName: string;
  /** Excluded party's first name. */
  firstName: string;
  /** The excluded party's NPI, when the LEIE record carries one. */
  npi?: string;
  /** The excluded party's date of birth (YYYY-MM-DD), when known. */
  dob?: string;
  /** The statutory exclusion authority / basis. */
  exclusionType: string;
  /** The date the exclusion took effect (YYYY-MM-DD). */
  exclusionDate: string;
};

/**
 * ILLUSTRATIVE, synthetic LEIE-style exclusion catalog — clearly labeled, NOT the real OIG list.
 * A reported match must trace to one of these records.
 */
export const EXCLUSION_RECORDS: ExclusionRecord[] = [
  {
    id: "leie-1001",
    lastName: "Harmon",
    firstName: "Gregory",
    npi: "1902884736",
    dob: "1968-03-14",
    exclusionType: "1128(a)(1) — conviction of a program-related crime",
    exclusionDate: "2021-06-01"
  },
  {
    id: "leie-1002",
    lastName: "Delgado",
    firstName: "Maria",
    dob: "1975-11-02",
    exclusionType: "1128(a)(3) — felony health-care fraud conviction",
    exclusionDate: "2022-09-15"
  },
  {
    id: "leie-1003",
    lastName: "Novak",
    firstName: "Peter",
    npi: "1730214558",
    exclusionType: "1128(b)(4) — license revocation / suspension",
    exclusionDate: "2020-02-20"
  }
];

/** Look up an exclusion record by id (undefined when off-catalog). */
export function getExclusionRecord(id: string): ExclusionRecord | undefined {
  return EXCLUSION_RECORDS.find((r) => r.id === id);
}

/** A party-screening request. */
export type ScreeningRequest = {
  /** Synthetic party reference (a provider / vendor / employee). */
  partyRef: string;
  /** The party's last name. */
  lastName: string;
  /** The party's first name. */
  firstName: string;
  /** The party's NPI, when available (the strongest identifier). */
  npi?: string;
  /** The party's date of birth (YYYY-MM-DD), when available. */
  dob?: string;
};

/**
 * The screening match strength, in ascending order of confidence:
 *   - "no-match" — no candidate on the exclusion list.
 *   - "possible" — a last-name candidate, but the first name or DOB doesn't corroborate (likely a
 *     different person — a name coincidence).
 *   - "probable" — a full-name match with no DOB / NPI available to confirm or refute.
 *   - "confirmed" — an NPI match, or a full-name AND date-of-birth match.
 */
export type MatchStrength = "no-match" | "possible" | "probable" | "confirmed";

/** The screening disposition (a recommendation — never an autonomous action). */
export type ScreeningDisposition =
  | "recommend-clear"
  | "recommend-review-possible"
  | "recommend-review-probable"
  | "recommend-block-pending-review";

/** The deterministic screening determination the agent returns. */
export type ScreeningDetermination = {
  partyRef: string;
  /** The strongest match found against the catalog. */
  matchStrength: MatchStrength;
  /** The matched exclusion record id (null on no-match). */
  matchedExclusionId: string | null;
  /** The statutory exclusion authority of the matched record (null on no-match). */
  exclusionType: string | null;
  /** Whether the NPI matched (null when either side lacks an NPI). */
  npiMatch: boolean | null;
  /** Whether the full name (last + first) matched. */
  nameMatch: boolean;
  /** Whether the DOB matched (null when either side lacks a DOB). */
  dobMatch: boolean | null;
  /** The recommended disposition. */
  disposition: ScreeningDisposition;
  /** Always true — a compliance officer confirms identity and acts. */
  requiresComplianceReview: true;
  /** Always false — the agent never autonomously blocks a payment. */
  autoBlockedPayment: false;
  /** Always false — the agent never autonomously clears a party. */
  autoCleared: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the catalog + match rules are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Case-insensitive, trimmed string compare. */
function eq(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The maximum match strength supportable by a set of identifier signals — the single source of truth
 * both evaluateScreening() (to assign strength) and exclusionMatchNotOverstated() (to bound the
 * reported strength) rely on, so the guard and the engine can never disagree.
 */
export function supportableStrength(signals: {
  npiMatch: boolean | null;
  nameMatch: boolean;
  dobMatch: boolean | null;
}): MatchStrength {
  if (signals.npiMatch === true) return "confirmed";
  if (signals.nameMatch && signals.dobMatch === true) return "confirmed";
  if (signals.nameMatch && (signals.dobMatch === null || signals.dobMatch === undefined)) {
    return "probable";
  }
  // A last-name candidate that the first name or DOB doesn't corroborate.
  return "possible";
}

const STRENGTH_RANK: Record<MatchStrength, number> = {
  "no-match": 0,
  possible: 1,
  probable: 2,
  confirmed: 3
};

function dispositionFor(strength: MatchStrength): ScreeningDisposition {
  switch (strength) {
    case "confirmed":
      return "recommend-block-pending-review";
    case "probable":
      return "recommend-review-probable";
    case "possible":
      return "recommend-review-possible";
    case "no-match":
    default:
      return "recommend-clear";
  }
}

/**
 * The deterministic screening function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own fields + the catalog (no randomness, no clock). It finds the strongest-matching
 * exclusion record and reports a match strength grounded in which identifiers actually matched.
 * Nothing is blocked or cleared here — the determination is a recommendation a compliance officer acts
 * on.
 */
export function evaluateScreening(request: ScreeningRequest): ScreeningDetermination {
  // Candidates share a last name (the LEIE's coarse first pass).
  const candidates = EXCLUSION_RECORDS.filter((r) => eq(r.lastName, request.lastName));

  let best:
    | { record: ExclusionRecord; strength: MatchStrength; npiMatch: boolean | null; nameMatch: boolean; dobMatch: boolean | null }
    | undefined;

  for (const record of candidates) {
    const npiMatch =
      request.npi && record.npi ? eq(request.npi, record.npi) : null;
    const nameMatch = eq(record.lastName, request.lastName) && eq(record.firstName, request.firstName);
    const dobMatch =
      request.dob && record.dob ? eq(request.dob, record.dob) : null;
    const strength = supportableStrength({ npiMatch, nameMatch, dobMatch });
    if (!best || STRENGTH_RANK[strength] > STRENGTH_RANK[best.strength]) {
      best = { record, strength, npiMatch, nameMatch, dobMatch };
    }
  }

  if (!best) {
    return {
      partyRef: request.partyRef,
      matchStrength: "no-match",
      matchedExclusionId: null,
      exclusionType: null,
      npiMatch: null,
      nameMatch: false,
      dobMatch: null,
      disposition: "recommend-clear",
      requiresComplianceReview: true,
      autoBlockedPayment: false,
      autoCleared: false,
      reason: `No exclusion-list candidate for ${request.partyRef} (${request.firstName} ${request.lastName}). Recommend clear — pending compliance review.`,
      synthetic: true,
      note:
        `Exclusion screening for ${request.partyRef}: no LEIE candidate. NOT PHI-bearing — this screens a provider / vendor's identity against a public exclusion list, not a patient's health information. Synthetic/illustrative catalog + match rules (no fuzzy / phonetic matching, no SAM.gov / state lists) — NOT a certified exclusion-screening system; real screening is governed by the OIG LEIE and the payer's screening policy. The agent produces a RECOMMENDATION — it never blocks a payment or clears a party on its own.`
    };
  }

  const disposition = dispositionFor(best.strength);
  const reasonByStrength: Record<MatchStrength, string> = {
    confirmed: `${best.strength === "confirmed" ? "Confirmed" : ""} exclusion match for ${request.partyRef} (${best.record.exclusionType}, effective ${best.record.exclusionDate}) — recommend HOLD payment pending compliance confirmation of identity.`,
    probable: `Probable exclusion match for ${request.partyRef} (full-name match, no DOB / NPI to confirm) against ${best.record.exclusionType} — recommend compliance review before payment.`,
    possible: `Possible name coincidence for ${request.partyRef} (last-name candidate not corroborated by first name / DOB) against ${best.record.exclusionType} — recommend compliance review; likely a different person.`,
    "no-match": ""
  };

  return {
    partyRef: request.partyRef,
    matchStrength: best.strength,
    matchedExclusionId: best.record.id,
    exclusionType: best.record.exclusionType,
    npiMatch: best.npiMatch,
    nameMatch: best.nameMatch,
    dobMatch: best.dobMatch,
    disposition,
    requiresComplianceReview: true,
    autoBlockedPayment: false,
    autoCleared: false,
    reason: reasonByStrength[best.strength],
    synthetic: true,
    note:
      `Exclusion screening for ${request.partyRef}: ${best.strength} match to ${best.record.id} (${best.record.exclusionType}). NOT PHI-bearing — this screens a provider / vendor's identity against a public exclusion list, not a patient's health information. Synthetic/illustrative catalog + match rules (no fuzzy / phonetic matching, no SAM.gov / state lists) — NOT a certified exclusion-screening system; real screening is governed by the OIG LEIE, the OIG Special Advisory Bulletin on the effect of exclusion, and the payer's screening policy. The agent produces a RECOMMENDATION — it never blocks a payment or clears a party on its own.`
  };
}

/**
 * Match-record-sourced check: does a reported match trace to a cataloged exclusion record? True when
 * the strength is no-match (and no record is cited), OR the cited matchedExclusionId resolves in the
 * catalog. The guard that catches a match asserted without a sourced exclusion record. Anything
 * evaluateScreening() produces satisfies it. This is the honest signal the route reports to
 * policy.exclusion.match-record-sourced. A non-object input is a violation.
 */
export function exclusionMatchSourced(
  decision:
    | { matchStrength?: MatchStrength; matchedExclusionId?: string | null }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.matchStrength === "no-match") {
    return decision.matchedExclusionId === null || decision.matchedExclusionId === undefined;
  }
  if (typeof decision.matchedExclusionId !== "string") return false;
  return getExclusionRecord(decision.matchedExclusionId) !== undefined;
}

/**
 * Match-not-overstated check: is the reported match strength supported by the identifier signals? True
 * unless the reported strength exceeds the maximum supportable strength (recomputed from npiMatch /
 * nameMatch / dobMatch); the guard that catches a name coincidence dressed up as a confirmed exclusion.
 * Anything evaluateScreening() produces satisfies it. This is the honest signal the route reports to
 * policy.exclusion.match-not-overstated. A non-object / malformed input is a violation.
 */
export function exclusionMatchNotOverstated(
  decision:
    | {
        matchStrength?: MatchStrength;
        npiMatch?: boolean | null;
        nameMatch?: boolean;
        dobMatch?: boolean | null;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.matchStrength === undefined) return false;
  if (decision.matchStrength === "no-match") return true;
  if (typeof decision.nameMatch !== "boolean") return false;
  const supportable = supportableStrength({
    npiMatch: decision.npiMatch ?? null,
    nameMatch: decision.nameMatch,
    dobMatch: decision.dobMatch ?? null
  });
  return STRENGTH_RANK[decision.matchStrength] <= STRENGTH_RANK[supportable];
}

/**
 * No-autonomous-block-or-clear check: did the agent avoid blocking a payment or clearing a party on its
 * own? True unless the determination reports it blocked a payment (autoBlockedPayment:true), cleared a
 * party (autoCleared:true), or does not require compliance review (requiresComplianceReview:false); the
 * guard that catches an autonomous payment block / clear. Anything evaluateScreening() produces
 * satisfies it. This is the honest signal the route reports to
 * policy.exclusion.no-autonomous-block-or-clear. A non-object input is a violation.
 */
export function exclusionNoAutonomousBlockOrClear(
  decision:
    | {
        autoBlockedPayment?: boolean;
        autoCleared?: boolean;
        requiresComplianceReview?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoBlockedPayment === true) return false;
  if (decision.autoCleared === true) return false;
  if (decision.requiresComplianceReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a determination. */
export function screeningSummary(decision: ScreeningDetermination): {
  partyRef: string;
  matchStrength: MatchStrength;
  matchedExclusionId: string | null;
  disposition: ScreeningDisposition;
  requiresComplianceReview: boolean;
  synthetic: boolean;
} {
  return {
    partyRef: decision.partyRef,
    matchStrength: decision.matchStrength,
    matchedExclusionId: decision.matchedExclusionId,
    disposition: decision.disposition,
    requiresComplianceReview: decision.requiresComplianceReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: an exact NPI hit on an excluded provider → a confirmed match. Synthetic.
 */
export const DEMO_SCREENING_REQUEST: ScreeningRequest = {
  partyRef: "provider-3391",
  lastName: "Harmon",
  firstName: "Gregory",
  npi: "1902884736",
  dob: "1968-03-14"
};

/**
 * A representative demo request: a shared last name whose first name / DOB don't corroborate → a
 * possible coincidence, not a confirmed exclusion. Synthetic.
 */
export const DEMO_SCREENING_COINCIDENCE_REQUEST: ScreeningRequest = {
  partyRef: "provider-7742",
  lastName: "Harmon",
  firstName: "Denise",
  dob: "1990-07-22"
};

/**
 * A representative demo request: a clean party with no exclusion-list candidate → no-match. Synthetic.
 */
export const DEMO_SCREENING_CLEAR_REQUEST: ScreeningRequest = {
  partyRef: "provider-5150",
  lastName: "Whitfield",
  firstName: "Alan",
  npi: "1548200194",
  dob: "1981-04-09"
};
