/**
 * Minimum Necessary (HIPAA §164.502(b) / §164.514(d)) — the deterministic, transparent
 * data-substrate layer that decides whether a PHI disclosure is limited to the MINIMUM
 * NECESSARY for its stated purpose-of-use and requestor role, releasing only the field
 * categories the purpose permits and withholding the rest.
 *
 * Deterministic, dependency-free domain core the Minimum Necessary Agent
 * (app/api/agents/minimum-necessary) wraps — a control-plane / data-substrate service on the
 * platform plane of Pause's Agent Fabric. Given a disclosure request (a requestor role, a
 * purpose-of-use, the specific fields requested — each mapped to a field CATEGORY — and the
 * record scope: single-patient / cohort / bulk), it DETERMINISTICALLY resolves the governing
 * purpose-of-use rule, then decides per field whether it is within the minimum-necessary
 * scope for that purpose (release) or beyond it (withhold), yielding a disclosure limited to
 * the minimum necessary.
 *
 *   Inbound:  a DisclosureRequest { requestRef, requestorRole, purposeId, requestedFields[], recordScope }
 *   Outbound: a MinimumNecessaryDetermination { fieldDecisions[], releasedCount, withheldCount,
 *             minimumNecessary, requiresHumanReview, exempt, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other platform / data-substrate agents:
 * distinct from the Consent & Preferences Management agent (WHETHER a patient may be contacted
 * / data used for a scope), the De-Identification & Safe Harbor agent (whether a dataset is no
 * longer PHI), the Master Patient Index (identity / dedup), the Break-the-Glass agent
 * (emergency PHI access), and the Data Retention agent (records disposition): this decides HOW
 * MUCH of an identified patient's PHI a given purpose-of-use may see.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every disclosure decision cites a recorded purpose-of-use.
 * ─────────────────────────────────────────────────────────────────────
 *  Every determination must cite a recorded purpose-of-use rule from the catalog — there is no
 *  ad-hoc, un-sourced disclosure. minNecPurposeSourced() reports the honest signal the Agent
 *  Fabric enforces via policy.minnec.purpose-of-use-sourced. (Mirrors the De-Identification
 *  Agent's method-cited and the Data Retention Agent's schedule-sourced posture — every
 *  decision traces to a defined source.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: a released field is always within the minimum-necessary scope.
 * ─────────────────────────────────────────────────────────────────────
 *  Every field marked `release` must belong to a category the purpose-of-use permits (unless
 *  the purpose is minimum-necessary EXEMPT — treatment / to the individual / with authorization
 *  / required-by-law) — no field beyond the minimum necessary may be disclosed. Releasing an
 *  out-of-scope field over-discloses PHI. minNecScoped() reports the honest signal the Agent
 *  Fabric enforces via policy.minnec.minimum-necessary-scoped. (This is the load-bearing
 *  privacy gate — mirrors the De-Identification Agent's no-release-of-reidentifiable: a
 *  privacy obligation that cannot be skipped.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: an over-scope / bulk disclosure is never autonomously released.
 * ─────────────────────────────────────────────────────────────────────
 *  A request that is NOT minimum-necessary as submitted (fields had to be withheld) or that is
 *  a bulk / cohort disclosure is a RECOMMENDATION requiring human review — it is never
 *  autonomously approved. A determination that is not-minimum-necessary or bulk yet does not
 *  require human review is dishonest. minNecNoAutonomousOverDisclosure() reports the honest
 *  signal the Agent Fabric enforces via policy.minnec.no-autonomous-over-disclosure. (Mirrors
 *  the De-Identification Agent's no-release-of-reidentifiable and the Balance Billing Agent's
 *  no-autonomous-balance-bill posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — minimum-necessary or narrowed — is a SAFE, honest OUTPUT: the task
 *  COMPLETES (a narrowed / bulk disclosure carries requiresHumanReview:true). A GOVERNANCE
 *  BLOCK is when a caller PRESENTS an offending DETERMINATION (an un-sourced purpose, a
 *  released field outside the purpose's scope, or an over-scope / bulk disclosure auto-approved)
 *  — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified minimum-necessary engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The purpose-of-use catalog, requestor roles, field categories, and allowed-category mappings
 *  below are ILLUSTRATIVE synthetic/demo rules chosen to model the SHAPE of a governed
 *  minimum-necessary determination — they are NOT a certified HIPAA privacy engine, and a REAL
 *  determination uses the covered entity's role-based access policies, its minimum-necessary
 *  standard under 45 CFR 164.502(b) / 164.514(d), and the specifics of each disclosure. There
 *  is NO randomness and NO clock anywhere here: the determination is a pure function of the
 *  request + the purpose catalog (no Date.now()), so the same request always yields the same
 *  field decisions + released/withheld sets + flags — which is what lets the demo, the seeded
 *  trace, and the tests agree.
 */

/** A field category a disclosure can reference. Illustrative/synthetic. */
export type FieldCategory =
  | "demographics"
  | "contact"
  | "contact-preferences"
  | "insurance"
  | "billing"
  | "dates-of-service"
  | "diagnoses"
  | "procedures"
  | "medications"
  | "lab-results"
  | "clinical-notes"
  | "psychotherapy-notes"
  | "substance-use"
  | "ssn"
  | "quality-measures"
  | "utilization"
  | "deidentified-demographics";

/** A per-field decision. */
export type FieldDecision = {
  /** The field name (e.g. "patient.ssn"). */
  name: string;
  /** The category the field maps to. */
  category: FieldCategory;
  /** Whether the field is released or withheld. */
  decision: "release" | "withhold";
  /** Human-readable reason. */
  reason: string;
};

/** A purpose-of-use rule — the governing catalog entry. */
export type PurposeRule = {
  /** Stable catalog id (cited on every determination). */
  id: string;
  /** The purpose-of-use. */
  purpose: string;
  /** The requestor role the purpose is scoped to. */
  requestorRole: string;
  /**
   * Whether the purpose is EXEMPT from the minimum-necessary standard (treatment, disclosure
   * to the individual, disclosure with the individual's authorization, or required-by-law).
   * When exempt, all requested fields may be released.
   */
  minimumNecessaryExempt: boolean;
  /** The field categories this purpose is permitted to see (ignored when exempt). */
  allowedCategories: FieldCategory[];
  /** Illustrative description. Demo-honest. */
  description: string;
};

/**
 * The purpose-of-use catalog — every determination cites one of these. Illustrative/synthetic
 * (see the header). Treatment is minimum-necessary EXEMPT; payment, operations, research, and
 * marketing are scoped to progressively narrower category sets.
 */
export const PURPOSE_RULES: PurposeRule[] = [
  {
    id: "purpose.treatment",
    purpose: "treatment",
    requestorRole: "treating-clinician",
    minimumNecessaryExempt: true,
    allowedCategories: [],
    description:
      "Treatment by a treating clinician — EXEMPT from the minimum-necessary standard (45 CFR 164.502(b)(2)(i)). (Illustrative.)"
  },
  {
    id: "purpose.payment",
    purpose: "payment",
    requestorRole: "billing-specialist",
    minimumNecessaryExempt: false,
    allowedCategories: [
      "demographics",
      "insurance",
      "billing",
      "dates-of-service",
      "diagnoses",
      "procedures"
    ],
    description:
      "Payment / claims processing by a billing specialist — limited to the categories needed to adjudicate a claim. (Illustrative.)"
  },
  {
    id: "purpose.operations",
    purpose: "healthcare-operations",
    requestorRole: "quality-analyst",
    minimumNecessaryExempt: false,
    allowedCategories: [
      "demographics",
      "diagnoses",
      "procedures",
      "quality-measures",
      "utilization"
    ],
    description:
      "Healthcare operations / quality reporting by a quality analyst — limited to operational categories. (Illustrative.)"
  },
  {
    id: "purpose.research",
    purpose: "research",
    requestorRole: "researcher",
    minimumNecessaryExempt: false,
    allowedCategories: ["deidentified-demographics", "diagnoses", "lab-results"],
    description:
      "Research under a limited data set by a researcher — narrow, no direct identifiers. (Illustrative.)"
  },
  {
    id: "purpose.marketing",
    purpose: "marketing",
    requestorRole: "marketing",
    minimumNecessaryExempt: false,
    allowedCategories: ["contact-preferences"],
    description:
      "Marketing / outreach — the narrowest scope; contact preferences only (marketing generally also requires authorization). (Illustrative.)"
  }
];

const RULE_BY_ID = new Map(PURPOSE_RULES.map((r) => [r.id, r]));
const RULE_IDS = new Set<string>(PURPOSE_RULES.map((r) => r.id));

/** Is `id` a recognized purpose-of-use rule id? */
export function isPurposeRule(id: unknown): boolean {
  return typeof id === "string" && RULE_IDS.has(id);
}

/** Look up a purpose-of-use rule by id (undefined for an off-catalog id). */
export function getPurposeRule(id: string): PurposeRule | undefined {
  return RULE_BY_ID.get(id);
}

/** The record scope of a disclosure. */
export type RecordScope = "single-patient" | "cohort" | "bulk";

/** A requested field. */
export type RequestedField = {
  /** The field name. */
  name: string;
  /** The category the field maps to. */
  category: FieldCategory;
};

/** A minimum-necessary disclosure request. */
export type DisclosureRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** The requestor's role. */
  requestorRole: string;
  /** The cited purpose-of-use rule id. */
  purposeId: string;
  /** The specific fields requested. */
  requestedFields: RequestedField[];
  /** The record scope (defaults to single-patient). */
  recordScope?: RecordScope;
};

/** The deterministic minimum-necessary determination the agent returns. */
export type MinimumNecessaryDetermination = {
  /** Synthetic request reference. */
  requestRef: string;
  /** The cited purpose-of-use rule id. */
  purposeId: string;
  /** The requestor role. */
  requestorRole: string;
  /** The record scope evaluated. */
  recordScope: RecordScope;
  /** Whether the purpose is minimum-necessary exempt (treatment / to-individual / authorized / required-by-law). */
  exempt: boolean;
  /** The per-field decisions. */
  fieldDecisions: FieldDecision[];
  /** The number of released fields. */
  releasedCount: number;
  /** The number of withheld fields. */
  withheldCount: number;
  /** Whether the request as submitted was minimum-necessary (no field had to be withheld). */
  minimumNecessary: boolean;
  /** Whether the disclosure is a bulk / cohort scope. */
  bulk: boolean;
  /** Whether the determination requires human review (a narrowed or bulk disclosure). */
  requiresHumanReview: boolean;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the purpose catalog is illustrative synthetic. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * The deterministic minimum-necessary function — the heart of the service. DETERMINISTIC: a
 * pure function of the request + the purpose catalog (no randomness, no clock). It resolves the
 * governing purpose-of-use rule, then decides per field: for an EXEMPT purpose (treatment /
 * to-individual / authorized / required-by-law) every field is released; for a non-exempt
 * purpose a field is released iff its category is in the purpose's allowed categories, else
 * withheld. The released set is therefore always limited to the minimum necessary. A request
 * that had to be narrowed (fields withheld) or that is a bulk / cohort scope requires human
 * review — nothing is autonomously released beyond the minimum necessary.
 */
export function evaluateMinimumNecessary(
  request: DisclosureRequest
): MinimumNecessaryDetermination {
  const recordScope: RecordScope = request.recordScope ?? "single-patient";
  const rule = getPurposeRule(request.purposeId);
  const requestedFields = Array.isArray(request.requestedFields)
    ? request.requestedFields
    : [];
  const exempt = rule?.minimumNecessaryExempt === true;
  const allowed = new Set<FieldCategory>(rule?.allowedCategories ?? []);

  const fieldDecisions: FieldDecision[] = requestedFields.map((f) => {
    if (!rule) {
      // No governing rule — nothing can be released (purpose is not sourced).
      return {
        name: f.name,
        category: f.category,
        decision: "withhold",
        reason: `Withheld: the purpose-of-use "${request.purposeId}" is not a recorded rule; no field can be scoped.`
      };
    }
    if (exempt) {
      return {
        name: f.name,
        category: f.category,
        decision: "release",
        reason: `Released: "${rule.purpose}" is exempt from the minimum-necessary standard.`
      };
    }
    if (allowed.has(f.category)) {
      return {
        name: f.name,
        category: f.category,
        decision: "release",
        reason: `Released: category "${f.category}" is within the minimum-necessary scope for "${rule.purpose}".`
      };
    }
    return {
      name: f.name,
      category: f.category,
      decision: "withhold",
      reason: `Withheld: category "${f.category}" is beyond the minimum-necessary scope for "${rule.purpose}".`
    };
  });

  const releasedCount = fieldDecisions.filter((d) => d.decision === "release").length;
  const withheldCount = fieldDecisions.filter((d) => d.decision === "withhold").length;
  // The request as submitted is minimum-necessary iff nothing had to be withheld for scope
  // reasons. (An exempt purpose is trivially minimum-necessary — the standard does not apply.)
  const minimumNecessary = withheldCount === 0;
  const bulk = recordScope === "bulk" || recordScope === "cohort";
  // A narrowed (over-scope) or bulk disclosure requires human review; an exempt single-patient
  // full release does not.
  const requiresHumanReview = !minimumNecessary || bulk;

  const reason = !rule
    ? `Request ${request.requestRef}: purpose-of-use "${request.purposeId}" is not a recorded rule — no field released, human review required`
    : exempt
      ? `Request ${request.requestRef}: "${rule.purpose}" is minimum-necessary EXEMPT — all ${releasedCount} field(s) released${bulk ? " (bulk scope — human review required)" : ""}`
      : minimumNecessary && !bulk
        ? `Request ${request.requestRef}: minimum-necessary for "${rule.purpose}" — all ${releasedCount} requested field(s) within scope, released`
        : `Request ${request.requestRef}: NOT minimum-necessary as submitted for "${rule.purpose}" — ${releasedCount} field(s) released, ${withheldCount} withheld as out-of-scope${bulk ? " (bulk scope)" : ""}; human review required`;

  return {
    requestRef: request.requestRef,
    purposeId: request.purposeId,
    requestorRole: request.requestorRole,
    recordScope,
    exempt,
    fieldDecisions,
    releasedCount,
    withheldCount,
    minimumNecessary,
    bulk,
    requiresHumanReview,
    reason,
    synthetic: true,
    note:
      `Minimum-necessary determination for ${request.requestRef} (purpose ${request.purposeId}, role ${request.requestorRole}, ${recordScope}): ${releasedCount} released, ${withheldCount} withheld across ${fieldDecisions.length} requested field(s). ` +
      "Synthetic/illustrative purpose-of-use catalog + role + category mappings — NOT a certified minimum-necessary engine; a real determination uses the covered entity's role-based access policies and its minimum-necessary standard under 45 CFR 164.502(b) / 164.514(d)."
  };
}

/**
 * Purpose-of-use-sourced check: does the determination cite a recorded purpose-of-use rule?
 * True when purposeId is a recognized catalog rule; the guard that catches an ad-hoc /
 * un-sourced disclosure (a missing or off-catalog purpose id). Anything
 * evaluateMinimumNecessary() produces with a real purpose satisfies it. This is the honest
 * signal the route reports to policy.minnec.purpose-of-use-sourced. A non-object input is a
 * violation.
 */
export function minNecPurposeSourced(
  determination: Pick<MinimumNecessaryDetermination, "purposeId"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return isPurposeRule(determination.purposeId);
}

/**
 * Minimum-necessary-scoped check: is every RELEASED field within the purpose's permitted
 * categories? True when the purpose is exempt, or when every field marked `release` has a
 * category in the purpose's allowed categories; the guard that catches an over-disclosure (a
 * released field beyond the minimum-necessary scope). Anything evaluateMinimumNecessary()
 * produces satisfies it (out-of-scope fields are always withheld). This is the honest signal
 * the route reports to policy.minnec.minimum-necessary-scoped. A non-object input, or one
 * whose purpose is not sourced, is a violation.
 */
export function minNecScoped(
  determination:
    | Pick<MinimumNecessaryDetermination, "purposeId" | "fieldDecisions">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  const rule = getPurposeRule(determination.purposeId as string);
  if (!rule) return false;
  if (rule.minimumNecessaryExempt) return true;
  const allowed = new Set<FieldCategory>(rule.allowedCategories);
  const decisions = Array.isArray(determination.fieldDecisions)
    ? determination.fieldDecisions
    : [];
  return decisions
    .filter((d) => d?.decision === "release")
    .every((d) => allowed.has(d.category));
}

/**
 * No-autonomous-over-disclosure check: is a not-minimum-necessary / bulk disclosure gated on
 * human review? True unless a determination that is not-minimum-necessary or bulk does not
 * require human review; the guard that catches an over-scope / bulk disclosure auto-approved.
 * Anything evaluateMinimumNecessary() produces satisfies it. This is the honest signal the
 * route reports to policy.minnec.no-autonomous-over-disclosure. A non-object input is a
 * violation.
 */
export function minNecNoAutonomousOverDisclosure(
  determination:
    | Pick<MinimumNecessaryDetermination, "minimumNecessary" | "bulk" | "requiresHumanReview">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  const overOrBulk =
    determination.minimumNecessary === false || determination.bulk === true;
  return !(overOrBulk && determination.requiresHumanReview === false);
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric
 * trace + the response `meta`. Carries no field-level PHI (ref, purpose, role, and the counts
 * only).
 */
export function minimumNecessarySummary(
  determination: MinimumNecessaryDetermination
): {
  requestRef: string;
  purposeId: string;
  requestorRole: string;
  recordScope: RecordScope;
  exempt: boolean;
  fieldCount: number;
  releasedCount: number;
  withheldCount: number;
  minimumNecessary: boolean;
  requiresHumanReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: determination.requestRef,
    purposeId: determination.purposeId,
    requestorRole: determination.requestorRole,
    recordScope: determination.recordScope,
    exempt: determination.exempt,
    fieldCount: determination.fieldDecisions.length,
    releasedCount: determination.releasedCount,
    withheldCount: determination.withheldCount,
    minimumNecessary: determination.minimumNecessary,
    requiresHumanReview: determination.requiresHumanReview,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request (illustrative). A billing specialist requesting payment-scoped
 * fields plus a clinical note → the note is out-of-scope and withheld (not minimum-necessary as
 * submitted), the rest released. Synthetic / de-identified.
 */
export const DEMO_MINIMUM_NECESSARY_REQUEST: DisclosureRequest = {
  requestRef: "mn-request-001",
  requestorRole: "billing-specialist",
  purposeId: "purpose.payment",
  recordScope: "single-patient",
  requestedFields: [
    { name: "patient.demographics", category: "demographics" },
    { name: "patient.insurance", category: "insurance" },
    { name: "claim.diagnoses", category: "diagnoses" },
    { name: "claim.procedures", category: "procedures" },
    { name: "encounter.clinicalNote", category: "clinical-notes" }
  ]
};

/**
 * A representative demo request that is fully within scope (illustrative). A billing specialist
 * requesting only payment-scoped fields → minimum-necessary, all released, no review. Synthetic.
 */
export const DEMO_MINIMUM_NECESSARY_INSCOPE_REQUEST: DisclosureRequest = {
  requestRef: "mn-request-002",
  requestorRole: "billing-specialist",
  purposeId: "purpose.payment",
  recordScope: "single-patient",
  requestedFields: [
    { name: "patient.demographics", category: "demographics" },
    { name: "patient.insurance", category: "insurance" },
    { name: "claim.procedures", category: "procedures" }
  ]
};

/**
 * A representative demo request for a treatment (exempt) purpose (illustrative). A treating
 * clinician requesting broad clinical fields → exempt, all released, no review. Synthetic.
 */
export const DEMO_MINIMUM_NECESSARY_TREATMENT_REQUEST: DisclosureRequest = {
  requestRef: "mn-request-003",
  requestorRole: "treating-clinician",
  purposeId: "purpose.treatment",
  recordScope: "single-patient",
  requestedFields: [
    { name: "patient.demographics", category: "demographics" },
    { name: "encounter.clinicalNote", category: "clinical-notes" },
    { name: "patient.medications", category: "medications" },
    { name: "labs.results", category: "lab-results" }
  ]
};

/**
 * A representative demo request for a bulk research pull (illustrative). A researcher pulling a
 * cohort of diagnoses + labs → within scope but bulk, so human review is required. Synthetic.
 */
export const DEMO_MINIMUM_NECESSARY_BULK_REQUEST: DisclosureRequest = {
  requestRef: "mn-request-004",
  requestorRole: "researcher",
  purposeId: "purpose.research",
  recordScope: "cohort",
  requestedFields: [
    { name: "cohort.diagnoses", category: "diagnoses" },
    { name: "cohort.labResults", category: "lab-results" }
  ]
};
