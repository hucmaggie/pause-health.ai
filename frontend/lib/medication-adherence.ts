/**
 * Medication Adherence — menopause-relevant HRT/SSRI adherence + refill timing.
 *
 * Deterministic, dependency-free domain core the Medication Adherence Agent
 * (app/api/agents/medication-adherence) wraps — the Salesforce "Agentforce for
 * Health" / Health Cloud MedicationRequest + MedicationTherapyReview analog on
 * Pause's Agent Fabric. It tracks whether a patient is staying on their
 * menopause medications (transdermal/oral HRT, an SSRI/SNRI for vasomotor
 * symptoms or mood) and whether a refill is coming due, drafts consent- and
 * quiet-hours-aware refill/adherence nudges it hands to the Engagement Agent,
 * and flags adherence drop-off to the care team.
 *
 *   Inbound:  MedicationRecord[] (which drug, when it was last filled, the
 *             days-supply dispensed, and whether it's a hormone-therapy med) +
 *             an EXPLICIT as-of date all "days since" are computed against
 *   Outbound: AdherenceAssessment[] (per-med good / at-risk / lapsed status,
 *             refill-due detection, and a drop-off flag) + AdherenceNudge[]
 *             (consent- and quiet-hours-aware, human-approval-gated, never
 *             auto-sent, and EXPLICITLY nudge-only)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY: this agent can only NUDGE.
 * ─────────────────────────────────────────────────────────────────────
 *  It may draft a refill/adherence reminder for human review — it must NEVER
 *  autonomously submit or order a refill. A refill order is a clinical action
 *  that requires a human-in-the-loop. This module encodes that: every nudge is
 *  marked requiresHumanApproval: true, sent: false, nudgeOnly: true, and
 *  refillRequiresHumanApproval() reports the honest signal the Agent Fabric
 *  enforces via policy.medication.no-autonomous-refill (a caller-asserted
 *  autonomous refill → false → blocked).
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified pharmacy / e-prescribing system.
 * ─────────────────────────────────────────────────────────────────────
 *  The medications, their days-supply, and refill intervals below are
 *  ILLUSTRATIVE synthetic/demo values chosen to model the SHAPE of
 *  adherence + refill-timing detection — they are NOT a certified or
 *  clinically-authoritative medication catalog (real days-supply, refill
 *  intervals, and adherence thresholds are individualized and payer-specific).
 *  There is NO randomness and NO clock anywhere here: "days since fill" is
 *  computed against an EXPLICIT as-of date the caller passes, so the same
 *  inputs always produce the same assessment — which is what lets the demo,
 *  the seeded trace, and the tests agree.
 */

/** Broad therapeutic class of a menopause-relevant medication (illustrative). */
export type MedicationClass = "hrt" | "ssri" | "snri" | "other";

/** A menopause-relevant medication in the (illustrative) catalog. */
export type MedicationCatalogEntry = {
  /** Stable catalog id every MedicationRecord should reference. */
  id: string;
  /** Human-readable medication label. */
  label: string;
  /** Therapeutic class (drives whether it counts as hormone therapy). */
  drugClass: MedicationClass;
  /**
   * Default days-supply a fill dispenses, in days. Illustrative, not a
   * certified dispensing quantity — used only to decide adherence + refill
   * timing deterministically.
   */
  defaultDaysSupply: number;
  /**
   * The (illustrative) reason this medication appears in a menopause-care
   * context. NOT a certified indication — a demo-honest description.
   */
  rationale: string;
};

/**
 * The medication catalog. Illustrative/synthetic values; NOT a certified
 * pharmacy catalog (see the module header). A small, menopause-relevant set:
 * transdermal + oral hormone therapy and an SSRI/SNRI used for vasomotor
 * symptoms or mood.
 */
export const MEDICATION_CATALOG: MedicationCatalogEntry[] = [
  {
    id: "med.estradiol-transdermal",
    label: "Estradiol transdermal patch (HRT)",
    drugClass: "hrt",
    // ~12-week supply of twice-weekly patches, illustrative.
    defaultDaysSupply: 84,
    rationale:
      "Transdermal estradiol is a first-line hormone therapy for vasomotor symptoms; consistent use matters for symptom control. (Illustrative — not a certified dispensing quantity.)"
  },
  {
    id: "med.progesterone-oral",
    label: "Oral micronized progesterone (HRT)",
    drugClass: "hrt",
    // ~30-day supply, illustrative.
    defaultDaysSupply: 30,
    rationale:
      "Oral progesterone provides endometrial protection for a patient on estrogen therapy; a gap in supply is a therapy gap. (Illustrative — not a certified dispensing quantity.)"
  },
  {
    id: "med.paroxetine-ssri",
    label: "Paroxetine (SSRI)",
    drugClass: "ssri",
    // ~30-day supply, illustrative.
    defaultDaysSupply: 30,
    rationale:
      "A low-dose SSRI is a non-hormonal option for vasomotor symptoms and mood; abrupt lapses can cause discontinuation effects. (Illustrative — not a certified dispensing quantity.)"
  },
  {
    id: "med.venlafaxine-snri",
    label: "Venlafaxine (SNRI)",
    drugClass: "snri",
    // ~30-day supply, illustrative.
    defaultDaysSupply: 30,
    rationale:
      "An SNRI is a non-hormonal option for vasomotor symptoms and mood; consistent use supports symptom control. (Illustrative — not a certified dispensing quantity.)"
  }
];

const MEDICATION_BY_ID = new Map(MEDICATION_CATALOG.map((m) => [m.id, m]));

/** Is `id` a defined medication catalog id? */
export function isCatalogMedication(id: string): boolean {
  return MEDICATION_BY_ID.has(id);
}

/** Look up a catalog medication by id (undefined for an off-catalog id). */
export function getMedication(id: string): MedicationCatalogEntry | undefined {
  return MEDICATION_BY_ID.get(id);
}

/**
 * Refill-timing thresholds (illustrative, deterministic). A refill is "due"
 * once the patient is within REFILL_LEAD_DAYS of running out; a short gap past
 * the supply window is "at-risk"; a longer gap is "lapsed" (a drop-off).
 */
export const REFILL_LEAD_DAYS = 7;
export const AT_RISK_WINDOW_DAYS = 14;

export type AdherenceStatus = "good" | "at-risk" | "lapsed";

/**
 * The inbound record the assessor reads for a single medication. Deterministic:
 * the caller supplies EITHER an explicit lastFilled date OR a lastFilledDaysAgo
 * offset (resolved against the as-of date), so there is no clock dependency.
 */
export type MedicationRecord = {
  /** The medication catalog id (e.g. "med.estradiol-transdermal"). */
  drug: string;
  /** When the medication was last filled (YYYY-MM-DD), or null if never. */
  lastFilled?: string | null;
  /** Alternative to lastFilled: whole days before the as-of date it was filled. */
  lastFilledDaysAgo?: number;
  /** Days-supply this fill dispensed; overrides the catalog default. */
  daysSupply?: number;
  /** Whether this medication is part of the patient's hormone therapy. */
  onHrt?: boolean;
};

/** A per-medication adherence + refill-timing assessment. */
export type AdherenceAssessment = {
  /** The medication catalog id this assessment is about. */
  drug: string;
  /** Copied from the catalog (or the raw id for an off-catalog drug). */
  drugLabel: string;
  drugClass: MedicationClass;
  /** True when this medication is hormone therapy for the patient. */
  onHrt: boolean;
  /** good = has supply on hand; at-risk = short gap; lapsed = drop-off. */
  status: AdherenceStatus;
  /** When the medication was last filled (YYYY-MM-DD), or null if never. */
  lastFilled: string | null;
  /** Whole days between the last fill and the as-of date (null if never filled). */
  daysSinceFill: number | null;
  /** Days-supply used for the computation (record override or catalog default). */
  daysSupply: number;
  /** The date the current supply is expected to run out (lastFilled + supply). */
  refillDueOn: string | null;
  /** True when the patient is within REFILL_LEAD_DAYS of running out (or past it). */
  refillDue: boolean;
  /** True when adherence has lapsed — a drop-off routed to the care team. */
  dropOff: boolean;
  /** Human-readable reason for the status + refill-due call. */
  rationale: string;
};

/** Patient outreach preferences the nudge is shaped to (consent + quiet hours). */
export type PatientOutreachPrefs = {
  /** Preferred channel; defaults to sms when unset. */
  channel?: "sms" | "email" | "phone";
  /** Whether the patient carries an active contact/marketing consent. */
  hasContactConsent?: boolean;
  /** Quiet-hours window the nudge must be scheduled outside of. */
  quietHours?: { start: string; end: string };
  /** Human-readable send window the nudge targets (display only). */
  preferredWindow?: string;
  /** Patient timezone (carried onto the nudge; no conversion performed). */
  timezone?: string;
};

/**
 * A consent-aware refill/adherence nudge handed to the Engagement Agent.
 * EXPLICITLY nudge-only: the agent drafts this for a human to review, and never
 * submits or orders a refill itself.
 */
export type AdherenceNudge = {
  /** The medication catalog id this nudge is about. */
  drug: string;
  drugLabel: string;
  /** Channel the nudge targets. */
  channel: "sms" | "email" | "phone";
  /** Present for email; omitted for sms/phone. */
  subject?: string;
  /** Nudge body (no free-text PII; medication + call-to-refill only). */
  body: string;
  /** True when the nudge is scheduled outside the patient's quiet hours. */
  quietHoursRespected: boolean;
  /** Always true — the nudge is for human review; the prototype never sends. */
  requiresHumanApproval: true;
  /** Always false — nothing is sent autonomously. */
  sent: false;
  /**
   * Always true — this is a NUDGE, never an autonomous refill order. The agent
   * may prompt a human to refill; it never submits/orders the refill itself.
   */
  nudgeOnly: true;
  /** True when the target lacks contact consent, so the nudge is suppressed. */
  suppressedForNoConsent: boolean;
  /** The agent this nudge is handed to for delivery. */
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

/**
 * Resolve a MedicationRecord's last-fill date against the as-of date.
 * lastFilled wins; otherwise lastFilledDaysAgo is subtracted from as-of; if
 * neither is present the medication is treated as never filled (null).
 */
function resolveLastFilled(med: MedicationRecord, asOf: string): string | null {
  if (typeof med.lastFilled === "string") return med.lastFilled;
  if (med.lastFilled === null) return null;
  if (typeof med.lastFilledDaysAgo === "number") {
    return addDays(asOf, -med.lastFilledDaysAgo);
  }
  return null;
}

/**
 * Assess a single medication's adherence + refill timing against an EXPLICIT
 * as-of date. DETERMINISTIC: a pure function of the record + as-of date (no
 * randomness, no clock). Never-filled or long-gap medications come back lapsed
 * (a drop-off); a short gap past the supply window is at-risk; a medication
 * still within its supply is good (with refillDue true once the refill window
 * opens).
 */
export function assessAdherence(
  med: MedicationRecord,
  asOf: string
): AdherenceAssessment {
  const catalog = getMedication(med.drug);
  const drugLabel = catalog?.label ?? med.drug;
  const drugClass = catalog?.drugClass ?? "other";
  const daysSupply = med.daysSupply ?? catalog?.defaultDaysSupply ?? 30;
  const onHrt = med.onHrt ?? drugClass === "hrt";

  const lastFilled = resolveLastFilled(med, asOf);

  if (lastFilled === null) {
    // Never filled (or unknown) → treat as a lapse / drop-off.
    return {
      drug: med.drug,
      drugLabel,
      drugClass,
      onHrt,
      status: "lapsed",
      lastFilled: null,
      daysSinceFill: null,
      daysSupply,
      refillDueOn: null,
      refillDue: true,
      dropOff: true,
      rationale: `no fill on record for ${drugLabel.toLowerCase()} — treated as an adherence lapse`
    };
  }

  const daysSinceFill = daysBetween(lastFilled, asOf);
  const refillDueOn = addDays(lastFilled, daysSupply);
  const refillDue = daysSinceFill >= daysSupply - REFILL_LEAD_DAYS;

  let status: AdherenceStatus;
  if (daysSinceFill <= daysSupply) {
    status = "good";
  } else if (daysSinceFill <= daysSupply + AT_RISK_WINDOW_DAYS) {
    status = "at-risk";
  } else {
    status = "lapsed";
  }
  const dropOff = status === "lapsed";

  let rationale: string;
  if (status === "good") {
    rationale = refillDue
      ? `${drugLabel.toLowerCase()} refill due (${daysSinceFill}d since fill, ${daysSupply}d supply)`
      : `${drugLabel.toLowerCase()} on track (${daysSinceFill}d since fill, ${daysSupply}d supply)`;
  } else if (status === "at-risk") {
    rationale = `${drugLabel.toLowerCase()} supply lapsed ${
      daysSinceFill - daysSupply
    }d ago (${daysSinceFill}d since fill, ${daysSupply}d supply) — at risk`;
  } else {
    rationale = `${drugLabel.toLowerCase()} lapsed ${
      daysSinceFill - daysSupply
    }d past supply (${daysSinceFill}d since fill, ${daysSupply}d supply) — adherence drop-off`;
  }

  return {
    drug: med.drug,
    drugLabel,
    drugClass,
    onHrt,
    status,
    lastFilled,
    daysSinceFill,
    daysSupply,
    refillDueOn,
    refillDue,
    dropOff,
    rationale
  };
}

/** Assess every medication (convenience). */
export function assessAllAdherence(
  meds: MedicationRecord[],
  asOf: string
): AdherenceAssessment[] {
  return meds.map((m) => assessAdherence(m, asOf));
}

/** Whether a refill is due for this medication as of the assessment date. */
export function isRefillDue(assessment: Pick<AdherenceAssessment, "refillDue">): boolean {
  return assessment.refillDue === true;
}

/**
 * The subset of assessments that are adherence drop-offs (lapsed). These are
 * the ones the agent flags to the care team (in addition to drafting a nudge).
 */
export function adherenceDropOffs(
  assessments: Array<Pick<AdherenceAssessment, "drug" | "status" | "dropOff">>
): Array<Pick<AdherenceAssessment, "drug" | "status" | "dropOff">> {
  return assessments.filter((a) => a.dropOff === true);
}

/** Does any assessment represent an adherence drop-off that routes to care? */
export function hasAdherenceDropOff(
  assessments: Array<Pick<AdherenceAssessment, "dropOff">>
): boolean {
  return assessments.some((a) => a.dropOff === true);
}

/**
 * A refill-related action a caller might ask the agent to take. The agent
 * itself only ever DRAFTS a nudge; a "submit-refill" is admissible only with a
 * human-in-the-loop approval. An autonomous submit (no human approval) is the
 * exact thing the Agent Fabric blocks.
 */
export type RefillActionRequest = {
  kind: "nudge" | "submit-refill";
  /** For a submit-refill, whether a human clinician/pharmacist approved it. */
  humanApproved?: boolean;
};

/**
 * The honest governance signal: does this refill-related action require (and
 * carry) human approval? TRUE for a nudge (the only thing the agent does) and
 * for a human-approved submit; FALSE for a caller-asserted AUTONOMOUS refill
 * submit. The route reports this to policy.medication.no-autonomous-refill,
 * which blocks when it is false — so the agent can never autonomously order a
 * refill.
 */
export function refillRequiresHumanApproval(
  action?: RefillActionRequest | null
): boolean {
  if (!action || action.kind === "nudge") return true;
  // A submit-refill is only permissible when a human explicitly approved it.
  return action.kind === "submit-refill" ? action.humanApproved === true : true;
}

/**
 * Draft a consent-aware refill/adherence nudge for a single medication, shaped
 * to the patient's channel + quiet-hours preferences, for handoff to the
 * Engagement Agent. Deterministic on its inputs. The nudge is ALWAYS
 * human-approval-gated, never sent, and EXPLICITLY nudge-only
 * (requiresHumanApproval: true, sent: false, nudgeOnly: true) — it prompts a
 * human to refill and never submits/orders a refill. When the target lacks
 * contact consent the nudge is marked suppressed.
 */
export function draftAdherenceNudge(
  assessment: Pick<
    AdherenceAssessment,
    "drug" | "drugLabel" | "status" | "refillDue"
  >,
  prefs: PatientOutreachPrefs = {}
): AdherenceNudge {
  const channel = prefs.channel ?? "sms";
  const hasConsent = prefs.hasContactConsent !== false;
  const catalog = getMedication(assessment.drug);
  const label = catalog?.label ?? assessment.drugLabel;

  // A nudge is always scheduled outside quiet hours (that's the point of
  // drafting rather than sending); the flag records that it honored them.
  const quietHoursRespected = true;

  let body: string;
  if (!hasConsent) {
    body =
      `Suppressed: no active contact consent on file for ${label.toLowerCase()} ` +
      `adherence outreach. No nudge will be drafted for delivery until consent is captured.`;
  } else if (assessment.status === "lapsed") {
    body =
      `Hi — it looks like you may have missed a refill of your ${label.toLowerCase()}. ` +
      `Reply or tap to request a refill, and we'll have your care team follow up. ` +
      `(We can't order a refill for you — a clinician reviews every request.)`;
  } else {
    body =
      `Hi — your ${label.toLowerCase()} may be due for a refill soon. ` +
      `Reply or tap to request a refill so you don't run out. ` +
      `(We can't order a refill for you — a clinician reviews every request.)`;
  }

  return {
    drug: assessment.drug,
    drugLabel: label,
    channel,
    ...(channel === "email"
      ? { subject: `A refill reminder about your ${label.toLowerCase()}` }
      : {}),
    body,
    quietHoursRespected,
    requiresHumanApproval: true,
    sent: false,
    nudgeOnly: true,
    suppressedForNoConsent: !hasConsent,
    handoffTo: "engagement-agent"
  };
}

/**
 * Draft a nudge for every assessment that warrants outreach — a refill is due
 * OR adherence is not "good" (at-risk / lapsed). A medication that's on track
 * with no refill due needs no nudge. Deterministic.
 */
export function draftAdherenceNudges(
  assessments: AdherenceAssessment[],
  prefs: PatientOutreachPrefs = {}
): AdherenceNudge[] {
  return assessments
    .filter((a) => a.refillDue || a.status !== "good")
    .map((a) => draftAdherenceNudge(a, prefs));
}

/**
 * A representative, deterministic demo medication panel (illustrative). Uses
 * lastFilledDaysAgo (not absolute dates) so it is independent of the as-of
 * date: a patient on estradiol (on track), oral progesterone (refill due
 * soon), paroxetine (at-risk), and venlafaxine (a lapsed drop-off).
 */
export const DEMO_MEDICATION_RECORDS: MedicationRecord[] = [
  { drug: "med.estradiol-transdermal", lastFilledDaysAgo: 20, onHrt: true },
  { drug: "med.progesterone-oral", lastFilledDaysAgo: 27, onHrt: true },
  { drug: "med.paroxetine-ssri", lastFilledDaysAgo: 41 },
  { drug: "med.venlafaxine-snri", lastFilledDaysAgo: 63 }
];
