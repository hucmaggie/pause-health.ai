/**
 * HEDIS & Quality Reporting — panel/cohort-level rollup of per-patient care-gap
 * signals into HEDIS / Star measure compliance rates for value-based-care.
 *
 * Deterministic, dependency-free domain core the HEDIS & Quality Reporting Agent
 * (app/api/agents/hedis-quality) wraps — the Salesforce "Agentforce for Health"
 * / Health Cloud quality-reporting analog on Pause's Agent Fabric. Unlike the
 * single-patient Care Gap Closure Agent (which drafts outreach for one patient's
 * gaps) and the panel-level Population Health & Risk Stratification Agent (which
 * prioritizes people), this agent reports a PANEL against a defined set of HEDIS
 * quality measures — numerator, denominator, exclusions, and compliance RATE per
 * measure — the artifact provider organizations owe payers under value-based-
 * care contracts.
 *
 *   Inbound:  PatientQualitySignals[] (per-patient, de-identified signals; each
 *             citing a synthetic patientRef — clearly labeled illustrative), plus
 *             an optional `asOfPeriod` accepted as data (no clock)
 *   Outbound: PanelQualityReport { perMeasure: [{ measureId, denominator,
 *             numerator, exclusions, rate, gapPatients[] }], synthetic:true,
 *             note } and a consent-safe SubmissionPackage from
 *             assembleSubmission()
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: measures trace to the HEDIS measure catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every measure the report scores must trace to the defined HEDIS_MEASURES
 *  catalog — an off-catalog / fabricated measure is not scored, and a submission
 *  citing an unknown measure id is a violation. measuresTraceToCatalog() reports
 *  the honest signal the Agent Fabric enforces via
 *  policy.hedis.measure-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: exclusions trace to a catalog exclusion.
 * ─────────────────────────────────────────────────────────────────────
 *  Every exclusion applied to a measure must trace to a defined exclusion entry
 *  on that measure's catalog spec — an ad-hoc / unlisted exclusion is a
 *  violation. This is load-bearing: fabricated exclusions are the classic way
 *  a rate is quietly inflated by shrinking the denominator, and the fabric
 *  enforces the guard via policy.hedis.exclusion-integrity.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous submission.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent may NEVER autonomously submit a quality-measure package to a payer
 *  / CMS / a quality registry — every submission requires a human quality-team
 *  approval. assembleSubmission() always returns state !== "submitted" and
 *  requiresQualityTeamApproval:true; a caller-asserted submission plan that
 *  claims already-submitted or bypasses human approval is a violation. Mirrors
 *  the Population Health Agent's no-autonomous-care-decision, the Prior
 *  Authorization Agent's no-autonomous-submission, and the Clinical Trials
 *  Agent's no-autonomous-enrollment posture. submissionRequiresHumanApproval()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.hedis.no-autonomous-submission.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified HEDIS engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The measure catalog, thresholds, exclusion lists, and measurement windows
 *  below are ILLUSTRATIVE synthetic/demo values chosen to model the SHAPE of
 *  HEDIS quality reporting — they are NOT NCQA-certified specifications (real
 *  HEDIS technical specs are versioned by measurement year, licensed by NCQA,
 *  and value-set-bound to code systems). The patientRefs are synthetic /
 *  de-identified. There is NO randomness and NO clock anywhere here: the
 *  rollup is a pure function of the panel signals + the caller-provided
 *  `asOfPeriod`, so the same panel always yields the same rates — which is
 *  what lets the demo, the seeded trace, and the tests agree.
 */

/**
 * A single HEDIS quality measure in the (illustrative) measure catalog. Every
 * measure exposes its DENOMINATOR eligibility (age / sex / condition), its
 * NUMERATOR compliance criterion, and the DEFINED exclusions that may shrink
 * the denominator. Every field is a clearly-labeled illustrative synthetic;
 * NOT a certified HEDIS spec.
 */
export type HedisMeasure = {
  /** Stable catalog id every measure report references (never invented). */
  id: string;
  /** Standard-style measure abbreviation (illustrative). */
  code: string;
  /** Human-readable measure label. */
  label: string;
  /** Higher-level HEDIS domain (illustrative). */
  domain: "prevention-and-screening" | "behavioral-health" | "cardiovascular";
  /**
   * Inclusive age window for denominator eligibility (illustrative). A patient
   * outside the window is not in the denominator.
   */
  ageRange: { minAge: number; maxAge: number };
  /**
   * Whether female sex is required for denominator eligibility (illustrative).
   * true → female-only; false → both sexes eligible.
   */
  requiresFemale: boolean;
  /** Human-readable numerator criterion (illustrative). */
  numeratorCriterion: string;
  /** Human-readable denominator criterion (illustrative). */
  denominatorCriterion: string;
  /** The DEFINED exclusion list for this measure (illustrative). */
  allowedExclusions: HedisExclusion[];
  /** Always true — the catalog + specs are illustrative synthetics. */
  synthetic: true;
};

/**
 * A defined exclusion entry on a measure's catalog spec. `id` is the stable
 * exclusion catalog id every applied exclusion must trace to — an exclusion
 * whose id is not on the measure's `allowedExclusions` list is rejected as an
 * ad-hoc exclusion (the load-bearing rate-integrity guard).
 */
export type HedisExclusion = {
  /** Stable catalog id every applied exclusion references (never invented). */
  id: string;
  /** Human-readable exclusion label. */
  label: string;
};

/**
 * The illustrative HEDIS measure catalog for the menopause/midlife panel. NOT
 * an NCQA-certified spec — every measure is a demo-honest sketch designed to
 * model the SHAPE of HEDIS reporting a provider organization owes payers under
 * value-based-care contracts (see the module header). The five measures cover
 * the menopause-relevant preventive-and-screening (OSW, BCS), cardiovascular
 * (CBP, SPC), and behavioral (TCC) domains.
 */
export const HEDIS_MEASURES: HedisMeasure[] = [
  {
    id: "measure.osteoporosis-screening-women",
    code: "OSW",
    label: "Osteoporosis Screening in Women",
    domain: "prevention-and-screening",
    ageRange: { minAge: 65, maxAge: 85 },
    requiresFemale: true,
    numeratorCriterion:
      "A bone-mineral-density (DEXA) screening within the past 24 months.",
    denominatorCriterion:
      "Female patients aged 65-85 with an active care relationship in the measurement period.",
    allowedExclusions: [
      {
        id: "exclusion.hospice",
        label: "Patient is in hospice care during the measurement period"
      },
      {
        id: "exclusion.advanced-illness-and-frailty",
        label:
          "Advanced illness plus frailty on the illustrative advanced-illness/frailty list"
      }
    ],
    synthetic: true
  },
  {
    id: "measure.breast-cancer-screening",
    code: "BCS",
    label: "Breast Cancer Screening",
    domain: "prevention-and-screening",
    ageRange: { minAge: 50, maxAge: 74 },
    requiresFemale: true,
    numeratorCriterion:
      "A screening mammogram within the past 27 months.",
    denominatorCriterion:
      "Female patients aged 50-74 with an active care relationship in the measurement period.",
    allowedExclusions: [
      {
        id: "exclusion.hospice",
        label: "Patient is in hospice care during the measurement period"
      },
      {
        id: "exclusion.bilateral-mastectomy",
        label: "Documented bilateral mastectomy"
      }
    ],
    synthetic: true
  },
  {
    id: "measure.controlling-high-blood-pressure",
    code: "CBP",
    label: "Controlling High Blood Pressure",
    domain: "cardiovascular",
    ageRange: { minAge: 18, maxAge: 85 },
    requiresFemale: false,
    numeratorCriterion:
      "The patient's most recent BP reading in the measurement period is < 140/90 mmHg.",
    denominatorCriterion:
      "Patients aged 18-85 with a diagnosis of hypertension and an active care relationship.",
    allowedExclusions: [
      {
        id: "exclusion.hospice",
        label: "Patient is in hospice care during the measurement period"
      },
      {
        id: "exclusion.esrd-or-dialysis",
        label: "Documented end-stage renal disease or dialysis"
      }
    ],
    synthetic: true
  },
  {
    id: "measure.statin-therapy-cvd",
    code: "SPC",
    label: "Statin Therapy for Patients With Cardiovascular Disease",
    domain: "cardiovascular",
    ageRange: { minAge: 21, maxAge: 75 },
    requiresFemale: false,
    numeratorCriterion:
      "The patient is dispensed at least one high- or moderate-intensity statin in the measurement period.",
    denominatorCriterion:
      "Patients aged 21-75 with a diagnosis of clinical atherosclerotic cardiovascular disease.",
    allowedExclusions: [
      {
        id: "exclusion.hospice",
        label: "Patient is in hospice care during the measurement period"
      },
      {
        id: "exclusion.pregnancy",
        label: "Pregnancy documented during the measurement period"
      },
      {
        id: "exclusion.statin-intolerance",
        label: "Documented statin allergy or clinically-recognized intolerance"
      }
    ],
    synthetic: true
  },
  {
    id: "measure.tobacco-cessation-counseling",
    code: "TCC",
    label: "Tobacco Use Screening & Cessation Counseling",
    domain: "behavioral-health",
    ageRange: { minAge: 18, maxAge: 120 },
    requiresFemale: false,
    numeratorCriterion:
      "Current tobacco users received cessation counseling or a cessation-pharmacotherapy discussion in the measurement period.",
    denominatorCriterion:
      "Patients aged 18+ screened for tobacco use with an active care relationship in the measurement period.",
    allowedExclusions: [
      {
        id: "exclusion.hospice",
        label: "Patient is in hospice care during the measurement period"
      }
    ],
    synthetic: true
  }
];

const MEASURE_BY_ID = new Map(HEDIS_MEASURES.map((m) => [m.id, m]));

/** Is `id` a defined HEDIS measure catalog id? */
export function isHedisMeasure(id: unknown): boolean {
  return typeof id === "string" && MEASURE_BY_ID.has(id);
}

/** Look up a HEDIS measure by id (undefined for an off-catalog id). */
export function getMeasure(id: string): HedisMeasure | undefined {
  return MEASURE_BY_ID.get(id);
}

/**
 * Is `exclusionId` a defined exclusion on the given measure's spec? The guard
 * the exclusion-integrity signal builds on: an exclusion whose id isn't on the
 * measure's allowedExclusions list is an ad-hoc / unlisted exclusion, not a
 * catalog-sourced one.
 */
export function isAllowedExclusion(
  measureId: unknown,
  exclusionId: unknown
): boolean {
  if (typeof measureId !== "string" || typeof exclusionId !== "string") {
    return false;
  }
  const measure = MEASURE_BY_ID.get(measureId);
  if (!measure) return false;
  return measure.allowedExclusions.some((e) => e.id === exclusionId);
}

/**
 * The already-produced, per-patient signals the quality-measure roll-up reads.
 * Every field is optional; a signal absent from a patient is treated as
 * "unknown" and the measure evaluator makes a documented, conservative choice
 * per measure (e.g. an unknown screening → not compliant → gap). `patientRef`
 * is synthetic, de-identified — clearly labeled illustrative.
 */
export type PatientQualitySignals = {
  /** Synthetic, de-identified patient reference (e.g. "hedis-patient-001"). */
  patientRef: string;
  /** Patient age (illustrative). Missing → the age gate is not satisfied. */
  age?: number;
  /** Patient sex (illustrative). Missing / "male" excludes female-only measures. */
  sex?: "female" | "male" | "unknown";
  /**
   * Whether the patient has an active care relationship with the reporting
   * organization in the measurement period (illustrative). Missing → false.
   */
  activeCareRelationship?: boolean;
  /** Whether a DEXA screening is documented within the past 24 months. */
  hasRecentDexa?: boolean;
  /** Whether a screening mammogram is documented within the past 27 months. */
  hasRecentMammogram?: boolean;
  /** Whether hypertension is on the patient's problem list. */
  hasHypertensionDx?: boolean;
  /** Most recent BP reading in the measurement period (mmHg). */
  mostRecentBp?: { systolic: number; diastolic: number };
  /** Whether clinical ASCVD is on the patient's problem list. */
  hasAscvdDx?: boolean;
  /** Whether a high- or moderate-intensity statin was dispensed. */
  onStatin?: boolean;
  /**
   * Current tobacco-use status (illustrative). "current" is the denominator
   * for the counseling numerator; "former" / "never" / undefined are outside
   * the counseling numerator but still count in the screening denominator.
   */
  tobaccoStatus?: "current" | "former" | "never";
  /** Whether cessation counseling / pharmacotherapy was discussed in the period. */
  hadCessationCounseling?: boolean;
  /**
   * Applied exclusions (illustrative). Each entry pairs a measureId with an
   * exclusionId that MUST be on that measure's allowedExclusions list — an
   * ad-hoc / unlisted exclusion is rejected by exclusionsTraceToCatalog().
   */
  exclusions?: Array<{ measureId: string; exclusionId: string }>;
};

/** A single-patient status against a single HEDIS measure. */
export type PatientMeasureStatus =
  | "not-in-denominator"
  | "excluded"
  | "compliant"
  | "non-compliant";

/** A single measure's rolled-up numerator / denominator / exclusions / rate. */
export type MeasureReport = {
  /** The HEDIS measure catalog id this report is about (never invented). */
  measureId: string;
  /** Copied from the catalog for display convenience. */
  measureCode: string;
  /** Copied from the catalog for display convenience. */
  measureLabel: string;
  /** Copied from the catalog for display convenience. */
  domain: HedisMeasure["domain"];
  /** Count of eligible patients (before exclusions). */
  eligible: number;
  /** Count of patients removed by a catalog-sourced exclusion. */
  excluded: number;
  /** The reported denominator (eligible - excluded). */
  denominator: number;
  /** The reported numerator (compliant patients within the denominator). */
  numerator: number;
  /** Compliance rate — numerator / denominator, or null when denominator = 0. */
  rate: number | null;
  /** Non-compliant patients in the denominator (the "gap" list for outreach). */
  gapPatientRefs: string[];
};

/** The panel quality report the agent returns for a set of measures. */
export type PanelQualityReport = {
  /** The measurement period this report is `asOf` (accepted as data — no clock). */
  asOfPeriod: string;
  /** Total patients in the input panel. */
  panelSize: number;
  /** Per-measure roll-up (one per measure in HEDIS_MEASURES order). */
  perMeasure: MeasureReport[];
  /** Always true — the catalog + signals + rates are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Compute a patient's status against one measure. Deterministic. */
function statusForMeasure(
  measure: HedisMeasure,
  patient: PatientQualitySignals
): PatientMeasureStatus {
  const age = typeof patient.age === "number" ? patient.age : -1;
  const inAge = age >= measure.ageRange.minAge && age <= measure.ageRange.maxAge;
  const meetsSex = measure.requiresFemale ? patient.sex === "female" : true;
  const hasCareRelationship = patient.activeCareRelationship === true;
  if (!inAge || !meetsSex || !hasCareRelationship) return "not-in-denominator";

  // Measure-specific denominator narrowing (a diagnosis is required for CBP /
  // SPC; the counseling numerator only applies to current tobacco users, but
  // ALL screened patients are still in the tobacco-screening denominator).
  if (measure.id === "measure.controlling-high-blood-pressure") {
    if (patient.hasHypertensionDx !== true) return "not-in-denominator";
  }
  if (measure.id === "measure.statin-therapy-cvd") {
    if (patient.hasAscvdDx !== true) return "not-in-denominator";
  }
  if (measure.id === "measure.tobacco-cessation-counseling") {
    // Denominator is patients whose tobacco status is known (screened).
    if (patient.tobaccoStatus === undefined) return "not-in-denominator";
  }

  // Catalog-sourced exclusions applied against THIS measure only. An ad-hoc /
  // off-catalog exclusion is IGNORED here (the exclusion-integrity signal is
  // what surfaces it as a violation to governance).
  const applied = Array.isArray(patient.exclusions)
    ? patient.exclusions.filter(
        (e) => e.measureId === measure.id && isAllowedExclusion(e.measureId, e.exclusionId)
      )
    : [];
  if (applied.length > 0) return "excluded";

  // Numerator per measure (deterministic, catalog-defined).
  switch (measure.id) {
    case "measure.osteoporosis-screening-women":
      return patient.hasRecentDexa === true ? "compliant" : "non-compliant";
    case "measure.breast-cancer-screening":
      return patient.hasRecentMammogram === true ? "compliant" : "non-compliant";
    case "measure.controlling-high-blood-pressure": {
      const bp = patient.mostRecentBp;
      if (!bp) return "non-compliant";
      return bp.systolic < 140 && bp.diastolic < 90 ? "compliant" : "non-compliant";
    }
    case "measure.statin-therapy-cvd":
      return patient.onStatin === true ? "compliant" : "non-compliant";
    case "measure.tobacco-cessation-counseling": {
      // Current users must have received counseling; former / never users are
      // trivially compliant with the counseling numerator (they don't need it).
      if (patient.tobaccoStatus === "current") {
        return patient.hadCessationCounseling === true ? "compliant" : "non-compliant";
      }
      return "compliant";
    }
    default:
      return "non-compliant";
  }
}

/**
 * Score one measure over the panel. DETERMINISTIC — a pure function of the
 * measure spec + the patient signals; every exclusion applied is catalog-
 * sourced. Returns eligible / excluded / denominator / numerator / rate and
 * the gap list of non-compliant patient refs (input order preserved).
 */
export function scoreMeasure(
  measure: HedisMeasure,
  panel: PatientQualitySignals[]
): MeasureReport {
  let eligible = 0;
  let excluded = 0;
  let numerator = 0;
  const gapPatientRefs: string[] = [];

  for (const patient of panel) {
    const status = statusForMeasure(measure, patient);
    if (status === "not-in-denominator") continue;
    eligible += 1;
    if (status === "excluded") {
      excluded += 1;
      continue;
    }
    if (status === "compliant") numerator += 1;
    else gapPatientRefs.push(patient.patientRef);
  }

  const denominator = eligible - excluded;
  const rate = denominator > 0 ? numerator / denominator : null;

  return {
    measureId: measure.id,
    measureCode: measure.code,
    measureLabel: measure.label,
    domain: measure.domain,
    eligible,
    excluded,
    denominator,
    numerator,
    rate,
    gapPatientRefs
  };
}

/**
 * Roll up a whole patient panel against every measure in HEDIS_MEASURES.
 * DETERMINISTIC: a pure function of the panel signals + the `asOfPeriod` the
 * caller provides (accepted as data — no clock), so the same panel + period
 * always yields the same rates. The panel report is a QUALITY signal — it is
 * NEVER autonomously submitted; assembleSubmission() carries the human-approval
 * gate.
 */
export function rollUpPanel(
  panel: PatientQualitySignals[],
  asOfPeriod: string
): PanelQualityReport {
  const perMeasure = HEDIS_MEASURES.map((m) => scoreMeasure(m, panel));
  const totalGaps = perMeasure.reduce((sum, m) => sum + m.gapPatientRefs.length, 0);

  const note =
    `Rolled up ${panel.length} patient${panel.length === 1 ? "" : "s"} against ${
      perMeasure.length
    } HEDIS quality measure${perMeasure.length === 1 ? "" : "s"} as of ${asOfPeriod} — ${totalGaps} open care gap${
      totalGaps === 1 ? "" : "s"
    } across the panel. Measures trace to the illustrative measure catalog; every applied exclusion traces to a defined catalog exclusion; the report is a quality signal for the quality team, never autonomously submitted to a payer or registry. ` +
    "Synthetic/illustrative measures, exclusions, and thresholds — not an NCQA-certified HEDIS engine; every submission requires human quality-team approval.";

  return {
    asOfPeriod,
    panelSize: panel.length,
    perMeasure,
    synthetic: true,
    note
  };
}

/** The state of a submission package. NEVER "submitted" without human approval. */
export type SubmissionState = "draft" | "ready-for-quality-team-review";

/**
 * A quality-measure submission package the agent assembles for a human quality
 * team to approve and file. It is ALWAYS requiresQualityTeamApproval:true /
 * submitted:false — the agent never submits autonomously. Mirrors the Prior
 * Authorization Agent's clinician-gated draft posture.
 */
export type SubmissionPackage = {
  /** draft (assembly in progress) / ready-for-quality-team-review. */
  state: SubmissionState;
  /** The measurement period this package covers (accepted as data — no clock). */
  asOfPeriod: string;
  /** The measure ids this package reports (every id catalog-sourced). */
  measureIds: string[];
  /** Always true — a submission always requires human approval. */
  requiresQualityTeamApproval: true;
  /** Always false — the agent NEVER autonomously submits. */
  submitted: false;
  /** Illustrative synthetic tracking id (not a real registry id). */
  packageId: string;
  /** Human-readable package body. */
  body: string;
};

/**
 * Assemble a submission package from a panel report. Deterministic on its
 * input. NEVER autonomously submits: requiresQualityTeamApproval is always true
 * and submitted is always false. The state is always "ready-for-quality-team-
 * review" — a human quality team reviews the numerator/denominator/exclusion
 * detail and files with the payer / CMS / registry.
 */
export function assembleSubmission(
  report: Pick<PanelQualityReport, "asOfPeriod" | "perMeasure">
): SubmissionPackage {
  const measureIds = report.perMeasure.map((m) => m.measureId);
  const rates = report.perMeasure
    .map((m) => `${m.measureCode} ${m.rate === null ? "n/a" : `${Math.round(m.rate * 100)}%`}`)
    .join(", ");

  // A stable, illustrative synthetic package id derived from the period. No
  // randomness, no clock — the same period always yields the same id.
  const packageId = `hedis-pkg-${report.asOfPeriod}`;

  return {
    state: "ready-for-quality-team-review",
    asOfPeriod: report.asOfPeriod,
    measureIds,
    requiresQualityTeamApproval: true,
    submitted: false,
    packageId,
    body:
      `Assembled a HEDIS quality-reporting submission package (${packageId}) for the ${report.asOfPeriod} measurement period, covering ${measureIds.length} measure${
        measureIds.length === 1 ? "" : "s"
      } (${rates}). ` +
      "Ready for human quality-team review — the agent NEVER autonomously submits to a payer, CMS, or a quality registry."
  };
}

/**
 * Measure-source-integrity check: does EVERY measure the report scores trace to
 * the HEDIS_MEASURES catalog? True for anything rollUpPanel() produces — every
 * per-measure entry references a catalog id. The guard that catches a caller-
 * asserted report that scores an off-catalog / fabricated measure. This is the
 * honest signal the route reports to policy.hedis.measure-catalog-sourced. A
 * non-array input is a violation.
 */
export function measuresTraceToCatalog(
  perMeasure:
    | Array<Pick<MeasureReport, "measureId">>
    | null
    | undefined
): boolean {
  if (!Array.isArray(perMeasure)) return false;
  return perMeasure.every((m) => isHedisMeasure(m.measureId));
}

/**
 * Exclusion-integrity check: does EVERY applied exclusion trace to a defined
 * exclusion on the target measure's catalog spec? True when every entry has a
 * measureId + exclusionId that pair with a catalog entry; the guard that
 * catches a caller-asserted ad-hoc / unlisted exclusion (a classic way to
 * inflate the rate by shrinking the denominator). This is the honest signal
 * the route reports to policy.hedis.exclusion-integrity. A non-array input is
 * a violation.
 */
export function exclusionsTraceToCatalog(
  applied:
    | Array<{ measureId?: string; exclusionId?: string }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(applied)) return false;
  return applied.every((e) => isAllowedExclusion(e.measureId, e.exclusionId));
}

/**
 * Human-approval check: does the submission plan require a human quality-team
 * approval, and is it explicitly NOT submitted? True for anything
 * assembleSubmission() produces (requiresQualityTeamApproval:true, submitted:
 * false); the guard that catches a caller-asserted plan that would autonomously
 * submit or bypass approval. This is the honest signal the route reports to
 * policy.hedis.no-autonomous-submission. A non-object input is a violation.
 */
export function submissionRequiresHumanApproval(
  plan:
    | {
        requiresQualityTeamApproval?: boolean;
        submitted?: boolean;
        state?: string;
      }
    | null
    | undefined
): boolean {
  if (!plan || typeof plan !== "object") return false;
  if (plan.requiresQualityTeamApproval !== true) return false;
  if (plan.submitted === true) return false;
  return true;
}

/** Aggregate all applied exclusions across a panel — used by the integrity check. */
export function collectAppliedExclusions(
  panel: PatientQualitySignals[]
): Array<{ measureId: string; exclusionId: string }> {
  const out: Array<{ measureId: string; exclusionId: string }> = [];
  for (const p of panel) {
    if (!Array.isArray(p.exclusions)) continue;
    for (const e of p.exclusions) out.push(e);
  }
  return out;
}

/**
 * A representative, deterministic demo panel (illustrative). Six patients
 * chosen to exercise every measure's numerator, denominator, and exclusion —
 * so the demo, tests, and seeded trace all see a non-trivial rate on every
 * measure. Patient refs are synthetic / de-identified.
 *
 *   hedis-patient-001: 68F, DEXA present, mammogram present — OSW / BCS ✓
 *   hedis-patient-002: 72F, hospice-excluded from BCS + OSW
 *   hedis-patient-003: 58F HTN, BP 128/78, ASCVD, on statin — CBP / SPC ✓
 *   hedis-patient-004: 45M HTN, BP 152/98, current tobacco, no counseling — gaps on CBP / TCC
 *   hedis-patient-005: 61F ASCVD, statin-intolerance excluded from SPC
 *   hedis-patient-006: 52F, mammogram missing, BP 138/85 — BCS gap; ineligible for OSW (age)
 */
export const DEMO_PANEL: PatientQualitySignals[] = [
  {
    patientRef: "hedis-patient-001",
    age: 68,
    sex: "female",
    activeCareRelationship: true,
    hasRecentDexa: true,
    hasRecentMammogram: true,
    tobaccoStatus: "never"
  },
  {
    patientRef: "hedis-patient-002",
    age: 72,
    sex: "female",
    activeCareRelationship: true,
    exclusions: [
      { measureId: "measure.osteoporosis-screening-women", exclusionId: "exclusion.hospice" },
      { measureId: "measure.breast-cancer-screening", exclusionId: "exclusion.hospice" }
    ]
  },
  {
    patientRef: "hedis-patient-003",
    age: 58,
    sex: "female",
    activeCareRelationship: true,
    hasHypertensionDx: true,
    mostRecentBp: { systolic: 128, diastolic: 78 },
    hasAscvdDx: true,
    onStatin: true,
    hasRecentMammogram: true,
    tobaccoStatus: "former"
  },
  {
    patientRef: "hedis-patient-004",
    age: 45,
    sex: "male",
    activeCareRelationship: true,
    hasHypertensionDx: true,
    mostRecentBp: { systolic: 152, diastolic: 98 },
    tobaccoStatus: "current",
    hadCessationCounseling: false
  },
  {
    patientRef: "hedis-patient-005",
    age: 61,
    sex: "female",
    activeCareRelationship: true,
    hasAscvdDx: true,
    hasRecentMammogram: true,
    exclusions: [
      { measureId: "measure.statin-therapy-cvd", exclusionId: "exclusion.statin-intolerance" }
    ]
  },
  {
    patientRef: "hedis-patient-006",
    age: 52,
    sex: "female",
    activeCareRelationship: true,
    hasRecentMammogram: false,
    hasHypertensionDx: true,
    mostRecentBp: { systolic: 138, diastolic: 85 },
    tobaccoStatus: "never"
  }
];

/** The default `asOfPeriod` — a clearly-illustrative measurement year. */
export const DEMO_AS_OF_PERIOD = "MY2026";
