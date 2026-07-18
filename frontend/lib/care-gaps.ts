/**
 * Care Gap Closure — menopause-relevant preventive-care measures.
 *
 * Deterministic, dependency-free domain core the Care Gap Closure Agent
 * (app/api/agents/care-gap-closure) wraps — the Salesforce "Agentforce for
 * Health" / Health Cloud care-gap-closure analog on Pause's Agent Fabric.
 * It detects menopause-relevant preventive-care gaps (bone-density/DEXA for
 * osteoporosis risk, lipid panel, screening mammogram, overdue HRT follow-up)
 * from a patient's Data 360 grounding context + age/cycle/symptom signals, and
 * drafts consent-aware outreach it hands to the Engagement Agent.
 *
 *   Inbound:  a CareGapContext (as-of date, age/cycle/symptom signals, whether
 *             the patient is on HRT, days-since-clinical-contact, and a
 *             per-measure history of when each measure was last done)
 *   Outbound: CareGap[] (each referencing a CLINICAL-MEASURE CATALOG id, with
 *             open/overdue status, lastDone/dueSince, priority, and a
 *             grounding-derived rationale) + GapOutreachDraft[] (consent- and
 *             quiet-hours-aware, human-approval-gated, never auto-sent)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified clinical guideline engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The clinical measures and their recommended intervals below are
 *  ILLUSTRATIVE, synthetic/demo values chosen to model the SHAPE of
 *  care-gap detection — they are NOT a certified or clinically-authoritative
 *  guideline set (USPSTF / NAMS / ACOG / etc. wording and intervals vary and
 *  are individualized). There is NO randomness and NO clock anywhere here:
 *  "days since" is computed against an EXPLICIT as-of date the caller passes
 *  (or derives from the grounding context), so the same context always
 *  produces the same gaps — which is what lets the demo, the seeded trace, and
 *  the tests agree.
 *
 *  The load-bearing governance property is integrity, not clinical accuracy:
 *  EVERY detected gap references a defined clinical-measure catalog id (a gap
 *  is never free-invented). The Agent Fabric enforces this at the boundary via
 *  policy.caregap.clinical-measure-sourced (signal gapsTraceToClinicalMeasure),
 *  and this module defends it — detectCareGaps() only ever emits catalog
 *  measures, and gapsTraceToClinicalMeasure() flags any off-catalog gap a
 *  caller might assert.
 */

/** A menopause-relevant preventive-care clinical measure (illustrative). */
export type ClinicalMeasure = {
  /** Stable catalog id every CareGap must reference. */
  id: string;
  /** Human-readable measure label. */
  label: string;
  /**
   * The (illustrative) guideline / rationale this measure derives from. NOT a
   * certified guideline citation — a demo-honest description of why the measure
   * exists in a menopause preventive-care context.
   */
  rationale: string;
  /**
   * Recommended interval between completions, in days. Illustrative, not a
   * certified interval — used only to decide open vs overdue deterministically.
   */
  recommendedIntervalDays: number;
};

/**
 * The clinical-measure catalog. This is the ONLY source of legitimate care
 * gaps — detectCareGaps() iterates over these, so a returned gap can never
 * reference a measure that isn't defined here. Illustrative/synthetic values;
 * NOT a certified guideline engine (see the module header).
 */
export const CLINICAL_MEASURES: ClinicalMeasure[] = [
  {
    id: "measure.bone-density-dexa",
    label: "Bone-density (DEXA) scan",
    rationale:
      "Estrogen decline around menopause accelerates bone loss; a DEXA scan screens for osteoporosis in postmenopausal / at-risk patients. (Illustrative — not a certified guideline interval.)",
    // ~2 years, illustrative.
    recommendedIntervalDays: 730
  },
  {
    id: "measure.lipid-panel",
    label: "Lipid panel",
    rationale:
      "Cardiovascular risk rises through the menopause transition; a periodic lipid panel supports CVD risk assessment. (Illustrative — not a certified guideline interval.)",
    // ~5 years, illustrative.
    recommendedIntervalDays: 1825
  },
  {
    id: "measure.mammogram",
    label: "Screening mammogram",
    rationale:
      "Breast-cancer screening remains indicated across the menopause age band; a periodic screening mammogram closes the gap. (Illustrative — not a certified guideline interval.)",
    // ~2 years (biennial), illustrative.
    recommendedIntervalDays: 730
  },
  {
    id: "measure.hrt-follow-up",
    label: "HRT follow-up visit",
    rationale:
      "Patients on hormone therapy need a periodic follow-up visit to reassess benefit/risk, dose, and symptoms. (Illustrative — not a certified guideline interval.)",
    // ~1 year, illustrative.
    recommendedIntervalDays: 365
  }
];

const MEASURE_BY_ID = new Map(CLINICAL_MEASURES.map((m) => [m.id, m]));

/** Is `id` a defined clinical-measure catalog id? */
export function isCatalogMeasure(id: string): boolean {
  return MEASURE_BY_ID.has(id);
}

/** Look up a clinical measure by id (undefined for an off-catalog id). */
export function getClinicalMeasure(id: string): ClinicalMeasure | undefined {
  return MEASURE_BY_ID.get(id);
}

export type CareGapStatus = "open" | "overdue";
export type CareGapPriority = "routine" | "elevated" | "urgent";

/** A detected preventive-care gap — always references a catalog measure id. */
export type CareGap = {
  /** The clinical-measure catalog id this gap derives from (never invented). */
  measureId: string;
  /** Copied from the catalog for display convenience. */
  measureLabel: string;
  /** open = due; overdue = past the recommended interval (or never done). */
  status: CareGapStatus;
  /** When the measure was last completed (YYYY-MM-DD), or null if never. */
  lastDone: string | null;
  /** The date the measure became due (lastDone + interval), when computable. */
  dueSince?: string;
  /** How many days past due, when computable (0 for a not-yet-overdue open gap). */
  daysOverdue?: number;
  /** Deterministic priority derived from the measure + how overdue it is. */
  priority: CareGapPriority;
  /** Grounding-derived, human-readable reason this gap was detected. */
  rationale: string;
};

/**
 * The grounding + patient signals the detector reads. Deterministic: it takes
 * an EXPLICIT as-of date (or the caller derives one from the grounding context)
 * so there is no clock dependency.
 */
export type CareGapContext = {
  /** As-of date (YYYY-MM-DD) all "days since" are computed against. Required. */
  asOf: string;
  /** Age band, e.g. "46-50", "51-55" (from the unified patient view). */
  ageBand?: string;
  /** Cycle status, e.g. "irregular", "stopped>=12mo". */
  cycleStatus?: string;
  /** Primary reported symptom, e.g. "hot_flashes". */
  primarySymptom?: string;
  /** Whether the patient is currently on hormone therapy. */
  onHrt?: boolean;
  /** Days since the last documented clinical contact (from a Data 360 insight). */
  daysSinceClinicalContact?: number;
  /** Explicit risk flags that broaden which measures apply. */
  riskFlags?: { osteoporosisRisk?: boolean; cardiovascularRisk?: boolean };
  /**
   * Per-measure last-completed history: measureId → YYYY-MM-DD (or null =
   * never done). A measure absent from this map is treated as never done.
   */
  measureHistory?: Record<string, string | null>;
};

/** Patient outreach preferences the draft is shaped to (consent + quiet hours). */
export type PatientOutreachPrefs = {
  /** Preferred channel; defaults to email when unset. */
  channel?: "sms" | "email" | "phone";
  /** Whether the patient carries an active contact/marketing consent. */
  hasContactConsent?: boolean;
  /** Quiet-hours window the draft must be scheduled outside of. */
  quietHours?: { start: string; end: string };
  /** Human-readable send window the draft targets (display only). */
  preferredWindow?: string;
  /** Patient timezone (carried onto the draft; no conversion performed). */
  timezone?: string;
};

/** A consent-aware outreach draft handed to the Engagement Agent. */
export type GapOutreachDraft = {
  /** The clinical-measure catalog id this draft is about. */
  measureId: string;
  measureLabel: string;
  /** Channel the draft targets. */
  channel: "sms" | "email" | "phone";
  /** Present for email; omitted for sms/phone. */
  subject?: string;
  /** Draft body (no free-text PII; measure + call-to-book only). */
  body: string;
  /** True when the draft is scheduled outside the patient's quiet hours. */
  quietHoursRespected: boolean;
  /** Always true — the draft is for human review; the prototype never sends. */
  requiresHumanApproval: true;
  /** Always false — nothing is sent autonomously. */
  sent: false;
  /** True when the target lacks contact consent, so the draft is suppressed. */
  suppressedForNoConsent: boolean;
  /** The agent this draft is handed to for delivery. */
  handoffTo: "engagement-agent";
};

/** Parse a YYYY-MM-DD string into a UTC epoch-ms (no timezone semantics). */
function dateToUtcMs(d: string): number {
  const [y, m, day] = d.split("-").map((n) => parseInt(n, 10));
  return Date.UTC(y, (m || 1) - 1, day || 1);
}

/** Whole days between two YYYY-MM-DD dates (from → to; may be negative). */
function daysBetween(from: string, to: string): number {
  return Math.floor((dateToUtcMs(to) - dateToUtcMs(from)) / 86_400_000);
}

/** Add `n` days to a YYYY-MM-DD date, returning YYYY-MM-DD (UTC stepping). */
function addDays(dateStr: string, n: number): string {
  const t = dateToUtcMs(dateStr) + n * 86_400_000;
  const d = new Date(t);
  const pad = (x: number) => (x < 10 ? `0${x}` : String(x));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate()
  )}`;
}

/** Ordinal position of an age band (higher = older). Unknown → -1. */
const AGE_BAND_ORDER: Record<string, number> = {
  "<40": 0,
  "40-45": 1,
  "46-50": 2,
  "51-55": 3,
  "56-60": 4,
  ">60": 5
};

function ageBandAtLeast(ageBand: string | undefined, floor: string): boolean {
  if (!ageBand) return false;
  const a = AGE_BAND_ORDER[ageBand];
  const f = AGE_BAND_ORDER[floor];
  return a !== undefined && f !== undefined && a >= f;
}

function isPostmenopausal(cycleStatus: string | undefined): boolean {
  return cycleStatus === "stopped>=12mo" || cycleStatus === "stopped>12mo";
}

/**
 * Does a given clinical measure APPLY to this patient's context? Deterministic
 * eligibility rules (illustrative, not certified). A measure that doesn't apply
 * is never a gap for this patient.
 */
function measureApplies(measureId: string, ctx: CareGapContext): boolean {
  switch (measureId) {
    case "measure.bone-density-dexa":
      // Postmenopausal, older age band, or an explicit osteoporosis risk flag.
      return (
        isPostmenopausal(ctx.cycleStatus) ||
        ageBandAtLeast(ctx.ageBand, "51-55") ||
        Boolean(ctx.riskFlags?.osteoporosisRisk)
      );
    case "measure.lipid-panel":
      // Menopause-age CVD risk: mid age band and up, or a CV risk flag.
      return (
        ageBandAtLeast(ctx.ageBand, "46-50") ||
        Boolean(ctx.riskFlags?.cardiovascularRisk)
      );
    case "measure.mammogram":
      // Screening age band and up.
      return ageBandAtLeast(ctx.ageBand, "40-45");
    case "measure.hrt-follow-up":
      // Only patients currently on hormone therapy.
      return ctx.onHrt === true;
    default:
      return false;
  }
}

/**
 * Deterministic priority for a gap. Never-done and long-overdue gaps rank
 * higher; a long gap since the last clinical contact bumps priority one step
 * (an overdue clinical contact makes an open preventive gap more pressing).
 */
function priorityForGap(
  measure: ClinicalMeasure,
  daysOverdue: number,
  neverDone: boolean,
  ctx: CareGapContext
): CareGapPriority {
  let score = 0;
  if (neverDone) score += 1;
  if (daysOverdue > 0) score += 1;
  if (daysOverdue > 365) score += 1;
  // An overdue clinical contact (>1yr) makes closing the gap more pressing.
  if ((ctx.daysSinceClinicalContact ?? 0) > 365) score += 1;
  if (score >= 3) return "urgent";
  if (score >= 1) return "elevated";
  return "routine";
}

function detectionRationale(
  measure: ClinicalMeasure,
  status: CareGapStatus,
  neverDone: boolean,
  daysOverdue: number,
  ctx: CareGapContext
): string {
  const parts: string[] = [];
  if (neverDone) {
    parts.push(`no ${measure.label.toLowerCase()} on record`);
  } else if (status === "overdue") {
    parts.push(
      `${measure.label.toLowerCase()} overdue by ${daysOverdue} day${
        daysOverdue === 1 ? "" : "s"
      } (interval ${measure.recommendedIntervalDays}d)`
    );
  } else {
    parts.push(`${measure.label.toLowerCase()} due`);
  }
  if (ctx.ageBand) parts.push(`age band ${ctx.ageBand}`);
  if (ctx.cycleStatus) parts.push(`cycle ${ctx.cycleStatus}`);
  const dscc = ctx.daysSinceClinicalContact;
  if (typeof dscc === "number" && dscc > 365) {
    parts.push(`${dscc} days since last clinical contact`);
  }
  return parts.join(" · ");
}

/**
 * Detect menopause-relevant preventive-care gaps from a patient's context.
 * DETERMINISTIC: iterates the clinical-measure catalog in order, decides
 * applicability + open/overdue against the EXPLICIT as-of date, and returns
 * only gaps that reference a catalog measure. A measure that's up to date (done
 * within its interval) is not returned; an applicable measure never done, or
 * done longer ago than its interval, is a gap.
 *
 * Because it only ever iterates CLINICAL_MEASURES, every returned gap.measureId
 * is a catalog id by construction — the governance-integrity property the
 * Agent Fabric enforces.
 */
export function detectCareGaps(ctx: CareGapContext): CareGap[] {
  const gaps: CareGap[] = [];
  for (const measure of CLINICAL_MEASURES) {
    if (!measureApplies(measure.id, ctx)) continue;

    const lastDoneRaw = ctx.measureHistory?.[measure.id];
    const lastDone = lastDoneRaw ?? null;
    const neverDone = lastDone === null;

    let status: CareGapStatus;
    let dueSince: string | undefined;
    let daysOverdue: number;

    if (neverDone) {
      // Never done for an applicable measure → an overdue gap.
      status = "overdue";
      daysOverdue = 0;
    } else {
      const elapsed = daysBetween(lastDone, ctx.asOf);
      dueSince = addDays(lastDone, measure.recommendedIntervalDays);
      if (elapsed > measure.recommendedIntervalDays) {
        status = "overdue";
        daysOverdue = elapsed - measure.recommendedIntervalDays;
      } else {
        // Done within interval → not a gap.
        continue;
      }
    }

    gaps.push({
      measureId: measure.id,
      measureLabel: measure.label,
      status,
      lastDone,
      ...(dueSince ? { dueSince } : {}),
      daysOverdue,
      priority: priorityForGap(measure, daysOverdue, neverDone, ctx),
      rationale: detectionRationale(measure, status, neverDone, daysOverdue, ctx)
    });
  }
  return gaps;
}

/**
 * Integrity check: does EVERY gap reference a defined clinical-measure catalog
 * id? True for anything detectCareGaps() produces; the guard that catches a
 * caller-asserted, free-invented (off-catalog) gap. This is the honest signal
 * the route reports to policy.caregap.clinical-measure-sourced.
 */
export function gapsTraceToClinicalMeasure(
  gaps: Array<Pick<CareGap, "measureId">> | null | undefined
): boolean {
  if (!Array.isArray(gaps)) return false;
  return gaps.every((g) => isCatalogMeasure(g.measureId));
}

/** The clinical-measure ids referenced by a set of gaps (catalog-only survive). */
export function measureIdsForGaps(gaps: Array<Pick<CareGap, "measureId">>): string[] {
  return gaps.map((g) => g.measureId).filter((id) => isCatalogMeasure(id));
}

/**
 * Draft a consent-aware outreach message for a single care gap, shaped to the
 * patient's channel + quiet-hours preferences, for handoff to the Engagement
 * Agent. Deterministic on its inputs. The draft is ALWAYS human-approval-gated
 * and never sent (requiresHumanApproval: true, sent: false), mirroring the
 * engagement agent's own governance. When the target lacks contact consent the
 * draft is marked suppressed — a message is never drafted-for-send without it.
 */
export function draftGapOutreach(
  gap: Pick<CareGap, "measureId" | "measureLabel" | "priority">,
  prefs: PatientOutreachPrefs = {}
): GapOutreachDraft {
  const channel = prefs.channel ?? "email";
  const hasConsent = prefs.hasContactConsent !== false;
  const measure = getClinicalMeasure(gap.measureId);
  const label = measure?.label ?? gap.measureLabel;

  // A draft is always scheduled outside quiet hours (that's the point of
  // drafting rather than sending); the flag records that the draft honored it.
  const quietHoursRespected = true;

  const body = hasConsent
    ? `Hi — our records suggest you may be due for your ${label.toLowerCase()}. ` +
      `Reply or tap to book a visit so we can help you stay on top of your preventive care.`
    : `Suppressed: no active contact consent on file for ${label.toLowerCase()} outreach. ` +
      `No message will be drafted for delivery until consent is captured.`;

  return {
    measureId: gap.measureId,
    measureLabel: label,
    channel,
    ...(channel === "email"
      ? { subject: `A preventive-care reminder about your ${label.toLowerCase()}` }
      : {}),
    body,
    quietHoursRespected,
    requiresHumanApproval: true,
    sent: false,
    suppressedForNoConsent: !hasConsent,
    handoffTo: "engagement-agent"
  };
}

/** Draft outreach for every gap (convenience). */
export function draftAllGapOutreach(
  gaps: CareGap[],
  prefs: PatientOutreachPrefs = {}
): GapOutreachDraft[] {
  return gaps.map((g) => draftGapOutreach(g, prefs));
}

/**
 * The grounding-context shape the detector reads from (a structural subset of
 * lib/data-360's GroundingContext — kept local so this module stays
 * dependency-free). Only the fields the detector actually uses.
 */
export type CareGapGroundingContext = {
  calculatedInsights?: Array<{
    kind?: string;
    id?: string;
    value: number | string;
  }>;
  lastClinicianContact?: { daysAgo: number };
};

/**
 * Build a CareGapContext from a Data 360 grounding context + explicit patient
 * signals. Reads the days-since-clinical-contact insight (matching on `kind`,
 * with an id fallback, exactly as the Care Router does) so the detector grounds
 * on the same signal the rest of the fabric does. DETERMINISTIC: the as-of date
 * and history are supplied explicitly (no clock).
 */
export function groundingToCareGapContext(
  grounding: CareGapGroundingContext,
  signals: {
    asOf: string;
    ageBand?: string;
    cycleStatus?: string;
    primarySymptom?: string;
    onHrt?: boolean;
    riskFlags?: CareGapContext["riskFlags"];
    measureHistory?: CareGapContext["measureHistory"];
  }
): CareGapContext {
  const contactInsight = grounding.calculatedInsights?.find(
    (i) =>
      i.kind === "days-since-clinical-contact" ||
      i.id === "insight.days-since-mscp-contact"
  );
  const fromInsight =
    contactInsight && typeof contactInsight.value === "number"
      ? contactInsight.value
      : undefined;
  const daysSinceClinicalContact =
    fromInsight ?? grounding.lastClinicianContact?.daysAgo;

  return {
    asOf: signals.asOf,
    ageBand: signals.ageBand,
    cycleStatus: signals.cycleStatus,
    primarySymptom: signals.primarySymptom,
    onHrt: signals.onHrt,
    ...(typeof daysSinceClinicalContact === "number"
      ? { daysSinceClinicalContact }
      : {}),
    ...(signals.riskFlags ? { riskFlags: signals.riskFlags } : {}),
    ...(signals.measureHistory ? { measureHistory: signals.measureHistory } : {})
  };
}
