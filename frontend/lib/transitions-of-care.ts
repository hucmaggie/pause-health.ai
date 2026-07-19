/**
 * Transitions of Care — deterministic post-encounter package: medication
 * reconciliation, scheduled follow-up, red-flag warning signs, teach-back
 * checklist, and a PCP handoff summary.
 *
 * Deterministic, dependency-free domain core the Discharge & Transitions of
 * Care Agent (app/api/agents/transitions-of-care) wraps — the Salesforce
 * "Agentforce for Health" / Health Cloud transitions-of-care analog on Pause's
 * Agent Fabric. For a menopause/midlife patient after an inpatient / ED
 * encounter, this agent closes the loop back to primary care: it RECONCILES
 * the discharge medication list against the pre-admit list, ORDERS a
 * follow-up appointment (not a recommendation — a real slot), pulls the
 * encounter-specific RED-FLAG warning signs, emits a TEACH-BACK CHECKLIST for
 * the discharge educator, and assembles the PCP HANDOFF SUMMARY. It is
 * distinct from the Care Plan Agent (active treatment planning), the
 * Medication Adherence Agent (nudge-only refill / adherence prompts), and the
 * Referral Management Agent (specialist triage) — this one runs the CLOSE-
 * THE-LOOP workflow after an acute event.
 *
 *   Inbound:  PatientTransitionContext (a synthetic patientRef — clearly
 *             labeled illustrative — encounter kind (hospitalization / ED /
 *             observation), the encounter reason (vasomotor / cardiovascular
 *             / behavioral / musculoskeletal / general), the discharge date
 *             accepted as data, the pre-admit and discharge medication lists,
 *             and an optional scheduled follow-up
 *   Outbound: TransitionOfCarePackage { reconciliation, followUp,
 *             redFlagWarnings[], teachBackChecklist[], pcpHandoffSummary,
 *             synthetic:true, note } and a clinician-signoff-gated
 *             ReconciliationChangeProposal from proposeMedicationChange()
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: reconciliation traces to an approved source.
 * ─────────────────────────────────────────────────────────────────────
 *  Every medication in the pre-admit OR discharge list must cite an approved
 *  medication-SOURCE (pre-admit-verified, discharge-order, patient-verified,
 *  ehr-scanned-with-provenance). Verbal / ad-hoc / undocumented sources are
 *  deliberately excluded — fabricating a med to pad the reconciliation is a
 *  load-bearing safety failure this guard closes.
 *  medicationsTraceToApprovedSource() reports the honest signal the Agent
 *  Fabric enforces via policy.toc.reconciliation-source-integrity.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no autonomous medication change.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent may only DRAFT reconciliation notes (add / remove / dose-change)
 *  — it may NEVER autonomously commit a medication change. Every
 *  proposeMedicationChange() output is requiresClinicianSignoff:true /
 *  applied:false; a caller-asserted plan that claims already-applied or
 *  bypasses sign-off is a violation. Mirrors the Medication Adherence Agent's
 *  no-autonomous-refill, the Prior Authorization Agent's no-autonomous-
 *  submission, and the ACP Agent's no-autonomous-directive-change posture.
 *  reconciliationChangeRequiresClinician() reports the honest signal the
 *  Agent Fabric enforces via policy.toc.no-autonomous-medication-change.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: follow-up scheduled, not recommended.
 * ─────────────────────────────────────────────────────────────────────
 *  A follow-up must be a SCHEDULED appointment — a specific slot (ISO
 *  datetime), a named provider, and a modality — not a text recommendation.
 *  "Recommended" follow-ups that never get booked are the classic 30-day-
 *  readmission failure mode this guard closes. When no scheduled follow-up
 *  is provided the agent DRAFTS an appointment-request handoff to the
 *  Appointment Scheduling agent and marks the package awaitingSchedule:true
 *  — the load-bearing violation is a package claiming "follow-up complete"
 *  without a scheduled slot. followUpScheduledNotRecommended() reports the
 *  honest signal the Agent Fabric enforces via
 *  policy.toc.follow-up-scheduled-not-recommended.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified transitions-of-care system.
 * ─────────────────────────────────────────────────────────────────────
 *  The encounter reasons, red-flag catalog, follow-up window (14 days), and
 *  teach-back items below are ILLUSTRATIVE synthetic/demo values chosen to
 *  model the SHAPE of a transitions-of-care package for a midlife /
 *  menopause encounter — they are NOT a certified TOC schema, a real ADT
 *  / discharge system, or a clinical guideline registry. The patientRefs
 *  and medication ids are synthetic / de-identified. There is NO randomness
 *  and NO clock anywhere here: the package is a pure function of the
 *  patient context + discharge date + provided lists (no clock, timestamps
 *  are accepted as data), so the same context always yields the same
 *  package — which is what lets the demo, the seeded trace, and the tests
 *  agree.
 */

/** The clinically-illustrative follow-up window (days). */
export const FOLLOW_UP_WINDOW_DAYS = 14;

/**
 * Approved medication-source labels. A pre-admit / discharge entry must cite
 * one of these — a "verbal-not-documented" source is deliberately EXCLUDED
 * so it fails source-integrity.
 */
export const APPROVED_MEDICATION_SOURCES: string[] = [
  "pre-admit-verified",
  "discharge-order",
  "patient-verified",
  "ehr-scanned-with-provenance"
];

const APPROVED_SOURCE_SET = new Set<string>(APPROVED_MEDICATION_SOURCES);

/** Is `source` on the approved medication-source list? */
export function isApprovedMedicationSource(source: unknown): boolean {
  return typeof source === "string" && APPROVED_SOURCE_SET.has(source);
}

/** The (illustrative) encounter kinds that trigger a transitions-of-care run. */
export type EncounterKind = "hospitalization" | "ed-visit" | "observation";

/** Illustrative encounter-reason categories driving the red-flag catalog. */
export type EncounterReasonCategory =
  | "vasomotor"
  | "cardiovascular"
  | "behavioral"
  | "musculoskeletal"
  | "general";

/**
 * The (illustrative) red-flag warning-sign catalog. Every encounter-reason
 * category maps to a catalog-sourced list of red-flag warning signs to
 * teach at discharge. NOT a certified clinical-warning registry.
 */
export type RedFlagWarning = {
  /** Stable catalog id every emitted red-flag references (never invented). */
  id: string;
  /** Human-readable warning label. */
  label: string;
  /** Illustrative rationale for teaching this warning. */
  detail: string;
  /** Always true — the catalog is an illustrative synthetic. */
  synthetic: true;
};

/**
 * The illustrative red-flag warning-sign catalog, keyed by encounter-reason
 * category. Every warning-sign id is unique across the catalog. Illustrative
 * / synthetic — NOT a certified clinical-warning registry.
 */
export const RED_FLAG_CATALOG: Record<EncounterReasonCategory, RedFlagWarning[]> = {
  vasomotor: [
    {
      id: "warn.vasomotor.chest-pain",
      label: "New chest pain or shortness of breath",
      detail:
        "Vasomotor / cardiovascular overlap in midlife — new chest pain, shortness of breath, or syncope after discharge warrants ED evaluation.",
      synthetic: true
    },
    {
      id: "warn.vasomotor.severe-bleeding",
      label: "Unexpected heavy or new post-menopausal bleeding",
      detail:
        "Any post-menopausal bleeding after discharge warrants urgent contact with the OB/GYN or MSCP.",
      synthetic: true
    }
  ],
  cardiovascular: [
    {
      id: "warn.cv.chest-pain",
      label: "Recurrent chest pain",
      detail:
        "Recurrent chest pain, especially at rest or on exertion, warrants immediate ED return.",
      synthetic: true
    },
    {
      id: "warn.cv.bp-crisis",
      label: "Systolic BP > 180 mmHg or diastolic > 110 mmHg",
      detail:
        "A hypertensive-urgency reading after discharge warrants same-day contact with the cardiology or PCP.",
      synthetic: true
    },
    {
      id: "warn.cv.med-adverse",
      label: "New unexplained bruising / bleeding on new anticoagulant",
      detail:
        "A newly-started anticoagulant after a cardiovascular event needs immediate reporting of unexplained bleeding.",
      synthetic: true
    }
  ],
  behavioral: [
    {
      id: "warn.bh.suicidal-ideation",
      label: "Thoughts of self-harm or suicide",
      detail:
        "Any thoughts of self-harm after discharge — contact the crisis line (988) or return to the ED immediately.",
      synthetic: true
    },
    {
      id: "warn.bh.med-adverse",
      label: "New severe agitation / mania on a new SSRI/SNRI",
      detail:
        "New severe agitation, mania, or serotonin-syndrome symptoms on a newly-started SSRI / SNRI warrants same-day clinical contact.",
      synthetic: true
    }
  ],
  musculoskeletal: [
    {
      id: "warn.msk.fracture-signs",
      label: "New severe localized pain / deformity after a fall",
      detail:
        "New severe localized pain or deformity after a fall — especially at hip or wrist — warrants urgent evaluation for occult fracture.",
      synthetic: true
    }
  ],
  general: [
    {
      id: "warn.general.fever",
      label: "Fever > 101.5°F / 38.6°C",
      detail:
        "A post-discharge fever warrants same-day contact with the PCP or an ED return.",
      synthetic: true
    }
  ]
};

/** Look up a red-flag by id (undefined for an off-catalog id). */
export function getRedFlag(id: string): RedFlagWarning | undefined {
  for (const list of Object.values(RED_FLAG_CATALOG)) {
    const found = list.find((r) => r.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Is `category` a defined encounter-reason category? */
export function isEncounterReasonCategory(category: unknown): boolean {
  return (
    typeof category === "string" &&
    (Object.keys(RED_FLAG_CATALOG) as string[]).includes(category)
  );
}

/**
 * A single medication line on the pre-admit or discharge list. Every entry
 * must cite an approved medication-source (see APPROVED_MEDICATION_SOURCES) —
 * unapproved / verbal sources fail source-integrity.
 */
export type MedicationEntry = {
  /** Stable illustrative medication id (never a real drug NDC). */
  medicationId: string;
  /** Human-readable medication name (illustrative). */
  label: string;
  /** Illustrative dose (e.g. "50 mg PO daily"). */
  dose: string;
  /** Approved-source label (must be on APPROVED_MEDICATION_SOURCES). */
  source: string;
};

/** The kind of change a reconciled medication line represents. */
export type ReconciliationChangeKind =
  | "unchanged"
  | "added"
  | "removed"
  | "dose-changed";

/** A single reconciled medication line. */
export type ReconciliationLine = {
  /** The medication id this line is about. */
  medicationId: string;
  /** Human-readable medication label (illustrative). */
  label: string;
  /** The pre-admit dose, when present. */
  preAdmitDose?: string;
  /** The discharge dose, when present. */
  dischargeDose?: string;
  /** Which kind of change this represents (added / removed / etc.). */
  changeKind: ReconciliationChangeKind;
  /** The approved-source label for the winning entry (never invented). */
  source: string;
};

/** The reconciled medication list the agent emits. */
export type MedicationReconciliation = {
  /** Per-medication reconciliation (sorted by medicationId — stable order). */
  lines: ReconciliationLine[];
  /** Count of adds / removes / dose-changes (unchanged excluded). */
  changes: number;
  /**
   * Every reconciliation is DRAFT — clinician sign-off is required before any
   * change is committed. Mirrors the ACP proposal shape.
   */
  requiresClinicianSignoff: true;
  /** Always false — the agent NEVER autonomously commits a medication change. */
  applied: false;
};

/** A scheduled follow-up appointment. */
export type FollowUpAppointment = {
  /** Whether a real slot is scheduled. */
  scheduled: boolean;
  /** ISO datetime of the scheduled slot (present only when scheduled). */
  slotStart?: string;
  /** Illustrative synthetic provider ref. */
  providerRef?: string;
  /** Human-readable provider label (illustrative). */
  providerLabel?: string;
  /** Modality — telehealth / in-person / phone. */
  modality?: "telehealth" | "in-person" | "phone";
  /** Days from discharge until the follow-up slot. */
  daysFromDischarge?: number;
  /**
   * True when no slot is scheduled — the agent DRAFTS an appointment request
   * for the Appointment Scheduling agent to handle. A package with
   * awaitingSchedule:true satisfies the follow-up-scheduled signal only when
   * the caller treats it as INCOMPLETE (state:'awaiting-schedule') rather than
   * claiming completion.
   */
  awaitingSchedule: boolean;
  /** Human-readable body (rule-based / templated — never a live-model narrative). */
  body: string;
};

/** A single teach-back checklist item. */
export type TeachBackItem = {
  id: string;
  label: string;
  detail: string;
};

/** The rule-based teach-back checklist (universal for every TOC package). */
export const UNIVERSAL_TEACH_BACK: TeachBackItem[] = [
  {
    id: "teach.medication-list",
    label: "Walk through the discharge medication list with the patient",
    detail:
      "Confirm the patient can name each medication, its dose, and its purpose — flag any teach-back miss for a clinician follow-up."
  },
  {
    id: "teach.follow-up",
    label: "Confirm the follow-up appointment and how to get there",
    detail:
      "Confirm the patient knows when, where, and how to attend the scheduled follow-up (or, when awaitingSchedule, that they will be called)."
  },
  {
    id: "teach.red-flags",
    label: "Teach the encounter-specific red-flag warning signs",
    detail:
      "Confirm the patient can name at least two red-flag warning signs from the encounter-reason catalog and knows to return or call."
  },
  {
    id: "teach.contact",
    label: "Confirm the after-hours contact + crisis-line numbers",
    detail:
      "Confirm the patient has the PCP after-hours number and, for a behavioral-health encounter, the 988 crisis line."
  }
];

/** The state of the overall transitions-of-care package. */
export type TocPackageState =
  | "ready-for-clinician-signoff"
  | "awaiting-schedule";

/** The transitions-of-care package the agent emits. */
export type TransitionOfCarePackage = {
  /** The synthetic patient reference this package is about. */
  patientRef: string;
  /** ISO discharge date accepted as data (no clock). */
  dischargeDate: string;
  /** The encounter kind. */
  encounterKind: EncounterKind;
  /** The encounter-reason category. */
  encounterReasonCategory: EncounterReasonCategory;
  /** The reconciled medication list (draft — clinician sign-off required). */
  reconciliation: MedicationReconciliation;
  /** The scheduled follow-up (or an awaiting-schedule handoff to Scheduling). */
  followUp: FollowUpAppointment;
  /** The encounter-specific red-flag warning signs (catalog-sourced). */
  redFlagWarnings: RedFlagWarning[];
  /** The rule-based teach-back checklist. */
  teachBackChecklist: TeachBackItem[];
  /** Rule-based PCP handoff summary (never a live-model narrative). */
  pcpHandoffSummary: string;
  /** Overall package state. */
  state: TocPackageState;
  /** Always true — every catalog + refs are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note. */
  note: string;
};

/**
 * A caller-signoff-gated reconciliation-change proposal. Always
 * requiresClinicianSignoff:true / applied:false. Mirrors the ACP directive-
 * change proposal shape.
 */
export type ReconciliationChangeProposal = {
  state: "draft" | "ready-for-clinician-signoff";
  medicationId: string;
  changeKind: ReconciliationChangeKind;
  rationale: string;
  requiresClinicianSignoff: true;
  applied: false;
  body: string;
};

/**
 * The structured signals the transitions-of-care planner reads. `patientRef`
 * is a synthetic, de-identified id — clearly labeled illustrative.
 */
export type PatientTransitionContext = {
  /** Synthetic, de-identified patient reference (e.g. "toc-patient-001"). */
  patientRef: string;
  /** ISO discharge date accepted as data (no clock). */
  dischargeDate: string;
  /** The encounter kind. */
  encounterKind: EncounterKind;
  /**
   * Illustrative encounter-reason category driving the red-flag catalog.
   * An unknown / off-catalog value falls through to "general".
   */
  encounterReasonCategory?: EncounterReasonCategory;
  /**
   * Pre-admit medication list — each entry must cite an approved source.
   * Off-catalog / verbal sources surface via the source-integrity signal.
   */
  preAdmitMedications?: MedicationEntry[];
  /**
   * Discharge medication list — each entry must cite an approved source.
   */
  dischargeMedications?: MedicationEntry[];
  /**
   * The scheduled follow-up appointment, when the caller has one already
   * booked (via the Appointment Scheduling agent). When absent, the TOC
   * package returns state:'awaiting-schedule' and an appointment-request
   * handoff body — NOT a "recommended" follow-up.
   */
  scheduledFollowUp?: {
    slotStart: string;
    providerRef: string;
    providerLabel: string;
    modality: "telehealth" | "in-person" | "phone";
  };
};

/** Deterministic days between two ISO dates (later - earlier), or Infinity. */
function daysBetween(later: string, earlier: string): number {
  const a = Date.parse(later);
  const e = Date.parse(earlier);
  if (Number.isNaN(a) || Number.isNaN(e)) return Number.POSITIVE_INFINITY;
  return Math.floor((a - e) / (1000 * 60 * 60 * 24));
}

/**
 * Reconcile two medication lists. DETERMINISTIC: for every unique medication
 * id, emit exactly one reconciliation line — added / removed / dose-changed /
 * unchanged. Off-catalog-source entries are IGNORED here (surface via the
 * source-integrity signal) but the operation itself is a pure function of
 * the two input arrays. Lines are sorted by medication id for a stable,
 * documented display.
 */
export function reconcileMedications(
  preAdmit: MedicationEntry[],
  discharge: MedicationEntry[]
): MedicationReconciliation {
  const legit = (list: MedicationEntry[]): MedicationEntry[] =>
    list.filter((m) => isApprovedMedicationSource(m.source));

  const preAdmitLegit = legit(preAdmit);
  const dischargeLegit = legit(discharge);

  const preAdmitById = new Map(preAdmitLegit.map((m) => [m.medicationId, m]));
  const dischargeById = new Map(dischargeLegit.map((m) => [m.medicationId, m]));

  const allIds = new Set<string>([...preAdmitById.keys(), ...dischargeById.keys()]);
  const lines: ReconciliationLine[] = [];
  for (const id of allIds) {
    const pre = preAdmitById.get(id);
    const post = dischargeById.get(id);
    let changeKind: ReconciliationChangeKind;
    if (pre && post) {
      changeKind = pre.dose === post.dose ? "unchanged" : "dose-changed";
    } else if (post) {
      changeKind = "added";
    } else {
      changeKind = "removed";
    }
    const winning = post ?? pre!;
    lines.push({
      medicationId: id,
      label: winning.label,
      preAdmitDose: pre?.dose,
      dischargeDose: post?.dose,
      changeKind,
      source: winning.source
    });
  }
  lines.sort((a, b) => a.medicationId.localeCompare(b.medicationId));
  const changes = lines.filter((l) => l.changeKind !== "unchanged").length;

  return {
    lines,
    changes,
    requiresClinicianSignoff: true,
    applied: false
  };
}

/**
 * Resolve the encounter's red-flag catalog list. Off-catalog category → the
 * general list (so the demo can still exercise the pipeline).
 */
function redFlagsFor(category: EncounterReasonCategory): RedFlagWarning[] {
  return RED_FLAG_CATALOG[category] ?? RED_FLAG_CATALOG.general;
}

/**
 * Assemble a transitions-of-care package. DETERMINISTIC: reconciles meds,
 * accepts (or drafts an appointment-request for) the follow-up, pulls the
 * encounter-specific red-flags, emits the universal teach-back checklist,
 * and composes the PCP handoff summary. A pure function of the context (no
 * randomness, no clock — timestamps are accepted as data).
 */
export function assembleTransitionOfCare(
  ctx: PatientTransitionContext
): TransitionOfCarePackage {
  const category = isEncounterReasonCategory(ctx.encounterReasonCategory)
    ? (ctx.encounterReasonCategory as EncounterReasonCategory)
    : "general";
  const reconciliation = reconcileMedications(
    ctx.preAdmitMedications ?? [],
    ctx.dischargeMedications ?? []
  );

  const scheduled = ctx.scheduledFollowUp;
  const followUp: FollowUpAppointment = scheduled
    ? {
        scheduled: true,
        slotStart: scheduled.slotStart,
        providerRef: scheduled.providerRef,
        providerLabel: scheduled.providerLabel,
        modality: scheduled.modality,
        daysFromDischarge: daysBetween(scheduled.slotStart, ctx.dischargeDate),
        awaitingSchedule: false,
        body:
          `Follow-up scheduled with ${scheduled.providerLabel} at ${scheduled.slotStart} (${scheduled.modality}). ` +
          `Days from discharge: ${daysBetween(scheduled.slotStart, ctx.dischargeDate)}${
            daysBetween(scheduled.slotStart, ctx.dischargeDate) > FOLLOW_UP_WINDOW_DAYS
              ? ` — outside the ${FOLLOW_UP_WINDOW_DAYS}-day window, flag for the care team`
              : ""
          }.`
      }
    : {
        scheduled: false,
        awaitingSchedule: true,
        body:
          `No follow-up slot on file at package assembly. ` +
          "Handoff to the Appointment Scheduling agent to book a within-14-day slot — the package is NOT complete until a real slot is scheduled (the agent never marks a 'recommended' follow-up complete)."
      };

  const redFlagWarnings = redFlagsFor(category);
  const teachBackChecklist = UNIVERSAL_TEACH_BACK;

  const state: TocPackageState = followUp.scheduled
    ? "ready-for-clinician-signoff"
    : "awaiting-schedule";

  const pcpHandoffSummary =
    `Transitions-of-care handoff for ${ctx.patientRef} (discharge ${ctx.dischargeDate}, ${ctx.encounterKind}, ${category} reason). ` +
    `${reconciliation.changes} medication change${reconciliation.changes === 1 ? "" : "s"} on the reconciliation (all clinician-signoff gated). ` +
    (followUp.scheduled
      ? `Follow-up: ${followUp.providerLabel} at ${followUp.slotStart} (${followUp.modality}, ${followUp.daysFromDischarge}d from discharge). `
      : `Follow-up: awaiting scheduling (a within-${FOLLOW_UP_WINDOW_DAYS}-day slot). `) +
    `Red-flag warning signs taught: ${redFlagWarnings.map((r) => r.label).join("; ")}. ` +
    "The agent never autonomously commits a medication change or marks a 'recommended' follow-up complete.";

  const note =
    `Assembled a transitions-of-care package for ${ctx.patientRef} (discharge ${ctx.dischargeDate}): ${reconciliation.lines.length} medications on the reconciliation (${reconciliation.changes} change${
      reconciliation.changes === 1 ? "" : "s"
    }), ${redFlagWarnings.length} red-flag warning${
      redFlagWarnings.length === 1 ? "" : "s"
    }, ${teachBackChecklist.length} teach-back items. ` +
    "Every medication on the reconciliation traces to an approved source; every reconciliation change is clinician-signoff gated (the agent NEVER autonomously commits a change); and the follow-up is a scheduled slot (with awaiting-schedule as the safe interim answer — never a text recommendation). Synthetic/illustrative catalog, sources, and timing — not a certified TOC system.";

  return {
    patientRef: ctx.patientRef,
    dischargeDate: ctx.dischargeDate,
    encounterKind: ctx.encounterKind,
    encounterReasonCategory: category,
    reconciliation,
    followUp,
    redFlagWarnings,
    teachBackChecklist,
    pcpHandoffSummary,
    state,
    synthetic: true,
    note
  };
}

/**
 * Propose a reconciliation-change (add / remove / dose-change) for a
 * clinician to sign off on. Deterministic on its input. NEVER autonomously
 * applied. Mirrors the ACP directive-change proposal shape.
 */
export function proposeMedicationChange(input: {
  medicationId: string;
  changeKind: ReconciliationChangeKind;
  rationale: string;
}): ReconciliationChangeProposal {
  return {
    state: "ready-for-clinician-signoff",
    medicationId: input.medicationId,
    changeKind: input.changeKind,
    rationale: input.rationale,
    requiresClinicianSignoff: true,
    applied: false,
    body:
      `Medication change proposal · ${input.changeKind} · ${input.medicationId} · ${input.rationale}. ` +
      "Ready for clinician sign-off — the agent NEVER autonomously commits a medication change."
  };
}

/**
 * Source-integrity check: does EVERY medication in the pre-admit AND
 * discharge lists cite an approved medication-source? True when every entry
 * meets it; the guard that catches a caller-asserted verbal / ad-hoc /
 * undocumented source (a fabricated med slipping into the reconciliation).
 * This is the honest signal the route reports to
 * policy.toc.reconciliation-source-integrity. A non-object input is a
 * violation.
 */
export function medicationsTraceToApprovedSource(
  lists:
    | {
        preAdmit?: Array<{ source?: string }>;
        discharge?: Array<{ source?: string }>;
      }
    | null
    | undefined
): boolean {
  if (!lists || typeof lists !== "object") return false;
  const pre = Array.isArray(lists.preAdmit) ? lists.preAdmit : [];
  const post = Array.isArray(lists.discharge) ? lists.discharge : [];
  return [...pre, ...post].every((m) => isApprovedMedicationSource(m.source));
}

/**
 * Human-signoff check: does EVERY reconciliation-change proposal require
 * clinician sign-off, and is it explicitly NOT applied? True for anything
 * proposeMedicationChange() produces (and the trivial empty-set default);
 * the guard that catches a caller-asserted plan that would autonomously
 * commit a medication change. This is the honest signal the route reports
 * to policy.toc.no-autonomous-medication-change. A non-array input is a
 * violation.
 */
export function reconciliationChangeRequiresClinician(
  proposals:
    | Array<{
        requiresClinicianSignoff?: boolean;
        applied?: boolean;
      }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(proposals)) return false;
  return proposals.every((p) => {
    if (p.requiresClinicianSignoff !== true) return false;
    if (p.applied === true) return false;
    return true;
  });
}

/**
 * Scheduled-not-recommended check: is the follow-up either a real scheduled
 * slot (with a slotStart + provider) OR explicitly awaiting-schedule (a safe
 * interim answer)? False for a caller-asserted plan claiming
 * scheduled:true / state:'complete' without a real slotStart (a "recommended
 * follow-up" masquerading as complete). This is the load-bearing 30-day-
 * readmission property. A non-object input is a violation.
 */
export function followUpScheduledNotRecommended(
  plan:
    | {
        scheduled?: boolean;
        awaitingSchedule?: boolean;
        slotStart?: string;
        providerRef?: string;
      }
    | null
    | undefined
): boolean {
  if (!plan || typeof plan !== "object") return false;
  if (plan.awaitingSchedule === true && plan.scheduled !== true) return true;
  if (plan.scheduled === true) {
    // A real scheduled slot needs both a slotStart and a providerRef.
    return (
      typeof plan.slotStart === "string" &&
      plan.slotStart.length > 0 &&
      typeof plan.providerRef === "string" &&
      plan.providerRef.length > 0
    );
  }
  return false;
}

/**
 * A representative, deterministic demo patient (illustrative). A midlife
 * cardiovascular hospitalization with a scheduled 7-day cardiology follow-up
 * — so the happy path (dose-change on a beta-blocker, added anticoagulant,
 * scheduled follow-up inside the 14-day window) is demonstrable.
 * Synthetic / de-identified.
 */
export const DEMO_TOC_PATIENT: PatientTransitionContext = {
  patientRef: "toc-patient-001",
  dischargeDate: "2026-07-01",
  encounterKind: "hospitalization",
  encounterReasonCategory: "cardiovascular",
  preAdmitMedications: [
    {
      medicationId: "med.metoprolol-25",
      label: "Metoprolol 25 mg PO BID",
      dose: "25 mg PO BID",
      source: "pre-admit-verified"
    },
    {
      medicationId: "med.estradiol-patch",
      label: "Estradiol patch 0.05 mg/24h",
      dose: "0.05 mg/24h",
      source: "pre-admit-verified"
    }
  ],
  dischargeMedications: [
    {
      medicationId: "med.metoprolol-25",
      label: "Metoprolol 50 mg PO BID",
      dose: "50 mg PO BID",
      source: "discharge-order"
    },
    {
      medicationId: "med.estradiol-patch",
      label: "Estradiol patch 0.05 mg/24h",
      dose: "0.05 mg/24h",
      source: "discharge-order"
    },
    {
      medicationId: "med.apixaban-5",
      label: "Apixaban 5 mg PO BID",
      dose: "5 mg PO BID",
      source: "discharge-order"
    }
  ],
  scheduledFollowUp: {
    slotStart: "2026-07-08T15:00:00Z",
    providerRef: "provider-card-001",
    providerLabel: "Dr. K. Patel · Cardiology",
    modality: "telehealth"
  }
};

/**
 * A representative "awaiting schedule" demo patient (illustrative). A
 * behavioral-health ED visit with a new SSRI on discharge but NO scheduled
 * follow-up — so the awaiting-schedule handoff (a SAFE interim answer, not a
 * text recommendation) is demonstrable.
 */
export const DEMO_AWAITING_SCHEDULE_PATIENT: PatientTransitionContext = {
  patientRef: "toc-patient-002",
  dischargeDate: "2026-07-01",
  encounterKind: "ed-visit",
  encounterReasonCategory: "behavioral",
  preAdmitMedications: [],
  dischargeMedications: [
    {
      medicationId: "med.sertraline-50",
      label: "Sertraline 50 mg PO daily",
      dose: "50 mg PO daily",
      source: "discharge-order"
    }
  ]
};
