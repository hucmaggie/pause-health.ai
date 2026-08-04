/**
 * Risk Adjustment & HCC Coding — deterministic clinical-documentation-integrity
 * for value-based care.
 *
 * Deterministic, dependency-free domain core the Risk Adjustment & HCC Coding
 * Agent (app/api/agents/risk-adjustment) wraps — a patient-care clinical-
 * documentation-integrity agent on Pause's Agent Fabric. It reviews a patient's
 * (synthetic) clinical context and DETERMINISTICALLY identifies suspected /
 * confirmed HIERARCHICAL CONDITION CATEGORIES (HCCs) for risk adjustment,
 * mapping each to the documented clinical evidence that supports it, computes a
 * RAF-style risk score from the confirmed set, and flags coding gaps
 * (suspected-but-unconfirmed conditions) and unsupported / over-coded entries.
 *
 *   Inbound:  a RiskAdjustmentContext (a synthetic patientRef — clearly labeled
 *             illustrative — plus the documented clinical evidence signals and
 *             the HCCs that already carry a confirmed diagnosis code)
 *   Outbound: a RiskAdjustmentAssessment { hccs[], rafScore, codingGaps[],
 *             unsupportedFlags[], requiresClinicianValidation:true,
 *             submitted:false, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  IT IS A RECOMMENDER + INTEGRITY CHECKER — NEVER A CODING/BILLING ENGINE.
 * ─────────────────────────────────────────────────────────────────────
 *  Every SUSPECTED code is a RECOMMENDATION requiring clinician validation
 *  before use — the assessment always carries requiresClinicianValidation:true.
 *  The agent NEVER autonomously submits codes or adjusts a claim / RAF for
 *  reimbursement (submitted is always false). It COMPLEMENTS — it does NOT
 *  duplicate — the quality agents (HEDIS & Quality Reporting, Quality-Measure
 *  Attribution): those score quality MEASURES; this one is risk-adjustment
 *  CONDITION coding.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CODING GAP / UNSUPPORTED FLAG vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A CODING GAP (a suspected-but-unconfirmed HCC — clinical evidence is
 *  documented but no diagnosis code is on the claim) and an UNSUPPORTED /
 *  OVER-CODED FLAG (a diagnosis code is on the claim but the clinical evidence
 *  is not documented) are SAFE, honest OUTPUTS — the agent surfaces them for a
 *  clinician to validate / correct; the task COMPLETES (they are NOT blocks). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS a fabricated / unsupported code as
 *  SUPPORTED (a confirmed / suspected HCC that does not trace to documented
 *  clinical evidence — upcoding), asks the agent to treat a suspected code as
 *  validated WITHOUT a clinician, or asserts an AUTONOMOUS code submission /
 *  claim adjustment — which the Agent Fabric rejects before it can leave the
 *  fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified risk-adjustment / coding engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The HCC catalog, the illustrative RAF weights, and the supporting-evidence
 *  catalog below are ILLUSTRATIVE synthetic / demo values chosen to model the
 *  SHAPE of risk-adjustment condition coding — they are NOT the certified
 *  CMS-HCC model, real RAF coefficients, ICD-10 → HCC crosswalks, or a
 *  certified coding engine (real risk adjustment is model-version-specific,
 *  hierarchical, and continuously maintained). The patientRef is synthetic /
 *  de-identified. There is NO randomness and NO clock anywhere here: the
 *  assessment is a pure function of the clinical context the caller passes (any
 *  dates are taken as data), so the same context always yields the same
 *  assessment — which is what lets the demo, the seeded trace, and the tests
 *  agree.
 */

/** The coding status of a single HCC against the documented clinical evidence. */
export type HccStatus =
  /** A diagnosis code is on the claim AND the clinical evidence supports it. */
  | "confirmed"
  /** Clinical evidence supports the HCC but no diagnosis code is on the claim (a coding gap). */
  | "suspected"
  /** A diagnosis code is on the claim but the clinical evidence does NOT support it (over-coded). */
  | "unsupported";

/**
 * A single documented clinical-evidence signal in the (illustrative) supporting-
 * evidence catalog. This is the ONLY thing a confirmed / suspected HCC may trace
 * to — an HCC can never claim evidence the catalog doesn't define. Illustrative /
 * synthetic; NOT a real clinical-documentation feed.
 */
export type SupportingEvidence = {
  /** Stable catalog id every HCC's supportingEvidence references. */
  id: string;
  /** Human-readable evidence-signal label. */
  label: string;
  /** What the documented signal represents / why it supports the HCC (illustrative). */
  description: string;
};

/** A clearly-synthetic supporting-evidence reference stamped onto a suspected HCC. */
export type EvidenceRef = { id: string; label: string };

/**
 * The supporting-evidence catalog: id → label + description. Shared across HCCs
 * so an evidence signal (e.g. an elevated HbA1c) is described once. Illustrative /
 * synthetic; NOT a certified clinical-documentation requirement (see module header).
 */
export const SUPPORTING_EVIDENCE: SupportingEvidence[] = [
  {
    id: "evidence.a1c-elevated",
    label: "HbA1c ≥ 6.5% documented",
    description:
      "A documented HbA1c at or above the diabetes threshold. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.diabetes-medication",
    label: "On a diabetes medication",
    description:
      "The medication list documents an active anti-hyperglycemic agent. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.diabetic-complication",
    label: "Documented diabetic complication",
    description:
      "A documented chronic diabetic complication (e.g. neuropathy, retinopathy, nephropathy). (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.bmi-40-plus",
    label: "BMI ≥ 40 documented",
    description:
      "A documented body-mass index at or above the morbid-obesity threshold. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.obesity-clinical-note",
    label: "Clinician note of morbid obesity",
    description:
      "A clinician note explicitly documenting and assessing morbid obesity. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.egfr-below-60",
    label: "eGFR < 60 documented",
    description:
      "A documented estimated glomerular filtration rate below 60 mL/min/1.73m². (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.ckd-stage-note",
    label: "Documented CKD stage",
    description:
      "A clinician note documenting the chronic-kidney-disease stage. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.phq9-moderate-plus",
    label: "PHQ-9 in the moderate+ range",
    description:
      "A documented PHQ-9 score in the moderate-or-greater depression range. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.depression-treatment",
    label: "In documented depression treatment",
    description:
      "The record documents active treatment for depression (e.g. an antidepressant or therapy). (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.spirometry-copd",
    label: "Spirometry consistent with COPD",
    description:
      "A documented spirometry / PFT result consistent with chronic obstructive pulmonary disease. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.copd-maintenance-inhaler",
    label: "On a COPD maintenance inhaler",
    description:
      "The medication list documents an active COPD maintenance inhaler. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.echo-reduced-ef",
    label: "Echo with reduced ejection fraction",
    description:
      "A documented echocardiogram showing a reduced ejection fraction consistent with heart failure. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.chf-medication",
    label: "On a heart-failure medication",
    description:
      "The medication list documents an active guideline-directed heart-failure medication. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.dexa-tscore-osteoporosis",
    label: "DEXA T-score ≤ -2.5",
    description:
      "A documented DEXA bone-density T-score at or below the osteoporosis threshold — a menopause-relevant signal. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "evidence.fragility-fracture",
    label: "Documented fragility fracture",
    description:
      "A documented low-trauma / fragility fracture. (Illustrative — not a certified documentation requirement.)"
  }
];

const EVIDENCE_BY_ID = new Map(SUPPORTING_EVIDENCE.map((e) => [e.id, e]));

/** Is `id` a defined supporting-evidence catalog id? */
export function isSupportingEvidence(id: unknown): boolean {
  return typeof id === "string" && EVIDENCE_BY_ID.has(id);
}

/** Look up a supporting-evidence signal by id (undefined for an off-catalog id). */
export function getSupportingEvidence(id: string): SupportingEvidence | undefined {
  return EVIDENCE_BY_ID.get(id);
}

/**
 * A single Hierarchical Condition Category (HCC) in the (illustrative) catalog.
 * This is the ONLY source of legitimate HCCs — suspectHccs() iterates over these,
 * so a returned HCC can never reference a category that isn't defined here. Each
 * HCC declares the documented clinical-evidence signals that support it; the
 * category is fully supported only when EVERY one is documented. The rafWeight is
 * an ILLUSTRATIVE synthetic coefficient, NOT a real CMS-HCC RAF coefficient (see
 * the module header).
 */
export type HccDefinition = {
  /** Stable catalog id every suspected HCC references. */
  id: string;
  /** Human-readable HCC label. */
  label: string;
  /** Clinical grouping (for display + grouping). */
  category:
    | "endocrine"
    | "renal"
    | "behavioral"
    | "respiratory"
    | "cardiovascular"
    | "musculoskeletal";
  /** Short description of the condition + what documents it (illustrative). */
  description: string;
  /**
   * The supporting-evidence catalog ids that document this HCC. The category is
   * SUPPORTED only when every one of these is present in the clinical context.
   */
  supportingEvidence: string[];
  /**
   * The ILLUSTRATIVE synthetic RAF coefficient this HCC contributes when
   * confirmed — NOT a real CMS-HCC RAF weight.
   */
  rafWeight: number;
};

/**
 * The HCC catalog. Eight illustrative categories across the chronic-condition
 * neighborhood a midlife / menopause value-based-care panel commonly carries —
 * including an osteoporosis-with-fragility-fracture category that is directly
 * menopause-relevant. Illustrative / synthetic labels + RAF weights; NOT the
 * certified CMS-HCC model or real RAF coefficients (see the module header).
 */
export const HCC_CATALOG: HccDefinition[] = [
  {
    id: "hcc.diabetes-with-complication",
    label: "Diabetes with chronic complications",
    category: "endocrine",
    description:
      "Diabetes mellitus with a documented chronic complication. Supported by an elevated HbA1c and a documented diabetic complication.",
    supportingEvidence: ["evidence.a1c-elevated", "evidence.diabetic-complication"],
    rafWeight: 0.302
  },
  {
    id: "hcc.diabetes-without-complication",
    label: "Diabetes without complication",
    category: "endocrine",
    description:
      "Diabetes mellitus without a documented complication. Supported by an elevated HbA1c and an active diabetes medication.",
    supportingEvidence: ["evidence.a1c-elevated", "evidence.diabetes-medication"],
    rafWeight: 0.105
  },
  {
    id: "hcc.morbid-obesity",
    label: "Morbid obesity",
    category: "endocrine",
    description:
      "Morbid (severe) obesity. Supported by a documented BMI ≥ 40 and a clinician note assessing morbid obesity.",
    supportingEvidence: ["evidence.bmi-40-plus", "evidence.obesity-clinical-note"],
    rafWeight: 0.25
  },
  {
    id: "hcc.ckd-stage-3",
    label: "Chronic kidney disease, stage 3",
    category: "renal",
    description:
      "Stage-3 chronic kidney disease. Supported by a documented eGFR < 60 and a documented CKD stage.",
    supportingEvidence: ["evidence.egfr-below-60", "evidence.ckd-stage-note"],
    rafWeight: 0.127
  },
  {
    id: "hcc.major-depression",
    label: "Major depressive disorder",
    category: "behavioral",
    description:
      "Major depressive disorder. Supported by a PHQ-9 in the moderate-or-greater range and documented active treatment.",
    supportingEvidence: ["evidence.phq9-moderate-plus", "evidence.depression-treatment"],
    rafWeight: 0.309
  },
  {
    id: "hcc.copd",
    label: "Chronic obstructive pulmonary disease",
    category: "respiratory",
    description:
      "Chronic obstructive pulmonary disease. Supported by spirometry consistent with COPD and an active maintenance inhaler.",
    supportingEvidence: ["evidence.spirometry-copd", "evidence.copd-maintenance-inhaler"],
    rafWeight: 0.328
  },
  {
    id: "hcc.chf",
    label: "Congestive heart failure",
    category: "cardiovascular",
    description:
      "Congestive heart failure. Supported by an echocardiogram with a reduced ejection fraction and an active heart-failure medication.",
    supportingEvidence: ["evidence.echo-reduced-ef", "evidence.chf-medication"],
    rafWeight: 0.331
  },
  {
    id: "hcc.osteoporosis-fracture",
    label: "Osteoporosis with fragility fracture",
    category: "musculoskeletal",
    description:
      "Osteoporosis with a documented fragility fracture — a menopause-relevant category. Supported by a DEXA T-score ≤ -2.5 and a documented fragility fracture.",
    supportingEvidence: ["evidence.dexa-tscore-osteoporosis", "evidence.fragility-fracture"],
    rafWeight: 0.437
  }
];

const HCC_BY_ID = new Map(HCC_CATALOG.map((h) => [h.id, h]));

/** Is `id` a defined HCC catalog id? */
export function isCatalogHcc(id: unknown): boolean {
  return typeof id === "string" && HCC_BY_ID.has(id);
}

/** Look up an HCC definition by id (undefined for an off-catalog id). */
export function getHcc(id: string): HccDefinition | undefined {
  return HCC_BY_ID.get(id);
}

/**
 * Does `evidenceIds` document EVERY supporting-evidence signal the HCC requires?
 * The catalog-integrity predicate the anti-upcoding guard builds on: a confirmed /
 * suspected HCC must trace to the full documented evidence set the catalog defines.
 */
export function hccSupportedByEvidence(
  hccId: unknown,
  evidenceIds: unknown
): boolean {
  if (typeof hccId !== "string") return false;
  const hcc = HCC_BY_ID.get(hccId);
  if (!hcc) return false;
  const present = new Set(
    Array.isArray(evidenceIds)
      ? evidenceIds.filter((id): id is string => typeof id === "string")
      : []
  );
  return hcc.supportingEvidence.every((id) => present.has(id));
}

/**
 * The structured clinical facts the HCC suspector reads. Deterministic: a pure
 * function of the context (no randomness, no clock). `documentedEvidence` is the
 * set of supporting-evidence signals the (synthetic) clinical record carries;
 * `codedConditions` is the set of HCCs that already carry a confirmed diagnosis
 * code on the encounter / claim. Off-catalog ids in either are ignored (never
 * fabricated).
 */
export type RiskAdjustmentContext = {
  /** Synthetic, de-identified patient reference (e.g. "riskadj-patient-001"). */
  patientRef: string;
  /** Documented supporting-evidence catalog ids (off-catalog ids ignored). */
  documentedEvidence?: string[];
  /** HCC catalog ids that already carry a confirmed diagnosis code (off-catalog ids ignored). */
  codedConditions?: string[];
};

/** A single suspected / confirmed / unsupported HCC produced by the suspector. */
export type SuspectedHcc = {
  /** The HCC catalog id this entry derives from (never invented). */
  hccId: string;
  /** Copied from the catalog for display convenience. */
  hccLabel: string;
  /** The HCC's clinical grouping (copied from the catalog). */
  category: HccDefinition["category"];
  /** confirmed = coded + supported; suspected = supported, not coded; unsupported = coded, not supported. */
  status: HccStatus;
  /** The documented supporting evidence present for this HCC (catalog-sourced). */
  supportingEvidence: EvidenceRef[];
  /** Required supporting evidence the context does NOT document (drives suspected/unsupported). */
  missingEvidence: EvidenceRef[];
  /** The illustrative synthetic RAF coefficient (contributes only when confirmed). */
  rafWeight: number;
  /** Rule-based, human-readable reason for this status. */
  rationale: string;
};

/** The deterministic risk-adjustment assessment the agent returns. */
export type RiskAdjustmentAssessment = {
  /** The synthetic patient reference this assessment is about. */
  patientRef: string;
  /** Every emitted HCC (confirmed / suspected / unsupported), in catalog order. */
  hccs: SuspectedHcc[];
  /** The RAF-style total — the sum of the CONFIRMED HCCs' illustrative RAF weights. */
  rafScore: number;
  /** The suspected-but-unconfirmed HCCs — coding gaps for a clinician to validate + code. */
  codingGaps: SuspectedHcc[];
  /** The coded-but-unsupported HCCs — over-coding integrity flags for a clinician to correct. */
  unsupportedFlags: SuspectedHcc[];
  /** Always true — every suspected code is a recommendation requiring clinician validation. */
  requiresClinicianValidation: true;
  /** Always false — the agent never autonomously submits codes or adjusts a claim/RAF. */
  submitted: false;
  /** Always true — the HCC catalog, RAF weights, and evidence are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Map a set of evidence ids to display refs (catalog order preserved, off-catalog dropped). */
function evidenceRefs(ids: string[]): EvidenceRef[] {
  const wanted = new Set(ids);
  return SUPPORTING_EVIDENCE.filter((e) => wanted.has(e.id)).map((e) => ({
    id: e.id,
    label: e.label
  }));
}

/**
 * Suspect the HCCs for a patient's clinical context. DETERMINISTIC: iterates the
 * HCC catalog in order and, for each category, decides confirmed / suspected /
 * unsupported from whether a diagnosis code is on the claim and whether every
 * supporting-evidence signal the catalog defines is documented. An HCC that is
 * neither coded nor evidence-supported is not relevant and is not returned.
 *
 * Because it only ever iterates HCC_CATALOG, every returned hccId is a catalog id
 * by construction, and a confirmed / suspected HCC always traces to the full
 * documented evidence set — the integrity property the Agent Fabric enforces.
 */
export function suspectHccs(ctx: RiskAdjustmentContext): SuspectedHcc[] {
  const documented = new Set(
    Array.isArray(ctx.documentedEvidence)
      ? ctx.documentedEvidence.filter((id) => isSupportingEvidence(id))
      : []
  );
  const coded = new Set(
    Array.isArray(ctx.codedConditions)
      ? ctx.codedConditions.filter((id) => isCatalogHcc(id))
      : []
  );

  const out: SuspectedHcc[] = [];
  for (const hcc of HCC_CATALOG) {
    const presentIds = hcc.supportingEvidence.filter((id) => documented.has(id));
    const missingIds = hcc.supportingEvidence.filter((id) => !documented.has(id));
    const supported = missingIds.length === 0;
    const isCoded = coded.has(hcc.id);

    // Not coded and not evidence-supported → not relevant to this patient.
    if (!isCoded && !supported) continue;

    const status: HccStatus = isCoded
      ? supported
        ? "confirmed"
        : "unsupported"
      : "suspected";

    const rationale =
      status === "confirmed"
        ? `Diagnosis code on the claim and every supporting evidence signal documented — confirmed for risk adjustment.`
        : status === "suspected"
          ? `Supporting clinical evidence documented but no diagnosis code on the claim — a suspected coding gap for a clinician to validate and code.`
          : `Diagnosis code on the claim but ${missingIds.length} supporting evidence signal${
              missingIds.length === 1 ? "" : "s"
            } not documented — an unsupported / over-coded entry for a clinician to correct.`;

    out.push({
      hccId: hcc.id,
      hccLabel: hcc.label,
      category: hcc.category,
      status,
      supportingEvidence: evidenceRefs(presentIds),
      missingEvidence: evidenceRefs(missingIds),
      rafWeight: hcc.rafWeight,
      rationale
    });
  }
  return out;
}

/**
 * Compute the RAF-style risk score from a set of CONFIRMED HCCs — the sum of
 * their illustrative RAF weights, rounded to three decimals for a stable,
 * deterministic total. Pure: the same confirmed set always yields the same score.
 * (Illustrative — NOT a real CMS-HCC RAF calculation, which is hierarchical and
 * demographic-adjusted; see the module header.)
 */
export function computeRafScore(confirmed: Array<{ rafWeight: number }>): number {
  const total = confirmed.reduce((sum, h) => sum + (h.rafWeight || 0), 0);
  return Math.round(total * 1000) / 1000;
}

/**
 * Assess risk adjustment for a single patient's clinical context. DETERMINISTIC:
 * suspects the HCCs, computes the RAF-style score from the confirmed set, and
 * splits out coding gaps (suspected) and unsupported / over-coded flags — a pure
 * function of the context (no randomness, no clock), so the same context always
 * yields the same assessment. Every suspected code is a RECOMMENDATION
 * (requiresClinicianValidation:true) and the agent NEVER submits (submitted:false).
 */
export function assessRiskAdjustment(
  ctx: RiskAdjustmentContext
): RiskAdjustmentAssessment {
  const hccs = suspectHccs(ctx);
  const confirmed = hccs.filter((h) => h.status === "confirmed");
  const codingGaps = hccs.filter((h) => h.status === "suspected");
  const unsupportedFlags = hccs.filter((h) => h.status === "unsupported");
  const rafScore = computeRafScore(confirmed);

  const note =
    `Reviewed clinical documentation for ${ctx.patientRef}: ${confirmed.length} confirmed HCC${
      confirmed.length === 1 ? "" : "s"
    } (RAF ${rafScore.toFixed(3)}), ${codingGaps.length} suspected coding gap${
      codingGaps.length === 1 ? "" : "s"
    }, ${unsupportedFlags.length} unsupported / over-coded flag${
      unsupportedFlags.length === 1 ? "" : "s"
    }. Every suspected code is a RECOMMENDATION requiring clinician validation; every confirmed / suspected HCC traces to documented clinical evidence (no upcoding); the agent NEVER autonomously submits codes or adjusts a claim / RAF for reimbursement. Synthetic / illustrative HCC catalog, RAF weights, and evidence — NOT a certified risk-adjustment / coding engine.`;

  return {
    patientRef: ctx.patientRef,
    hccs,
    rafScore,
    codingGaps,
    unsupportedFlags,
    requiresClinicianValidation: true,
    submitted: false,
    synthetic: true,
    note
  };
}

/**
 * A risk-adjustment action a caller might ask the agent to take. "assess"
 * produces recommendations (the only thing the agent does on its own); "submit"
 * attempts to FINALIZE the codes / adjust the claim (which requires clinician
 * validation and is never something the agent does autonomously).
 */
export type RiskAdjustmentAction = {
  /** "assess" drafts recommendations; "submit" attempts to file codes / adjust the RAF. */
  kind: "assess" | "submit";
  /** For a submit, whether a clinician validated the suspected codes first. */
  clinicianValidated?: boolean;
  /** Whether the codes were already submitted / the claim already adjusted (always illegitimate for the agent). */
  submitted?: boolean;
};

/**
 * Evidence-supported-coding (no-upcoding) signal: does EVERY confirmed / suspected
 * HCC trace to the full documented clinical evidence the catalog defines? TRUE for
 * anything assessRiskAdjustment() produces (an unsupported HCC is exempt — it is
 * honestly flagged as unsupported and makes no support claim; a confirmed /
 * suspected HCC always carries its full catalog evidence). The guard that catches
 * a caller-asserted fabricated / unsupported code PRESENTED AS supported (an
 * off-catalog HCC, or a confirmed / suspected HCC whose evidence doesn't cover the
 * catalog's required set — upcoding). The route reports this to
 * policy.riskadj.evidence-supported-coding. A non-array input is a violation.
 */
export function codesTraceToClinicalEvidence(
  hccs:
    | Array<{
        hccId?: string;
        status?: string;
        supportingEvidence?: Array<{ id?: string } | string>;
      }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(hccs)) return false;
  return hccs.every((h) => {
    // Only confirmed / suspected codes CLAIM support; an unsupported flag is an
    // honest output and is exempt.
    if (h.status !== "confirmed" && h.status !== "suspected") return true;
    if (!isCatalogHcc(h.hccId)) return false;
    const evidenceIds = Array.isArray(h.supportingEvidence)
      ? h.supportingEvidence.map((e) =>
          typeof e === "string" ? e : e && typeof e.id === "string" ? e.id : ""
        )
      : [];
    return hccSupportedByEvidence(h.hccId, evidenceIds);
  });
}

/**
 * Clinician-validation-required signal: is a code action gated on clinician
 * validation? TRUE for an assess (drafting recommendations is fine) and for a
 * submit a clinician validated; FALSE for a submit that skips clinician
 * validation (treating a suspected code as validated without a clinician). The
 * route reports this to policy.riskadj.clinician-validation-required, which blocks
 * when it is false — so a suspected code can never be used as final without a
 * clinician confirming it.
 */
export function codingRequiresClinicianValidation(
  action?: RiskAdjustmentAction | null
): boolean {
  if (!action || action.kind === "assess") return true;
  return action.kind === "submit" ? action.clinicianValidated === true : true;
}

/**
 * No-autonomous-submission signal: did the agent avoid autonomously submitting
 * codes / adjusting a claim? TRUE unless the action asserts an autonomous
 * submission / claim adjustment already happened (submitted:true). The agent is a
 * RECOMMENDER — there is no legitimate agent submission — so a submitted:true
 * assertion is always a violation. The route reports this to
 * policy.riskadj.no-autonomous-submission, which blocks when it is false — so the
 * agent can never submit a code or adjust a RAF for reimbursement on its own.
 */
export function noAutonomousCodeSubmission(
  action?: RiskAdjustmentAction | null
): boolean {
  if (!action) return true;
  return action.submitted !== true;
}

/**
 * A compact, trace-safe summary of an assessment — the shape stamped onto the
 * Agent Fabric trace + the response `meta`. Carries no free-text PII (ids, counts,
 * and the RAF score only).
 */
export function riskAdjustmentSummary(assessment: RiskAdjustmentAssessment): {
  patientRef: string;
  hccCount: number;
  confirmedCount: number;
  suspectedCount: number;
  unsupportedCount: number;
  rafScore: number;
  requiresClinicianValidation: boolean;
  submitted: boolean;
  synthetic: boolean;
} {
  return {
    patientRef: assessment.patientRef,
    hccCount: assessment.hccs.length,
    confirmedCount: assessment.hccs.filter((h) => h.status === "confirmed").length,
    suspectedCount: assessment.codingGaps.length,
    unsupportedCount: assessment.unsupportedFlags.length,
    rafScore: assessment.rafScore,
    requiresClinicianValidation: assessment.requiresClinicianValidation,
    submitted: assessment.submitted,
    synthetic: assessment.synthetic
  };
}

/**
 * A representative, deterministic demo context (illustrative). A midlife patient
 * with documented diabetes-with-complication and osteoporosis-with-fracture (both
 * already coded → confirmed) plus documented depression evidence that has NOT been
 * coded (→ a suspected coding gap) — so the happy path (confirmed HCCs + a RAF
 * score + a suspected coding gap, no unsupported flags) is demonstrable. Synthetic /
 * de-identified patient ref.
 */
export const DEMO_RISK_ADJUSTMENT_CONTEXT: RiskAdjustmentContext = {
  patientRef: "riskadj-patient-001",
  documentedEvidence: [
    "evidence.a1c-elevated",
    "evidence.diabetic-complication",
    "evidence.dexa-tscore-osteoporosis",
    "evidence.fragility-fracture",
    "evidence.phq9-moderate-plus",
    "evidence.depression-treatment"
  ],
  codedConditions: ["hcc.diabetes-with-complication", "hcc.osteoporosis-fracture"]
};

/**
 * A representative over-coding demo context (illustrative). A patient with a COPD
 * diagnosis code on the claim but NO documented COPD evidence — so the unsupported /
 * over-coded integrity flag (a SAFE, honest output surfaced for clinician
 * correction, NOT a governance block) is demonstrable. Synthetic / de-identified.
 */
export const DEMO_OVERCODED_CONTEXT: RiskAdjustmentContext = {
  patientRef: "riskadj-patient-002",
  documentedEvidence: ["evidence.a1c-elevated", "evidence.diabetes-medication"],
  codedConditions: ["hcc.copd", "hcc.diabetes-without-complication"]
};
