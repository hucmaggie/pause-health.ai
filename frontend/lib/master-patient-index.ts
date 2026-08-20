/**
 * Master Patient Index / Identity Resolution — the deterministic, transparent
 * identity/dedup layer of Pause's data substrate.
 *
 * Deterministic, dependency-free domain core the Master Patient Index / Identity
 * Resolution Agent (app/api/agents/master-patient-index) wraps — the MuleSoft
 * control-plane / data-substrate identity service on Pause's Agent Fabric. It
 * resolves a patient's identity across source systems: given an INCOMING patient
 * record plus a set of CANDIDATE records, it deterministically scores each
 * candidate against a TRANSPARENT weighted demographic feature set (name, DOB,
 * administrative sex, address, phone, member/MRN identifiers), classifies each as
 * match / possible-match / no-match by FIXED thresholds, and recommends a
 * resolution action (link / merge / manual-review / no-action).
 *
 *   Inbound:  an incoming PatientRecord (a synthetic, de-identified record) plus
 *             a set of candidate PatientRecords to resolve against
 *   Outbound: an IdentityResolution { candidates: scored[], bestMatch,
 *             recommendation, requiresHumanReview, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other platform-plane agents
 * (salesforce-data-360 grounding, consent-management, mulesoft-ingest): this one
 * is the identity/dedup layer that decides whether two records are the same
 * person, distinct from all of them.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: matching is TRANSPARENT, not a black box.
 * ─────────────────────────────────────────────────────────────────────
 *  Every match decision is a pure, additive/weighted function of a DEFINED set
 *  of demographic features (MATCH_FEATURES below — each with a documented
 *  weight), and every candidate's classification follows from its score by the
 *  FIXED MATCH_THRESHOLDS. There is no opaque / black-box matching.
 *  matchTracesToFeatures() reports the honest signal the Agent Fabric enforces
 *  via policy.mpi.transparent-matching.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: a merge below the auto threshold is NEVER
 *  autonomous — it requires a human steward.
 * ─────────────────────────────────────────────────────────────────────
 *  It is a RECOMMENDER + integrity gate: a high-confidence match at/above the
 *  auto-match threshold surfaces a link/merge recommendation, but a merge below
 *  that threshold must NOT be performed autonomously — it is a manual-review
 *  recommendation with requiresHumanReview:true. There is never an 'auto-merged'
 *  state, and the agent NEVER autonomously merges a low-confidence pair.
 *  mergeRequiresHumanReview() reports the honest signal the Agent Fabric enforces
 *  via policy.mpi.no-autonomous-merge.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: NO protected-class attributes in matching.
 * ─────────────────────────────────────────────────────────────────────
 *  The matching feature set must NOT use protected-class attributes (race,
 *  ethnicity, religion, national origin, gender identity, sexual orientation,
 *  disability status, marital status) as matching features — a fairness /
 *  responsible-AI property. None of MATCH_FEATURES is a protected-class
 *  attribute; excludesProtectedAttributesInMatching() reports the honest signal
 *  the Agent Fabric enforces via policy.mpi.no-protected-class-matching.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  MANUAL-REVIEW / POSSIBLE-MATCH vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A POSSIBLE-MATCH (a candidate that scores in the review band — above the
 *  no-match cutoff but below the auto-match threshold) is a SAFE, honest OUTPUT:
 *  the agent recommends manual-review with requiresHumanReview:true and the task
 *  COMPLETES — it is NOT a block. A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  opaque / off-spec match (a score that doesn't trace to the feature spec), a
 *  merge below the auto threshold marked as NOT requiring human review (an
 *  autonomous merge), or a matching feature set that includes a protected-class
 *  attribute — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified EMPI algorithm.
 * ─────────────────────────────────────────────────────────────────────
 *  The match features, their weights, and the thresholds below are ILLUSTRATIVE
 *  synthetic/demo values chosen to model the SHAPE of transparent, deterministic
 *  identity resolution — they are NOT a certified enterprise master-patient-index
 *  (EMPI) algorithm (real EMPIs — IBM Initiate, Verato, NextGate, the FHIR
 *  $match operation — use probabilistic / ML models, referential matching,
 *  blocking keys, and continuously-tuned weights). The patient records are
 *  synthetic/de-identified. There is NO randomness and NO clock anywhere here:
 *  the score is a pure function of the records the caller passes, so the same
 *  incoming + candidates always yield the same scores + classifications +
 *  recommendation (with a documented, stable tie-break) — which is what lets the
 *  demo, the seeded trace, and the tests agree.
 */

/** A candidate's classification against the incoming record, by fixed thresholds. */
export type MatchClassification = "match" | "possible-match" | "no-match";

/** The resolution action the agent recommends for the best candidate. */
export type ResolutionRecommendation = "link" | "merge" | "manual-review" | "no-action";

/**
 * A single documented matching feature in the transparent feature set. `weight`
 * is the points a matched feature contributes to a candidate's score; the score
 * is the sum of the matched features' weights (0..MAX_SCORE). Illustrative — not
 * a certified EMPI weight.
 */
export type MatchFeature = {
  /** Stable catalog id every matched feature references. */
  id: string;
  /** Human-readable feature label. */
  label: string;
  /** Points this feature contributes when it matches (its weight in the additive model). */
  weight: number;
  /**
   * The (illustrative) reason this demographic feature is in the match model.
   * NOT a certified rationale — a demo-honest description. Explicitly a
   * non-protected-class demographic identifier.
   */
  rationale: string;
};

/**
 * The transparent matching feature spec: the ONLY features that contribute to a
 * candidate's score. Additive/weighted — a candidate's score is the sum of each
 * matched feature's weight. Every feature is a demographic / administrative
 * identifier — deliberately NONE is a protected-class attribute (see the module
 * header). Illustrative/synthetic weights; NOT a certified EMPI algorithm.
 */
export const MATCH_FEATURES: MatchFeature[] = [
  {
    id: "feature.name",
    label: "Name (first + last)",
    weight: 30,
    rationale:
      "A normalized first + last name match is the primary demographic identifier. (Illustrative weight — not a certified EMPI algorithm.)"
  },
  {
    id: "feature.dob",
    label: "Date of birth",
    weight: 25,
    rationale:
      "An exact date-of-birth match is a strong, stable demographic identifier. (Illustrative weight — not a certified EMPI algorithm.)"
  },
  {
    id: "feature.identifier",
    label: "Member / MRN identifier",
    weight: 20,
    rationale:
      "A shared source identifier (medical record number or member id) is a strong deterministic-match signal. (Illustrative weight — not a certified EMPI algorithm.)"
  },
  {
    id: "feature.address",
    label: "Address (line + postal code)",
    weight: 12,
    rationale:
      "A normalized street address + postal-code match corroborates a demographic match. (Illustrative weight — not a certified EMPI algorithm.)"
  },
  {
    id: "feature.phone",
    label: "Phone number",
    weight: 8,
    rationale:
      "A normalized phone-number match corroborates a demographic match. (Illustrative weight — not a certified EMPI algorithm.)"
  },
  {
    id: "feature.administrative-sex",
    label: "Administrative sex",
    weight: 5,
    rationale:
      "Administrative sex (not gender identity) is a low-weight corroborating demographic field. (Illustrative weight — not a certified EMPI algorithm.)"
  }
];

/**
 * The fixed classification thresholds the model applies to a candidate's score.
 * Documented + stable: match at/above autoMatch, possible-match at/above
 * possibleMatch (and below autoMatch), no-match below possibleMatch. Illustrative
 * — not certified. (Max achievable score = sum of the weights = MAX_SCORE.)
 */
export const MATCH_THRESHOLDS: { autoMatch: number; possibleMatch: number } = {
  autoMatch: 85,
  possibleMatch: 55
};

/** The maximum achievable score (sum of every feature's weight). */
export const MAX_SCORE = MATCH_FEATURES.reduce((sum, f) => sum + f.weight, 0);

const FEATURE_BY_ID = new Map(MATCH_FEATURES.map((f) => [f.id, f]));

/** Is `id` a defined match-feature catalog id? */
export function isMatchFeature(id: unknown): boolean {
  return typeof id === "string" && FEATURE_BY_ID.has(id);
}

/** Look up a match feature by id (undefined for an off-catalog id). */
export function getMatchFeature(id: string): MatchFeature | undefined {
  return FEATURE_BY_ID.get(id);
}

/**
 * Protected-class attributes the matching feature set must NEVER use as a
 * matching feature (a responsible-AI / fairness property). If any of these
 * appears in the set of features the model claims to match on, the model is not
 * fairness-clean. (Distinct from population-health's factor list — this is the
 * identity-matching feature set.)
 */
export const PROTECTED_CLASS_ATTRIBUTES: string[] = [
  "attr.race",
  "attr.ethnicity",
  "attr.religion",
  "attr.national-origin",
  "attr.gender-identity",
  "attr.sexual-orientation",
  "attr.disability-status",
  "attr.marital-status"
];

const PROTECTED_CLASS_SET = new Set<string>(PROTECTED_CLASS_ATTRIBUTES);

/** Is `id` a protected-class attribute the match model may not match on? */
export function isProtectedClassAttribute(id: unknown): boolean {
  return typeof id === "string" && PROTECTED_CLASS_SET.has(id);
}

/**
 * A patient record from a source system. Only the demographic / administrative
 * fields below are ever used as matching features. `recordId` is a synthetic,
 * de-identified id. The protected-class fields (race / ethnicity) are carried
 * only to demonstrate that they are NEVER used as matching features — the
 * scorer ignores them entirely.
 */
export type PatientRecord = {
  /** Synthetic, de-identified record id (e.g. "mpi-candidate-001"). */
  recordId: string;
  /** Given name. */
  firstName?: string;
  /** Family name. */
  lastName?: string;
  /** Date of birth (ISO date, YYYY-MM-DD). */
  dob?: string;
  /** Administrative sex (NOT gender identity) — a low-weight corroborating field. */
  sex?: string;
  /** Street address line. */
  addressLine?: string;
  /** Postal / ZIP code. */
  postalCode?: string;
  /** Phone number (any format; normalized before comparison). */
  phone?: string;
  /** Medical record number. */
  mrn?: string;
  /** Health-plan member id. */
  memberId?: string;
  /**
   * Protected-class attributes — carried for demonstration only and NEVER used
   * as matching features (see the module header). The scorer ignores these.
   */
  race?: string;
  ethnicity?: string;
  /** Always true — the records are illustrative synthetics. */
  synthetic?: true;
};

/** A single matched feature stamped onto a scored candidate (catalog-sourced). */
export type MatchedFeatureRef = { id: string; label: string; weight: number };

/** A single candidate's deterministic match score against the incoming record. */
export type ScoredCandidate = {
  /** The candidate record's id this score is about. */
  candidateId: string;
  /** The additive score (sum of matchedFeatures' weights). */
  score: number;
  /** The features that matched (every classification is explainable by these). */
  matchedFeatures: MatchedFeatureRef[];
  /** The classification derived from the score by MATCH_THRESHOLDS. */
  classification: MatchClassification;
};

/** The deterministic identity resolution the agent returns. */
export type IdentityResolution = {
  /** Every candidate scored against the incoming record (score-descending, stable tie-break). */
  candidates: ScoredCandidate[];
  /** The highest-scoring candidate (undefined when there are no candidates). */
  bestMatch?: ScoredCandidate;
  /** The recommended resolution action for the best match. */
  recommendation: ResolutionRecommendation;
  /** True when a human steward must review before any merge/link is performed. */
  requiresHumanReview: boolean;
  /** Always true — the features + weights + thresholds + records are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Normalize a text value for comparison (trim + lowercase + collapse whitespace). */
function normText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Normalize a phone number to its trailing 10 digits (strip non-digits). */
function normPhone(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "").slice(-10);
}

/** Does the name feature match? (both records must carry a first + last name.) */
function nameMatches(a: PatientRecord, b: PatientRecord): boolean {
  const af = normText(a.firstName);
  const al = normText(a.lastName);
  const bf = normText(b.firstName);
  const bl = normText(b.lastName);
  if (!af || !al || !bf || !bl) return false;
  return af === bf && al === bl;
}

/** Does the date-of-birth feature match? (exact, both present.) */
function dobMatches(a: PatientRecord, b: PatientRecord): boolean {
  const ad = normText(a.dob);
  const bd = normText(b.dob);
  return ad.length > 0 && ad === bd;
}

/** Does the administrative-sex feature match? (both present.) */
function sexMatches(a: PatientRecord, b: PatientRecord): boolean {
  const as = normText(a.sex);
  const bs = normText(b.sex);
  return as.length > 0 && as === bs;
}

/** Does the address feature match? (line + postal code, both present.) */
function addressMatches(a: PatientRecord, b: PatientRecord): boolean {
  const aline = normText(a.addressLine);
  const bline = normText(b.addressLine);
  const azip = normText(a.postalCode);
  const bzip = normText(b.postalCode);
  if (!aline || !bline || !azip || !bzip) return false;
  return aline === bline && azip === bzip;
}

/** Does the phone feature match? (trailing 10 digits, both present.) */
function phoneMatches(a: PatientRecord, b: PatientRecord): boolean {
  const ap = normPhone(a.phone);
  const bp = normPhone(b.phone);
  return ap.length === 10 && ap === bp;
}

/** Does the identifier feature match? (a shared MRN or member id.) */
function identifierMatches(a: PatientRecord, b: PatientRecord): boolean {
  const amrn = normText(a.mrn);
  const bmrn = normText(b.mrn);
  if (amrn.length > 0 && amrn === bmrn) return true;
  const amem = normText(a.memberId);
  const bmem = normText(b.memberId);
  return amem.length > 0 && amem === bmem;
}

/** The feature-id → predicate map, iterated in MATCH_FEATURES (catalog) order. */
const FEATURE_PREDICATES: Record<string, (a: PatientRecord, b: PatientRecord) => boolean> = {
  "feature.name": nameMatches,
  "feature.dob": dobMatches,
  "feature.identifier": identifierMatches,
  "feature.address": addressMatches,
  "feature.phone": phoneMatches,
  "feature.administrative-sex": sexMatches
};

/** Classify a score by the fixed, documented thresholds. Deterministic. */
export function classifyScore(score: number): MatchClassification {
  if (score >= MATCH_THRESHOLDS.autoMatch) return "match";
  if (score >= MATCH_THRESHOLDS.possibleMatch) return "possible-match";
  return "no-match";
}

/**
 * Score a single candidate against the incoming record with the transparent
 * feature set. DETERMINISTIC: a pure, additive/weighted function of the two
 * records against MATCH_FEATURES — no randomness, no clock. Every matched
 * feature references a defined feature catalog id (a match is never
 * free-invented), and the classification is derived from the score by
 * MATCH_THRESHOLDS, so the result is fully explainable. Protected-class
 * attributes on either record are ignored entirely.
 */
export function scoreCandidate(
  incoming: PatientRecord,
  candidate: PatientRecord
): ScoredCandidate {
  const matchedFeatures: MatchedFeatureRef[] = [];
  for (const feature of MATCH_FEATURES) {
    const predicate = FEATURE_PREDICATES[feature.id];
    if (predicate && predicate(incoming, candidate)) {
      matchedFeatures.push({ id: feature.id, label: feature.label, weight: feature.weight });
    }
  }
  const score = matchedFeatures.reduce((sum, f) => sum + f.weight, 0);
  return {
    candidateId: candidate.recordId,
    score,
    matchedFeatures,
    classification: classifyScore(score)
  };
}

/**
 * Decide the recommendation for a best match. A match at/above the auto-match
 * threshold surfaces a link/merge recommendation (merge when a shared
 * identifier corroborates it, link otherwise); a possible-match (in the review
 * band) is a manual-review recommendation requiring a human steward; a no-match
 * (or no candidate) is no-action. There is NEVER an autonomous merge below the
 * auto threshold.
 */
function recommendationFor(bestMatch: ScoredCandidate | undefined): {
  recommendation: ResolutionRecommendation;
  requiresHumanReview: boolean;
} {
  if (!bestMatch || bestMatch.classification === "no-match") {
    return { recommendation: "no-action", requiresHumanReview: false };
  }
  if (bestMatch.classification === "possible-match") {
    // Below the auto-match threshold → a human steward must review before any merge.
    return { recommendation: "manual-review", requiresHumanReview: true };
  }
  // At/above the auto-match threshold: merge when a shared identifier corroborates
  // it, otherwise link (cross-reference) the high-confidence demographic match.
  const identifierMatched = bestMatch.matchedFeatures.some((f) => f.id === "feature.identifier");
  return {
    recommendation: identifierMatched ? "merge" : "link",
    requiresHumanReview: false
  };
}

/**
 * Resolve the incoming record's identity against a set of candidates.
 * DETERMINISTIC: scores each candidate with the transparent feature set, orders
 * them by score descending with a stable, documented tie-break on candidateId
 * ascending (lexical), classifies each by the fixed thresholds, and recommends a
 * resolution action for the best match. A pure function of the records (no
 * randomness, no clock), so the same incoming + candidates always yield the same
 * scores + recommendation. It NEVER autonomously merges a low-confidence pair —
 * a merge below the auto threshold is a manual-review recommendation with
 * requiresHumanReview:true, and there is never an 'auto-merged' state.
 */
export function resolveIdentity(
  incoming: PatientRecord,
  candidates: PatientRecord[]
): IdentityResolution {
  const scored = (Array.isArray(candidates) ? candidates : [])
    .map((c) => scoreCandidate(incoming, c))
    .sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId));

  const bestMatch = scored.length > 0 ? scored[0] : undefined;
  const { recommendation, requiresHumanReview } = recommendationFor(bestMatch);

  const bestDetail = bestMatch
    ? `best match ${bestMatch.candidateId} scored ${bestMatch.score}/${MAX_SCORE} (${bestMatch.classification})`
    : "no candidate records to resolve against";

  const note =
    `Resolved identity for ${incoming.recordId} against ${scored.length} candidate record${
      scored.length === 1 ? "" : "s"
    }: ${bestDetail} → recommendation ${recommendation}${
      requiresHumanReview ? " (requires human steward review)" : ""
    }. Every match decision traces to the defined match-feature spec (transparent, not a black box); a merge below the auto-match threshold is NEVER performed autonomously — it requires a human steward; and protected-class attributes are never used as matching features. ` +
    "Synthetic/illustrative match features, weights, thresholds, and patient records — NOT a certified EMPI algorithm.";

  return { candidates: scored, bestMatch, recommendation, requiresHumanReview, synthetic: true, note };
}

/**
 * Transparency check: does EVERY scored candidate trace to the defined
 * match-feature spec? True for anything scoreCandidate()/resolveIdentity()
 * produces — every matched feature references a defined catalog id, the matched
 * weights sum to the score, and the classification is exactly what
 * classifyScore() derives from that score. The guard that catches a
 * caller-asserted OPAQUE / off-spec match (an off-catalog feature, a score that
 * doesn't sum from its matched features, or a classification that doesn't follow
 * from the thresholds). This is the honest signal the route reports to
 * policy.mpi.transparent-matching. A non-array input is a violation.
 */
export function matchTracesToFeatures(
  candidates:
    | Array<Pick<ScoredCandidate, "score" | "classification" | "matchedFeatures">>
    | null
    | undefined
): boolean {
  if (!Array.isArray(candidates)) return false;
  return candidates.every((c) => {
    if (!Array.isArray(c.matchedFeatures)) return false;
    if (!c.matchedFeatures.every((f) => isMatchFeature(f.id))) return false;
    const summed = c.matchedFeatures.reduce((sum, f) => {
      const weight = getMatchFeature(f.id)?.weight ?? 0;
      return sum + weight;
    }, 0);
    return summed === c.score && classifyScore(c.score) === c.classification;
  });
}

/**
 * No-autonomous-merge check: does the resolution avoid autonomously merging a
 * pair below the auto-match threshold? True for anything resolveIdentity()
 * produces (a possible-match yields a manual-review recommendation with
 * requiresHumanReview:true; a match at/above the auto threshold is the
 * legitimate auto path). The guard that catches a caller-asserted resolution
 * that would merge / link a pair whose best match is BELOW the auto-match
 * threshold without requiring a human steward (an autonomous merge). This is the
 * honest signal the route reports to policy.mpi.no-autonomous-merge. A non-object
 * input is a violation.
 */
export function mergeRequiresHumanReview(
  resolution:
    | Pick<IdentityResolution, "recommendation" | "requiresHumanReview" | "bestMatch">
    | null
    | undefined
): boolean {
  if (!resolution || typeof resolution !== "object") return false;
  const isMergeOrLink =
    resolution.recommendation === "merge" || resolution.recommendation === "link";
  // A manual-review / no-action recommendation never merges — it always honors review.
  if (!isMergeOrLink) return true;
  const score =
    resolution.bestMatch && typeof resolution.bestMatch.score === "number"
      ? resolution.bestMatch.score
      : 0;
  const belowAutoThreshold = score < MATCH_THRESHOLDS.autoMatch;
  // A merge/link below the auto threshold MUST require a human steward.
  if (belowAutoThreshold && resolution.requiresHumanReview !== true) return false;
  return true;
}

/**
 * Fairness check: does the matching feature set use ONLY non-protected-class
 * features? True when every feature the model claims to match on is absent from
 * PROTECTED_CLASS_ATTRIBUTES; the guard that catches a caller asserting a
 * protected-class attribute (race, ethnicity, religion, national origin, gender
 * identity, sexual orientation, disability status, marital status) was used as a
 * matching feature. This is the honest signal the route reports to
 * policy.mpi.no-protected-class-matching. A non-array input is a violation.
 */
export function excludesProtectedAttributesInMatching(
  matchingFeatureIds: string[] | null | undefined
): boolean {
  if (!Array.isArray(matchingFeatureIds)) return false;
  return matchingFeatureIds.every((id) => !isProtectedClassAttribute(id));
}

/**
 * The default set of matching feature ids the model uses — the MATCH_FEATURES
 * catalog ids. None is a protected-class attribute, so
 * excludesProtectedAttributesInMatching() over this set is always true.
 */
export function matchingFeatureIds(): string[] {
  return MATCH_FEATURES.map((f) => f.id);
}

/**
 * A compact, trace-safe summary of a resolution — the shape stamped onto the
 * Agent Fabric trace + the response `meta`. Carries no free-text PII (ids,
 * counts, the best score, and the recommendation only).
 */
export function identityResolutionSummary(
  incoming: PatientRecord,
  resolution: IdentityResolution
): {
  incomingRef: string;
  candidateCount: number;
  bestMatchId?: string;
  bestScore?: number;
  classification?: MatchClassification;
  recommendation: ResolutionRecommendation;
  requiresHumanReview: boolean;
  synthetic: boolean;
} {
  return {
    incomingRef: incoming.recordId,
    candidateCount: resolution.candidates.length,
    bestMatchId: resolution.bestMatch?.candidateId,
    bestScore: resolution.bestMatch?.score,
    classification: resolution.bestMatch?.classification,
    recommendation: resolution.recommendation,
    requiresHumanReview: resolution.requiresHumanReview,
    synthetic: resolution.synthetic
  };
}

/**
 * A representative, deterministic demo incoming record (illustrative). A midlife
 * patient arriving from a source system, to be resolved against the candidate
 * set below. Synthetic / de-identified.
 */
export const DEMO_INCOMING_RECORD: PatientRecord = {
  recordId: "mpi-incoming-001",
  firstName: "Maria",
  lastName: "Gonzalez",
  dob: "1974-03-12",
  sex: "female",
  addressLine: "482 Juniper Way",
  postalCode: "94110",
  phone: "+1-415-555-0142",
  mrn: "MRN-4820",
  memberId: "MBR-77120",
  synthetic: true
};

/**
 * A CLEAR-MATCH candidate (illustrative). The same person from another source
 * system, with cosmetic formatting differences (casing, spacing, phone format)
 * that normalization sees through — every feature matches for a score of
 * MAX_SCORE (a clean `match` → merge, since a shared identifier corroborates it).
 * Synthetic / de-identified.
 */
export const DEMO_CLEAR_MATCH_CANDIDATE: PatientRecord = {
  recordId: "mpi-candidate-clear-001",
  firstName: "MARIA",
  lastName: "Gonzalez",
  dob: "1974-03-12",
  sex: "Female",
  addressLine: "482 Juniper Way ",
  postalCode: "94110",
  phone: "(415) 555-0142",
  mrn: "MRN-4820",
  memberId: "MBR-77120",
  synthetic: true
};

/**
 * An AMBIGUOUS POSSIBLE-MATCH candidate (illustrative). Same name + DOB +
 * administrative sex, but a different address, phone, and identifiers — scoring
 * in the review band (a `possible-match` → manual-review, requiresHumanReview).
 * This is the honest, safe output the agent surfaces for a human steward — NOT a
 * governance block. Synthetic / de-identified.
 */
export const DEMO_POSSIBLE_MATCH_CANDIDATE: PatientRecord = {
  recordId: "mpi-candidate-possible-001",
  firstName: "Maria",
  lastName: "Gonzalez",
  dob: "1974-03-12",
  sex: "female",
  addressLine: "19 Seaview Terrace",
  postalCode: "94019",
  phone: "+1-650-555-0999",
  mrn: "MRN-9981",
  memberId: "MBR-33001",
  // Protected-class fields carried but NEVER used as matching features.
  race: "declined-to-state",
  synthetic: true
};

/**
 * A NO-MATCH candidate (illustrative). A different person entirely — only the
 * low-weight administrative-sex field coincides, scoring below the no-match
 * cutoff (a `no-match` → no-action). Synthetic / de-identified.
 */
export const DEMO_NO_MATCH_CANDIDATE: PatientRecord = {
  recordId: "mpi-candidate-nomatch-001",
  firstName: "Jennifer",
  lastName: "Okafor",
  dob: "1988-11-30",
  sex: "female",
  addressLine: "77 Birchwood Ave",
  postalCode: "10025",
  phone: "+1-212-555-0777",
  mrn: "MRN-1200",
  memberId: "MBR-55010",
  synthetic: true
};

/**
 * A representative, deterministic demo candidate set (illustrative). Resolving
 * the incoming record against these produces a clear match (→ merge), an
 * ambiguous possible-match (→ manual-review), and a no-match (→ no-action), so
 * the whole classification spread is demonstrable. Synthetic / de-identified.
 */
export const DEMO_CANDIDATE_RECORDS: PatientRecord[] = [
  DEMO_CLEAR_MATCH_CANDIDATE,
  DEMO_POSSIBLE_MATCH_CANDIDATE,
  DEMO_NO_MATCH_CANDIDATE
];
