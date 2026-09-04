/**
 * Lab Result & Critical-Value Notification — the deterministic, transparent
 * result-management layer that classifies a discrete diagnostic lab result against a
 * reference-range + critical-threshold catalog and, when a value is CRITICAL (a "panic"
 * value), requires mandatory clinician notification.
 *
 * Deterministic, dependency-free domain core the Lab Result & Critical-Value
 * Notification Agent (app/api/agents/lab-result) wraps — a clinical-decision service on
 * the patient/clinical plane of Pause's Agent Fabric, a deterministic sibling to the
 * live-Claude Care Router. Given a discrete lab result (an analyte id + numeric value +
 * unit, with the patient + provider references), it DETERMINISTICALLY classifies the
 * value against the analyte's reference range + critical thresholds as normal /
 * abnormal-high / abnormal-low / critical-high / critical-low, flags whether the result
 * requires mandatory provider notification, and flags whether it requires clinician
 * review. It NEVER autonomously acts on a result (it does not order, treat, or change a
 * care plan — an abnormal / critical result is escalated to a clinician), and a CRITICAL
 * value can NEVER be suppressed or auto-closed — it must trigger clinician notification.
 *
 *   Inbound:  a LabResultRequest { patientRef, providerRef, analyteId, value, unit }
 *   Outbound: a LabResultDetermination { classification, isCritical,
 *             requiresProviderNotification, requiresClinicianReview, refLow, refHigh,
 *             criticalLow, criticalHigh, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other clinical / care agents: distinct
 * from the Remote Patient Monitoring agent (which handles continuous wearable / RPM
 * streams), the Clinical Summary agent (which summarizes a chart), and the Care Gap
 * Closure agent (which finds missing preventive measures), this manages DISCRETE
 * diagnostic LAB results and the critical-value notification workflow.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: a critical value must be notified — never suppressed.
 * ─────────────────────────────────────────────────────────────────────
 *  A CRITICAL (panic) value must trigger mandatory clinician notification — it can never
 *  be suppressed, auto-closed, or resolved without notification. CLIA §493.1291(g)
 *  requires the lab to immediately alert the responsible provider of a critical value.
 *  labCriticalValueNotified() reports the honest signal the Agent Fabric enforces via
 *  policy.lab.critical-value-notified. (Mirrors the Care Coordination Handoff Agent's
 *  SBAR-completeness — a life-safety obligation that cannot be skipped.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: every classification is reference-range-sourced.
 * ─────────────────────────────────────────────────────────────────────
 *  Every classification must cite the analyte's recorded reference range + critical
 *  thresholds from the catalog — there is no ad-hoc, un-sourced result interpretation.
 *  labRangeCited() reports the honest signal the Agent Fabric enforces via
 *  policy.lab.reference-range-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous clinical action (clinician-review-gated).
 * ─────────────────────────────────────────────────────────────────────
 *  The agent NEVER autonomously acts on a result — it does not order a test, prescribe,
 *  treat, or change a care plan. Any abnormal / critical result is a flag escalated for
 *  clinician review. labClinicianReviewed() reports the honest signal the Agent Fabric
 *  enforces via policy.lab.no-autonomous-clinical-action.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE RESULT vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A classification — even a CRITICAL one — is a SAFE, honest OUTPUT: the task COMPLETES
 *  (a critical result carries requiresProviderNotification:true, an abnormal/critical
 *  result carries requiresClinicianReview:true). A GOVERNANCE BLOCK is when a caller
 *  PRESENTS an offending DETERMINATION (a critical value flagged as not requiring
 *  notification, a classification with no cited reference range, or a non-normal result
 *  flagged as not requiring clinician review) — which the Agent Fabric rejects before it
 *  can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified laboratory information system.
 * ─────────────────────────────────────────────────────────────────────
 *  The analyte catalog, reference ranges, units, and critical thresholds below are
 *  ILLUSTRATIVE synthetic/demo values chosen to model the SHAPE of a governed
 *  critical-value control — they are NOT a certified laboratory information system (LIS)
 *  or a CLIA-validated critical-value policy, and REAL reference ranges + critical
 *  thresholds are method-, instrument-, and population-specific and are set by each
 *  laboratory's medical director under CLIA (42 CFR 493) + CAP accreditation. The
 *  patient / provider references are synthetic / de-identified. There is NO randomness
 *  and NO clock anywhere here: the classification is a pure function of the value + the
 *  analyte's catalog range (no Date.now()), so the same result always yields the same
 *  classification + notification + review flags — which is what lets the demo, the
 *  seeded trace, and the tests agree.
 */

/** The classification the agent produces for a lab value. */
export type ResultClassification =
  | "normal"
  | "abnormal-high"
  | "abnormal-low"
  | "critical-high"
  | "critical-low";

/**
 * A single analyte in the catalog — a test mapped to its reference range + critical
 * thresholds. Illustrative/synthetic; NOT a certified reference-range set (see the header).
 */
export type LabAnalyte = {
  /** Stable catalog id (cited on every determination). */
  id: string;
  /** Human-readable analyte label. */
  label: string;
  /** The unit the range + thresholds are expressed in. */
  unit: string;
  /** Lower bound of the normal reference range (inclusive). */
  refLow: number;
  /** Upper bound of the normal reference range (inclusive). */
  refHigh: number;
  /** At or below this value is a critical-low (panic) value. */
  criticalLow: number;
  /** At or above this value is a critical-high (panic) value. */
  criticalHigh: number;
  /** Illustrative description of what this analyte governs. Demo-honest. */
  description: string;
};

/**
 * The analyte catalog — every classification cites one of these. Illustrative/synthetic
 * values approximating common adult chemistry/hematology panic values; NOT a certified
 * reference-range set (see the header). Menopause-relevant: the electrolyte / glucose /
 * calcium / hemoglobin panel a midlife patient on HRT or under bone-health monitoring
 * routinely has drawn.
 */
export const LAB_ANALYTES: LabAnalyte[] = [
  {
    id: "analyte.potassium",
    label: "Potassium (K+)",
    unit: "mmol/L",
    refLow: 3.5,
    refHigh: 5.1,
    criticalLow: 2.5,
    criticalHigh: 6.5,
    description:
      "Serum potassium. Critical low ≤2.5 or high ≥6.5 mmol/L risks life-threatening arrhythmia. (Illustrative.)"
  },
  {
    id: "analyte.sodium",
    label: "Sodium (Na+)",
    unit: "mmol/L",
    refLow: 136,
    refHigh: 145,
    criticalLow: 120,
    criticalHigh: 160,
    description:
      "Serum sodium. Critical low ≤120 or high ≥160 mmol/L risks cerebral edema / neurologic injury. (Illustrative.)"
  },
  {
    id: "analyte.glucose",
    label: "Glucose (fasting)",
    unit: "mg/dL",
    refLow: 70,
    refHigh: 99,
    criticalLow: 40,
    criticalHigh: 500,
    description:
      "Fasting plasma glucose. Critical low ≤40 or high ≥500 mg/dL is a medical emergency. (Illustrative.)"
  },
  {
    id: "analyte.calcium",
    label: "Calcium (total)",
    unit: "mg/dL",
    refLow: 8.6,
    refHigh: 10.2,
    criticalLow: 6.0,
    criticalHigh: 13.0,
    description:
      "Total serum calcium (bone-health relevant in midlife). Critical low ≤6.0 or high ≥13.0 mg/dL. (Illustrative.)"
  },
  {
    id: "analyte.hemoglobin",
    label: "Hemoglobin (female)",
    unit: "g/dL",
    refLow: 12,
    refHigh: 16,
    criticalLow: 7,
    criticalHigh: 20,
    description:
      "Hemoglobin (adult female range). Critical low ≤7 (symptomatic anemia) or high ≥20 g/dL. (Illustrative.)"
  }
];

const ANALYTE_BY_ID = new Map(LAB_ANALYTES.map((a) => [a.id, a]));
const ANALYTE_IDS = new Set<string>(LAB_ANALYTES.map((a) => a.id));

/** Is `id` a recognized analyte id? */
export function isLabAnalyte(id: unknown): boolean {
  return typeof id === "string" && ANALYTE_IDS.has(id);
}

/** Look up an analyte by id (undefined for an off-catalog id). */
export function getLabAnalyte(id: string): LabAnalyte | undefined {
  return ANALYTE_BY_ID.get(id);
}

/** A discrete lab-result classification request. */
export type LabResultRequest = {
  /** Synthetic, de-identified patient reference. */
  patientRef: string;
  /** Synthetic, de-identified ordering-provider reference. */
  providerRef: string;
  /** The analyte (a catalog id, or an off-catalog string). */
  analyteId: string;
  /** The numeric result value. */
  value: number;
  /** The unit the value is expressed in (illustrative / informational). */
  unit?: string;
};

/** The deterministic lab-result determination the agent returns. */
export type LabResultDetermination = {
  /** Synthetic, de-identified patient reference. */
  patientRef: string;
  /** Synthetic, de-identified ordering-provider reference. */
  providerRef: string;
  /** The cited analyte id (always a recognized analyte for a valid classification). */
  analyteId: string;
  /** The analyte's human-readable label. */
  analyteLabel: string;
  /** The result value evaluated. */
  value: number;
  /** The unit evaluated. */
  unit: string;
  /** The classification. */
  classification: ResultClassification;
  /** The analyte's normal-range lower bound (NaN when the analyte is off-catalog). */
  refLow: number;
  /** The analyte's normal-range upper bound (NaN when the analyte is off-catalog). */
  refHigh: number;
  /** The analyte's critical-low threshold (NaN when the analyte is off-catalog). */
  criticalLow: number;
  /** The analyte's critical-high threshold (NaN when the analyte is off-catalog). */
  criticalHigh: number;
  /** True when the classification is critical-high or critical-low. */
  isCritical: boolean;
  /** True whenever the result is critical — a critical value must be notified. */
  requiresProviderNotification: boolean;
  /** True whenever the result is not normal — an abnormal/critical result needs clinician review. */
  requiresClinicianReview: boolean;
  /** Human-readable reason (cites the deciding factor). */
  reason: string;
  /** Always true — the analyte catalog + ranges are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Stable reason phrases (kept as constants for testability). */
export const LAB_REASON_TEXT = {
  normal: "within the analyte's reference range — a normal result",
  abnormalHigh:
    "above the analyte's reference range (but below the critical threshold) — an abnormal-high result requiring clinician review",
  abnormalLow:
    "below the analyte's reference range (but above the critical threshold) — an abnormal-low result requiring clinician review",
  criticalHigh:
    "at or above the analyte's critical-high threshold — a CRITICAL (panic) value requiring mandatory clinician notification",
  criticalLow:
    "at or below the analyte's critical-low threshold — a CRITICAL (panic) value requiring mandatory clinician notification",
  unsourced:
    "no reference range for this analyte — a classification must cite a recorded analyte reference range"
} as const;

/**
 * Classify a numeric value against an analyte's range + critical thresholds. Critical
 * thresholds take precedence over the reference range.
 */
export function classifyValue(analyte: LabAnalyte, value: number): ResultClassification {
  if (value <= analyte.criticalLow) return "critical-low";
  if (value >= analyte.criticalHigh) return "critical-high";
  if (value < analyte.refLow) return "abnormal-low";
  if (value > analyte.refHigh) return "abnormal-high";
  return "normal";
}

/**
 * The deterministic lab-result function — the heart of the service. DETERMINISTIC: a
 * pure function of the value + the analyte's catalog range (no randomness, no clock). It
 * resolves the analyte, classifies the value (critical thresholds first, then the
 * reference range), and flags whether the result requires mandatory provider
 * notification (critical values) and clinician review (any non-normal result). An
 * off-catalog analyte yields a `normal` placeholder that the labRangeCited() guard
 * catches — the agent never interprets a result without a cited reference range. Nothing
 * is ordered, treated, or resolved here — this produces a flag, not a clinical action.
 */
export function evaluateLabResult(request: LabResultRequest): LabResultDetermination {
  const analyte = getLabAnalyte(request.analyteId);
  const value = typeof request.value === "number" ? request.value : NaN;

  const synthNote =
    "Synthetic/illustrative analyte catalog, reference ranges, units, and critical thresholds — NOT a certified laboratory information system or CLIA-validated critical-value policy; real ranges are method-/instrument-/population-specific and set by the laboratory's medical director under CLIA (42 CFR 493).";

  if (!analyte) {
    // Off-catalog analyte: well-formed but un-sourced. The labRangeCited() guard catches
    // it. We classify as normal (the safe default) and require no notification/review,
    // because we have no range to interpret against.
    return {
      patientRef: request.patientRef,
      providerRef: request.providerRef,
      analyteId: request.analyteId,
      analyteLabel: request.analyteId,
      value,
      unit: request.unit ?? "",
      classification: "normal",
      refLow: NaN,
      refHigh: NaN,
      criticalLow: NaN,
      criticalHigh: NaN,
      isCritical: false,
      requiresProviderNotification: false,
      requiresClinicianReview: false,
      reason: LAB_REASON_TEXT.unsourced,
      synthetic: true,
      note: `Result for ${request.patientRef}: analyte ${request.analyteId} is not in the reference-range catalog. ` + synthNote
    };
  }

  const classification = classifyValue(analyte, value);
  const isCritical = classification === "critical-high" || classification === "critical-low";
  const requiresClinicianReview = classification !== "normal";

  const reason =
    classification === "normal"
      ? LAB_REASON_TEXT.normal
      : classification === "abnormal-high"
        ? LAB_REASON_TEXT.abnormalHigh
        : classification === "abnormal-low"
          ? LAB_REASON_TEXT.abnormalLow
          : classification === "critical-high"
            ? LAB_REASON_TEXT.criticalHigh
            : LAB_REASON_TEXT.criticalLow;

  return {
    patientRef: request.patientRef,
    providerRef: request.providerRef,
    analyteId: analyte.id,
    analyteLabel: analyte.label,
    value,
    unit: request.unit ?? analyte.unit,
    classification,
    refLow: analyte.refLow,
    refHigh: analyte.refHigh,
    criticalLow: analyte.criticalLow,
    criticalHigh: analyte.criticalHigh,
    isCritical,
    requiresProviderNotification: isCritical,
    requiresClinicianReview,
    reason,
    synthetic: true,
    note:
      `Result for ${request.patientRef}: ${analyte.label} = ${value} ${analyte.unit} → ${classification} ` +
      `(ref ${analyte.refLow}–${analyte.refHigh}, critical ≤${analyte.criticalLow} / ≥${analyte.criticalHigh}). ` +
      (isCritical
        ? "A CRITICAL value requiring mandatory clinician notification. "
        : requiresClinicianReview
          ? "An abnormal result requiring clinician review. "
          : "") +
      synthNote
  };
}

/**
 * Critical-value-notified check: is a critical result flagged for mandatory notification?
 * True unless a determination asserts a critical value that does NOT require provider
 * notification — the guard that catches a caller-asserted suppressed / auto-closed panic
 * value. Anything evaluateLabResult() produces satisfies it (a critical result always
 * requires notification). This is the honest signal the route reports to
 * policy.lab.critical-value-notified. A non-object input is a violation.
 */
export function labCriticalValueNotified(
  determination:
    | Pick<LabResultDetermination, "isCritical" | "requiresProviderNotification">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return !(
    determination.isCritical === true &&
    determination.requiresProviderNotification === false
  );
}

/**
 * Reference-range-sourced check: does the determination cite a recorded analyte range?
 * True when the analyteId is a recognized catalog analyte; the guard that catches a
 * caller-asserted ad-hoc result interpretation with no cited reference range (a missing
 * or off-catalog analyte id). Anything evaluateLabResult() produces from a catalog
 * analyte satisfies it. This is the honest signal the route reports to
 * policy.lab.reference-range-sourced. A non-object input is a violation.
 */
export function labRangeCited(
  determination: Pick<LabResultDetermination, "analyteId"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return isLabAnalyte(determination.analyteId);
}

/**
 * No-autonomous-clinical-action check: is a non-normal result escalated for clinician
 * review? True for any normal result, and for a non-normal result that carries
 * requiresClinicianReview:true; the guard that catches a caller-asserted AUTONOMOUS
 * action on a result (a non-normal result flagged as not requiring clinician review — the
 * agent purporting to resolve / act on an abnormal result itself). Anything
 * evaluateLabResult() produces satisfies it (a non-normal result always requires review).
 * This is the honest signal the route reports to policy.lab.no-autonomous-clinical-action.
 * A non-object input is a violation.
 */
export function labClinicianReviewed(
  determination:
    | Pick<LabResultDetermination, "classification" | "requiresClinicianReview">
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (determination.classification === "normal") return true;
  return determination.requiresClinicianReview === true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent
 * Fabric trace + the response `meta`. Carries no free-text PHI (refs, the analyte, the
 * value, the classification, and the flags only).
 */
export function labResultSummary(determination: LabResultDetermination): {
  patientRef: string;
  providerRef: string;
  analyteId: string;
  value: number;
  classification: ResultClassification;
  isCritical: boolean;
  requiresProviderNotification: boolean;
  requiresClinicianReview: boolean;
  synthetic: boolean;
} {
  return {
    patientRef: determination.patientRef,
    providerRef: determination.providerRef,
    analyteId: determination.analyteId,
    value: determination.value,
    classification: determination.classification,
    isCritical: determination.isCritical,
    requiresProviderNotification: determination.requiresProviderNotification,
    requiresClinicianReview: determination.requiresClinicianReview,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request (illustrative). A normal potassium. Synthetic /
 * de-identified.
 */
export const DEMO_LAB_RESULT_REQUEST: LabResultRequest = {
  patientRef: "lab-patient-001",
  providerRef: "lab-provider-001",
  analyteId: "analyte.potassium",
  value: 4.2,
  unit: "mmol/L"
};

/**
 * A representative demo CRITICAL request (illustrative). A critical-high potassium →
 * mandatory clinician notification. Synthetic / de-identified.
 */
export const DEMO_LAB_RESULT_CRITICAL_REQUEST: LabResultRequest = {
  patientRef: "lab-patient-002",
  providerRef: "lab-provider-002",
  analyteId: "analyte.potassium",
  value: 6.8,
  unit: "mmol/L"
};

/**
 * A representative demo ABNORMAL (non-critical) request (illustrative). An abnormal-high
 * fasting glucose → clinician review, no mandatory notification. Synthetic / de-identified.
 */
export const DEMO_LAB_RESULT_ABNORMAL_REQUEST: LabResultRequest = {
  patientRef: "lab-patient-003",
  providerRef: "lab-provider-003",
  analyteId: "analyte.glucose",
  value: 180,
  unit: "mg/dL"
};

/**
 * A representative demo critical-LOW request (illustrative). A critical-low sodium →
 * mandatory clinician notification. Synthetic / de-identified.
 */
export const DEMO_LAB_RESULT_CRITICAL_LOW_REQUEST: LabResultRequest = {
  patientRef: "lab-patient-004",
  providerRef: "lab-provider-004",
  analyteId: "analyte.sodium",
  value: 118,
  unit: "mmol/L"
};
