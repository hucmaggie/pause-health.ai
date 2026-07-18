/**
 * Population Health & Risk Stratification — panel/cohort-level care-management
 * triage with a transparent, deterministic risk model.
 *
 * Deterministic, dependency-free domain core the Population Health & Risk
 * Stratification Agent (app/api/agents/population-health) wraps — the Salesforce
 * "Agentforce for Health" / Health Cloud population-health / risk-stratification
 * analog on Pause's Agent Fabric. Unlike every other patient-plane agent (which
 * reasons over a SINGLE patient), this one reasons over a whole PANEL/COHORT at
 * once: it takes already-produced per-patient signals (intake severity,
 * validated-assessment band, detected care gaps, positive SDOH domains,
 * medication-adherence status, monitored-symptom trend), DETERMINISTICALLY
 * scores each patient with a transparent additive/weighted RISK MODEL, assigns a
 * risk tier (low / rising / high) by fixed cutoffs, and emits a prioritized
 * OUTREACH WORKLIST (which patients a care manager should reach first, and why).
 *
 *   Inbound:  PatientPanelSignals[] (per-patient, de-identified signals; each
 *             citing a synthetic patientRef — clearly labeled illustrative)
 *   Outbound: PanelStratification { perPatient: [{ patientRef, score, tier,
 *             contributingFactors[] }], worklist: [patientRef ordered by
 *             priority], tierCounts, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the risk model is TRANSPARENT, not opaque.
 * ─────────────────────────────────────────────────────────────────────
 *  Every patient's score is a pure, additive/weighted function of a DEFINED set
 *  of risk factors (RISK_FACTORS below — each with a documented weight), and
 *  every patient's tier is EXPLAINABLE by citing the contributing factors. There
 *  is no black-box / opaque scoring. riskScoreTracesToFactors() reports the
 *  honest signal the Agent Fabric enforces via policy.pophealth.transparent-risk-model.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: NO protected-class attributes as factors.
 * ─────────────────────────────────────────────────────────────────────
 *  The risk model must NOT use protected-class attributes (race, ethnicity,
 *  gender identity, religion, national origin, disability status, sexual
 *  orientation, marital status) as scoring factors — a responsible-AI / fairness
 *  property. None of RISK_FACTORS is a protected-class attribute;
 *  excludesProtectedAttributes() reports the honest signal the Agent Fabric
 *  enforces via policy.pophealth.no-protected-class-factors.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a tier NEVER triggers an autonomous action.
 * ─────────────────────────────────────────────────────────────────────
 *  A risk tier is a prioritization signal for a human care manager — it must not
 *  autonomously trigger a care action. Any tier→action requires human /
 *  care-manager review (routedTo:'care-manager-review'). tierActionsReviewedByHuman()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.pophealth.no-autonomous-care-decision.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified risk-stratification model.
 * ─────────────────────────────────────────────────────────────────────
 *  The risk factors, their weights, and the tier cutoffs below are ILLUSTRATIVE
 *  synthetic/demo values chosen to model the SHAPE of transparent risk
 *  stratification — they are NOT a certified or clinically-authoritative
 *  risk-adjustment model (real population-health models — HCC, ACG, LACE, etc. —
 *  are validated, calibrated, and individualized). The patientRefs are
 *  synthetic/de-identified. There is NO randomness and NO clock anywhere here:
 *  the score is a pure function of the per-patient signals the caller passes, so
 *  the same panel always yields the same tiers + worklist ordering (with a
 *  documented, stable tie-break) — which is what lets the demo, the seeded trace,
 *  and the tests agree.
 */

export type RiskTier = "low" | "rising" | "high";

/** The tiers in ascending order of priority (low → rising → high). */
export const RISK_TIERS: RiskTier[] = ["low", "rising", "high"];

/**
 * A single documented risk factor in the transparent risk model. `weight` is the
 * MAXIMUM points this factor can contribute; the per-factor scoring function maps
 * a patient's signal to an integer in [0, weight]. Illustrative — not certified.
 */
export type RiskFactor = {
  /** Stable catalog id every contributing factor references. */
  id: string;
  /** Human-readable factor label. */
  label: string;
  /** Maximum points this factor contributes (its weight in the additive model). */
  weight: number;
  /**
   * The (illustrative) reason this factor is in the risk model. NOT a certified
   * rationale — a demo-honest description. Explicitly non-protected-class.
   */
  rationale: string;
};

/**
 * The transparent risk-model spec: the ONLY factors that contribute to a score.
 * Additive/weighted — a patient's score is the sum of each factor's points, and
 * a patient's tier is derived from that score by TIER_CUTOFFS. Every factor is a
 * CLINICAL / care-management signal — deliberately NONE is a protected-class
 * attribute (see the module header). Illustrative/synthetic weights; NOT a
 * certified risk-adjustment model.
 */
export const RISK_FACTORS: RiskFactor[] = [
  {
    id: "factor.intake-severity",
    label: "Intake symptom severity",
    // high → 3, moderate → 1, low/none → 0.
    weight: 3,
    rationale:
      "A higher self-reported intake symptom severity raises a patient's care-management priority. (Illustrative weight — not a certified risk model.)"
  },
  {
    id: "factor.assessment-band",
    label: "Validated-assessment severity band",
    // severe → 3, moderate → 2, mild → 1, none → 0.
    weight: 3,
    rationale:
      "A higher validated-instrument severity band (e.g. MRS / Greene / PHQ-9 / ISI) indicates greater symptom burden and raises priority. (Illustrative weight — not a certified risk model.)"
  },
  {
    id: "factor.care-gaps",
    label: "Open / overdue preventive-care gaps",
    // >= 2 gaps → 2, 1 gap → 1, 0 → 0.
    weight: 2,
    rationale:
      "Open or overdue preventive-care gaps (bone density, lipid panel, mammogram, HRT follow-up) indicate unmet care needs that raise priority. (Illustrative weight — not a certified risk model.)"
  },
  {
    id: "factor.sdoh-burden",
    label: "Positive SDOH / social-need domains",
    // >= 2 positive domains → 2, 1 → 1, 0 → 0.
    weight: 2,
    rationale:
      "Positive health-related social-need domains (housing, food, transportation, utilities, safety) compound clinical risk and raise care-coordination priority. (Illustrative weight — not a certified risk model.)"
  },
  {
    id: "factor.medication-nonadherence",
    label: "Medication non-adherence",
    // lapsed → 2, at-risk → 1, good → 0.
    weight: 2,
    rationale:
      "A lapsed or at-risk medication-adherence status (HRT / SSRI) indicates a care-continuity gap that raises priority. (Illustrative weight — not a certified risk model.)"
  },
  {
    id: "factor.monitoring-trend",
    label: "Worsening monitored-symptom trend",
    // worsening → 2, stable / improving → 0.
    weight: 2,
    rationale:
      "A worsening longitudinal monitored-symptom / vital trend indicates a deteriorating trajectory that raises priority. (Illustrative weight — not a certified risk model.)"
  }
];

/**
 * The fixed tier cutoffs the risk model applies to a score. Documented + stable:
 * high when score >= high, rising when score >= rising (and < high), low below.
 * Illustrative — not certified. (Max achievable score = sum of the weights = 14.)
 */
export const TIER_CUTOFFS: { high: number; rising: number } = {
  high: 7,
  rising: 3
};

/** The maximum achievable score (sum of every factor's weight). */
export const MAX_SCORE = RISK_FACTORS.reduce((sum, f) => sum + f.weight, 0);

const FACTOR_BY_ID = new Map(RISK_FACTORS.map((f) => [f.id, f]));

/** Is `id` a defined risk-factor catalog id? */
export function isRiskFactor(id: string): boolean {
  return FACTOR_BY_ID.has(id);
}

/** Look up a risk factor by id (undefined for an off-catalog id). */
export function getRiskFactor(id: string): RiskFactor | undefined {
  return FACTOR_BY_ID.get(id);
}

/**
 * Protected-class attributes the risk model must NEVER use as a scoring factor
 * (a responsible-AI / fairness property). If any of these appears in the set of
 * factors the model claims to use, the model is not fairness-clean.
 */
export const PROTECTED_CLASS_ATTRIBUTES: string[] = [
  "attr.race",
  "attr.ethnicity",
  "attr.gender-identity",
  "attr.religion",
  "attr.national-origin",
  "attr.disability-status",
  "attr.sexual-orientation",
  "attr.marital-status"
];

const PROTECTED_CLASS_SET = new Set<string>(PROTECTED_CLASS_ATTRIBUTES);

/** Is `id` a protected-class attribute the risk model may not score on? */
export function isProtectedClassAttribute(id: unknown): boolean {
  return typeof id === "string" && PROTECTED_CLASS_SET.has(id);
}

export type IntakeSeverity = "low" | "moderate" | "high";
export type AssessmentBand = "none" | "mild" | "moderate" | "severe";
export type MedicationAdherenceStatus = "good" | "at-risk" | "lapsed";
export type MonitoringTrend = "improving" | "stable" | "worsening";

/**
 * The already-produced, per-patient signals the stratifier reads. Every field is
 * optional (a missing signal contributes 0), so a partial panel scores cleanly.
 * `patientRef` is a synthetic, de-identified id — clearly labeled illustrative.
 */
export type PatientPanelSignals = {
  /** Synthetic, de-identified patient reference (e.g. "panel-patient-001"). */
  patientRef: string;
  /** Self-reported intake symptom severity. */
  intakeSeverity?: IntakeSeverity;
  /** Validated-instrument severity band (MRS / Greene / PHQ-9 / ISI). */
  assessmentBand?: AssessmentBand;
  /** Count of open / overdue preventive-care gaps. */
  openCareGaps?: number;
  /** Count of positive SDOH / social-need domains. */
  sdohPositiveDomains?: number;
  /** Medication-adherence status (HRT / SSRI). */
  medicationAdherence?: MedicationAdherenceStatus;
  /** Longitudinal monitored-symptom / vital trend. */
  monitoringTrend?: MonitoringTrend;
};

/** A single factor's contribution to a patient's score (why the tier is what it is). */
export type ContributingFactor = {
  /** The risk-factor catalog id this contribution references (never invented). */
  factorId: string;
  factorLabel: string;
  /** Points this factor contributed (1..weight; only positive contributions surface). */
  points: number;
  /** Human-readable detail (the signal value that produced the points). */
  detail: string;
};

/** A single patient's deterministic risk profile. */
export type PatientRiskProfile = {
  /** The synthetic patient reference this profile is about. */
  patientRef: string;
  /** The additive score (sum of contributingFactors' points). */
  score: number;
  /** The tier derived from the score by TIER_CUTOFFS. */
  tier: RiskTier;
  /** The factors that contributed (every tier is explainable by these). */
  contributingFactors: ContributingFactor[];
};

/** The deterministic panel-level stratification the agent returns. */
export type PanelStratification = {
  /** Per-patient risk profiles (one per input patient, input order preserved). */
  perPatient: PatientRiskProfile[];
  /** Patient refs ordered by outreach priority (highest risk first). */
  worklist: string[];
  /** Count of patients in each tier. */
  tierCounts: Record<RiskTier, number>;
  /** Always true — the factors + weights + patientRefs are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/**
 * A tier→action a care manager takes after reviewing the worklist. Every action
 * is ALWAYS routed to a human for review — the tier NEVER triggers it autonomously.
 */
export type CareActionRoute = "care-manager-review";

/** A caller-asserted tier→action (admissible only if routed to human review). */
export type TierCareAction = {
  /** The synthetic patient reference the action is about. */
  patientRef: string;
  /** The tier that prompted the action. */
  tier: RiskTier;
  /** Human-readable description of the proposed action. */
  action: string;
  /** Always "care-manager-review" — a tier never triggers an autonomous action. */
  routedTo: CareActionRoute;
};

/** Points factor.intake-severity contributes for a given severity. */
function scoreIntakeSeverity(severity: IntakeSeverity | undefined): number {
  if (severity === "high") return 3;
  if (severity === "moderate") return 1;
  return 0;
}

/** Points factor.assessment-band contributes for a given band. */
function scoreAssessmentBand(band: AssessmentBand | undefined): number {
  if (band === "severe") return 3;
  if (band === "moderate") return 2;
  if (band === "mild") return 1;
  return 0;
}

/** Points factor.care-gaps contributes for a gap count. */
function scoreCareGaps(count: number | undefined): number {
  const n = typeof count === "number" && count > 0 ? count : 0;
  if (n >= 2) return 2;
  if (n === 1) return 1;
  return 0;
}

/** Points factor.sdoh-burden contributes for a positive-domain count. */
function scoreSdoh(count: number | undefined): number {
  const n = typeof count === "number" && count > 0 ? count : 0;
  if (n >= 2) return 2;
  if (n === 1) return 1;
  return 0;
}

/** Points factor.medication-nonadherence contributes for an adherence status. */
function scoreMedication(status: MedicationAdherenceStatus | undefined): number {
  if (status === "lapsed") return 2;
  if (status === "at-risk") return 1;
  return 0;
}

/** Points factor.monitoring-trend contributes for a trend. */
function scoreMonitoring(trend: MonitoringTrend | undefined): number {
  return trend === "worsening" ? 2 : 0;
}

/** Map a score to a tier by the fixed, documented cutoffs. Deterministic. */
export function tierForScore(score: number): RiskTier {
  if (score >= TIER_CUTOFFS.high) return "high";
  if (score >= TIER_CUTOFFS.rising) return "rising";
  return "low";
}

/**
 * Score a single patient with the transparent risk model. DETERMINISTIC: a pure,
 * additive/weighted function of the patient's signals against RISK_FACTORS — no
 * randomness, no clock. Every contribution references a defined factor catalog id
 * (a contribution is never free-invented), and the tier is derived from the score
 * by TIER_CUTOFFS, so the profile is fully explainable.
 */
export function scorePatient(signals: PatientPanelSignals): PatientRiskProfile {
  const contributions: Array<{ factorId: string; points: number; detail: string }> = [
    {
      factorId: "factor.intake-severity",
      points: scoreIntakeSeverity(signals.intakeSeverity),
      detail: `intake severity ${signals.intakeSeverity ?? "none"}`
    },
    {
      factorId: "factor.assessment-band",
      points: scoreAssessmentBand(signals.assessmentBand),
      detail: `assessment band ${signals.assessmentBand ?? "none"}`
    },
    {
      factorId: "factor.care-gaps",
      points: scoreCareGaps(signals.openCareGaps),
      detail: `${signals.openCareGaps ?? 0} open care gap${
        (signals.openCareGaps ?? 0) === 1 ? "" : "s"
      }`
    },
    {
      factorId: "factor.sdoh-burden",
      points: scoreSdoh(signals.sdohPositiveDomains),
      detail: `${signals.sdohPositiveDomains ?? 0} positive SDOH domain${
        (signals.sdohPositiveDomains ?? 0) === 1 ? "" : "s"
      }`
    },
    {
      factorId: "factor.medication-nonadherence",
      points: scoreMedication(signals.medicationAdherence),
      detail: `medication adherence ${signals.medicationAdherence ?? "good"}`
    },
    {
      factorId: "factor.monitoring-trend",
      points: scoreMonitoring(signals.monitoringTrend),
      detail: `monitored trend ${signals.monitoringTrend ?? "stable"}`
    }
  ];

  const contributingFactors: ContributingFactor[] = contributions
    .filter((c) => c.points > 0)
    .map((c) => ({
      factorId: c.factorId,
      factorLabel: getRiskFactor(c.factorId)?.label ?? c.factorId,
      points: c.points,
      detail: c.detail
    }));

  const score = contributingFactors.reduce((sum, c) => sum + c.points, 0);

  return {
    patientRef: signals.patientRef,
    score,
    tier: tierForScore(score),
    contributingFactors
  };
}

/**
 * Build the prioritized outreach worklist from a set of risk profiles.
 * DETERMINISTIC ordering: by score descending, with a stable, documented
 * tie-break on patientRef ascending (lexical) so the same panel always yields the
 * same worklist ordering.
 */
export function buildWorklist(profiles: PatientRiskProfile[]): string[] {
  return [...profiles]
    .sort((a, b) => b.score - a.score || a.patientRef.localeCompare(b.patientRef))
    .map((p) => p.patientRef);
}

/**
 * Stratify a whole patient panel. DETERMINISTIC: scores each patient with the
 * transparent risk model, assigns a tier by the fixed cutoffs, tallies the tier
 * counts, and builds a prioritized outreach worklist. A pure function of the
 * panel signals (no randomness, no clock), so the same panel always yields the
 * same tiers + worklist ordering. The stratification is a prioritization signal
 * for a human care manager — it never triggers a care action itself.
 */
export function stratifyPanel(panel: PatientPanelSignals[]): PanelStratification {
  const perPatient = panel.map((p) => scorePatient(p));
  const worklist = buildWorklist(perPatient);

  const tierCounts: Record<RiskTier, number> = { low: 0, rising: 0, high: 0 };
  for (const p of perPatient) tierCounts[p.tier] += 1;

  const note =
    `Stratified ${perPatient.length} patient${
      perPatient.length === 1 ? "" : "s"
    } into risk tiers (${tierCounts.high} high, ${tierCounts.rising} rising, ${
      tierCounts.low
    } low) with a transparent, additive risk model; produced a prioritized outreach worklist for care-manager review. ` +
    "Synthetic/illustrative factors, weights, cutoffs, and patient references — not a certified risk-stratification model; a tier is a prioritization signal, never an autonomous care decision.";

  return { perPatient, worklist, tierCounts, synthetic: true, note };
}

/**
 * Transparency check: does EVERY patient's tier trace to the defined risk-factor
 * spec? True for anything scorePatient()/stratifyPanel() produces — every
 * contributing factor references a defined catalog id, the contributions sum to
 * the score, and the tier is exactly what TIER_CUTOFFS derives from that score.
 * The guard that catches a caller-asserted OPAQUE / off-spec profile (an
 * off-catalog factor, a score that doesn't sum from its factors, or a tier that
 * doesn't match its score). This is the honest signal the route reports to
 * policy.pophealth.transparent-risk-model.
 */
export function riskScoreTracesToFactors(
  profiles:
    | Array<Pick<PatientRiskProfile, "score" | "tier" | "contributingFactors">>
    | null
    | undefined
): boolean {
  if (!Array.isArray(profiles)) return false;
  return profiles.every((p) => {
    if (!Array.isArray(p.contributingFactors)) return false;
    if (!p.contributingFactors.every((c) => isRiskFactor(c.factorId))) return false;
    const summed = p.contributingFactors.reduce(
      (sum, c) => sum + (typeof c.points === "number" ? c.points : 0),
      0
    );
    return summed === p.score && tierForScore(p.score) === p.tier;
  });
}

/**
 * Fairness check: does the risk model use ONLY non-protected-class factors? True
 * when every factor the model claims to score on is absent from
 * PROTECTED_CLASS_ATTRIBUTES; the guard that catches a caller asserting a
 * protected-class attribute (race, ethnicity, gender identity, religion, etc.)
 * was used as a scoring factor. This is the honest signal the route reports to
 * policy.pophealth.no-protected-class-factors. A non-array input is a violation.
 */
export function excludesProtectedAttributes(
  scoringFactorIds: string[] | null | undefined
): boolean {
  if (!Array.isArray(scoringFactorIds)) return false;
  return scoringFactorIds.every((id) => !isProtectedClassAttribute(id));
}

/**
 * The default set of scoring factor ids the model uses — the RISK_FACTORS catalog
 * ids. None is a protected-class attribute, so excludesProtectedAttributes() over
 * this set is always true.
 */
export function modelScoringFactorIds(): string[] {
  return RISK_FACTORS.map((f) => f.id);
}

/**
 * Human-review check: are ALL tier→actions routed to a human care manager (never
 * triggered autonomously by a tier)? True for an empty set (the agent only builds
 * a worklist for review) and for any set routed to 'care-manager-review'; the
 * guard that catches a caller-asserted autonomous care decision (routedTo
 * anything else). This is the honest signal the route reports to
 * policy.pophealth.no-autonomous-care-decision.
 */
export function tierActionsReviewedByHuman(
  actions: Array<Pick<TierCareAction, "routedTo">> | null | undefined
): boolean {
  if (!Array.isArray(actions)) return false;
  return actions.every((a) => a.routedTo === "care-manager-review");
}

/**
 * A representative, deterministic demo panel (illustrative). Produces a mix of
 * tiers — one high, two rising, two low — so the stratification and the worklist
 * are both demonstrable. Patient refs are synthetic / de-identified.
 *
 *   panel-patient-001 → high   (severe across the board: score 12)
 *   panel-patient-002 → rising (moderate intake + assessment + a gap + SDOH: 5)
 *   panel-patient-003 → low    (mild assessment only, improving trend: 1)
 *   panel-patient-004 → rising (moderate intake + at-risk meds + worsening: 4)
 *   panel-patient-005 → low    (no positive signals: 0)
 */
export const DEMO_PANEL: PatientPanelSignals[] = [
  {
    patientRef: "panel-patient-001",
    intakeSeverity: "high",
    assessmentBand: "severe",
    openCareGaps: 3,
    sdohPositiveDomains: 0,
    medicationAdherence: "lapsed",
    monitoringTrend: "worsening"
  },
  {
    patientRef: "panel-patient-002",
    intakeSeverity: "moderate",
    assessmentBand: "moderate",
    openCareGaps: 1,
    sdohPositiveDomains: 1,
    medicationAdherence: "good",
    monitoringTrend: "stable"
  },
  {
    patientRef: "panel-patient-003",
    intakeSeverity: "low",
    assessmentBand: "mild",
    openCareGaps: 0,
    sdohPositiveDomains: 0,
    medicationAdherence: "good",
    monitoringTrend: "improving"
  },
  {
    patientRef: "panel-patient-004",
    intakeSeverity: "moderate",
    assessmentBand: "none",
    openCareGaps: 0,
    sdohPositiveDomains: 0,
    medicationAdherence: "at-risk",
    monitoringTrend: "worsening"
  },
  {
    patientRef: "panel-patient-005",
    intakeSeverity: "low",
    assessmentBand: "none",
    openCareGaps: 0,
    sdohPositiveDomains: 0,
    medicationAdherence: "good",
    monitoringTrend: "stable"
  }
];
