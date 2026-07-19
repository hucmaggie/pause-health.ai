/**
 * Advance Care Planning (ACP) — deterministic assessment of a patient's
 * advance directives + a consent-gated conversation prompt for the care team.
 *
 * Deterministic, dependency-free domain core the Advance Care Planning Agent
 * (app/api/agents/advance-care-planning) wraps — the Salesforce "Agentforce
 * for Health" / Health Cloud advance-care-planning analog on Pause's Agent
 * Fabric. Perimenopause / menopause is a natural MIDLIFE touchpoint at which
 * to prompt ACP — the patient is engaged with the health system but isn't in
 * acute illness — so this agent surfaces which directives are on file, which
 * are missing / stale / need jurisdictional review, and drafts a
 * conversation prompt for the care team that a clinician then delivers. It
 * NEVER creates, updates, or overrides a directive on its own.
 *
 *   Inbound:  PatientAcpContext (a synthetic patientRef — clearly labeled
 *             illustrative — the patient's preferredLanguageCode, an optional
 *             qualifiedInterpreterPlanned flag, an optional seriousIllness
 *             flag, an as-of date accepted as data, and the directives on
 *             file (each citing a catalog directive type, executedDate, and
 *             source)
 *   Outbound: AcpAssessment { perDirective: [{ directiveId, status,
 *             recommended, source?, executedDate?, ageInDays?, ... }], flags,
 *             conversationPrompt, synthetic:true, note } and a consent-safe
 *             DirectiveChangeProposal from proposeDirectiveChange()
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: directives trace to the directive catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every directive claimed as on-file must trace to the defined
 *  ACP_DIRECTIVES catalog AND to an approved directive-SOURCE (see
 *  APPROVED_SOURCES) with a recorded executedDate — a directive with an
 *  off-catalog id, an off-catalog source, a verbal-not-documented source, or
 *  no executedDate is not a legitimate directive on file. Fabricating a
 *  directive to inflate "completeness" is a load-bearing failure mode this
 *  guard closes. directivesTraceToCatalog() reports the honest signal the
 *  Agent Fabric enforces via policy.acp.directive-source-integrity.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no autonomous directive change.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent may only DRAFT a conversation prompt or a change proposal — it
 *  may NEVER autonomously create, update, or override a directive. Every
 *  proposeDirectiveChange() output is requiresClinicianAndPatientSignoff:
 *  true / applied:false; a caller-asserted plan claiming already-applied or
 *  bypassing sign-off is a violation. Mirrors the Prior Authorization
 *  Agent's no-autonomous-submission, the Medication Adherence Agent's
 *  no-autonomous-refill, and the HEDIS Agent's no-autonomous-submission
 *  posture — a directive is a legal / clinical instrument, not an agent
 *  action. directiveChangeRequiresHumanSignoff() reports the honest signal
 *  the Agent Fabric enforces via policy.acp.no-autonomous-directive-change.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: LEP patients need a language-access plan.
 * ─────────────────────────────────────────────────────────────────────
 *  For a limited-English-proficiency (LEP) patient — preferredLanguageCode
 *  other than the clinical default (English) — an ACP conversation prompt
 *  requires a documented QUALIFIED-INTERPRETER plan (deferring to the
 *  Language Access & Health Equity agent). The agent may NOT draft an
 *  actionable ACP conversation for an LEP patient without one — that would
 *  ask a clinician to hold a legally-consequential conversation the patient
 *  cannot participate in. When no plan is documented the agent WITHHOLDS
 *  the active prompt (a safe completed answer — not a block) and flags a
 *  language-access-required equity gap. A caller-asserted plan that claims
 *  active outreach without an interpreter plan is a violation.
 *  languageAccessSatisfied() reports the honest signal the Agent Fabric
 *  enforces via policy.acp.language-access-integrity.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified ACP / directives system.
 * ─────────────────────────────────────────────────────────────────────
 *  The directive catalog, staleness threshold, approved-source labels, and
 *  jurisdictional-review flag below are ILLUSTRATIVE synthetic/demo values
 *  chosen to model the SHAPE of ACP intake at a midlife touchpoint — they
 *  are NOT a certified advance-directives registry, a POLST/MOLST program
 *  (which is jurisdiction-specific and out of scope for a menopause/midlife
 *  patient without a serious-illness flag), or a legal instrument. The
 *  patientRefs are synthetic / de-identified. There is NO randomness and NO
 *  clock anywhere here: the assessment is a pure function of the caller-
 *  provided asOfDate + the directives-on-file, so the same context always
 *  yields the same assessment — which is what lets the demo, the seeded
 *  trace, and the tests agree.
 */

/** The clinical default language — English needs no interpreter for ACP. */
export const CLINICAL_DEFAULT_LANGUAGE_CODE = "en";

/** Days of age past which a directive is flagged for review (illustrative). */
export const STALENESS_THRESHOLD_DAYS = 5 * 365;

/**
 * A single directive type in the (illustrative) ACP directive catalog. Every
 * directive exposes whether it is universally recommended at a midlife/
 * menopause touchpoint or only conditionally (for serious-illness patients).
 * Illustrative — NOT a legal / certified directive schema.
 */
export type AcpDirective = {
  /** Stable catalog id every claimed directive references (never invented). */
  id: string;
  /** Human-readable directive label. */
  label: string;
  /**
   * Whether this directive is universally recommended at a midlife touchpoint
   * (living will, DPOA-HC) or only conditionally on a serious-illness flag
   * (POLST). A universally-recommended directive is "recommended" for every
   * patient; a conditional one only when the seriousIllness flag is on.
   */
  universallyRecommended: boolean;
  /** Illustrative purpose/description (never a legal directive definition). */
  purpose: string;
  /** Always true — the catalog is an illustrative synthetic. */
  synthetic: true;
};

/**
 * The illustrative ACP directive catalog. Two directives are recommended for
 * every midlife/menopause patient (living will + DPOA-HC); POLST is
 * conditional — only recommended when a serious-illness flag is on. Illustrative
 * / synthetic — NOT a certified directives-registry schema.
 */
export const ACP_DIRECTIVES: AcpDirective[] = [
  {
    id: "directive.living-will",
    label: "Living will",
    universallyRecommended: true,
    purpose:
      "Documents the patient's treatment preferences (e.g. CPR, mechanical ventilation, artificial nutrition) in the event they lose decisional capacity.",
    synthetic: true
  },
  {
    id: "directive.dpoahc",
    label: "Durable power of attorney for health care",
    universallyRecommended: true,
    purpose:
      "Names a surrogate decision-maker to make health-care decisions on the patient's behalf if they lose decisional capacity.",
    synthetic: true
  },
  {
    id: "directive.polst",
    label: "POLST / MOLST (physician orders for life-sustaining treatment)",
    // POLST is a clinical order set intended for patients with serious illness /
    // limited life expectancy — NOT a general midlife touchpoint recommendation.
    universallyRecommended: false,
    purpose:
      "A clinical order set — only appropriate for patients with a serious illness or limited life expectancy — that translates directive preferences into portable medical orders.",
    synthetic: true
  }
];

const DIRECTIVE_BY_ID = new Map(ACP_DIRECTIVES.map((d) => [d.id, d]));

/** Is `id` a defined ACP directive catalog id? */
export function isAcpDirective(id: unknown): boolean {
  return typeof id === "string" && DIRECTIVE_BY_ID.has(id);
}

/** Look up an ACP directive by id (undefined for an off-catalog id). */
export function getDirective(id: string): AcpDirective | undefined {
  return DIRECTIVE_BY_ID.get(id);
}

/**
 * Approved directive-source labels. A directive-on-file must cite one of
 * these — a "verbal-not-documented" source is deliberately EXCLUDED so it
 * fails source-integrity (verbal preferences are not a directive on file).
 */
export const APPROVED_SOURCES: string[] = [
  "patient-provided-original",
  "attorney-executed",
  "ehr-scanned-with-provenance"
];

const APPROVED_SOURCE_SET = new Set<string>(APPROVED_SOURCES);

/** Is `source` on the approved directive-source list? */
export function isApprovedSource(source: unknown): boolean {
  return typeof source === "string" && APPROVED_SOURCE_SET.has(source);
}

/** A claimed directive on file for a patient. */
export type DirectiveOnFile = {
  /** The ACP directive catalog id (never invented). */
  directiveId: string;
  /** The approved-source label (must be on APPROVED_SOURCES). */
  source: string;
  /** ISO date the directive was executed (accepted as data — no clock). */
  executedDate: string;
  /** Optional language of the executed document (for LEP context). */
  languageCode?: string;
};

/**
 * The structured patient signals the ACP planner reads. `patientRef` is a
 * synthetic, de-identified id — clearly labeled illustrative. Deferring to
 * the Consent & Preferences Management agent for the preferred-language
 * preference (English when unset) and to the Language Access agent for the
 * qualified-interpreter plan. Deterministic — a pure function of the
 * caller-provided asOfDate (no clock).
 */
export type PatientAcpContext = {
  /** Synthetic, de-identified patient reference (e.g. "acp-patient-001"). */
  patientRef: string;
  /**
   * The patient's preferred language code (defers to Consent & Preferences
   * Management). Defaults to English when unset.
   */
  preferredLanguageCode?: string;
  /**
   * Whether a QUALIFIED medical interpreter has been arranged for this
   * conversation (defers to Language Access). Required for an LEP patient
   * before an actionable ACP prompt may be drafted.
   */
  qualifiedInterpreterPlanned?: boolean;
  /**
   * Whether the patient has a serious-illness flag on their record (illustrative).
   * Only when true is POLST/MOLST a recommended directive. Defaults to false.
   */
  seriousIllness?: boolean;
  /** ISO date the assessment is `as of` (accepted as data — no clock). */
  asOfDate: string;
  /** The directives claimed on file (each catalog-sourced with a recorded source). */
  directivesOnFile?: DirectiveOnFile[];
};

/** The per-directive status the agent reports for a patient. */
export type DirectiveStatus =
  | "on-file"
  | "on-file-stale"
  | "missing"
  | "not-applicable";

/** A per-directive assessment entry. */
export type DirectiveAssessment = {
  /** The ACP directive catalog id this entry is about (never invented). */
  directiveId: string;
  /** Copied from the catalog for display convenience. */
  directiveLabel: string;
  /**
   * Whether this directive is recommended for THIS patient — true for every
   * universally-recommended directive, and for conditional ones only when
   * the seriousIllness flag is on.
   */
  recommended: boolean;
  /** Status against the patient's directives-on-file. */
  status: DirectiveStatus;
  /** Executed date, when on file (illustrative — accepted as data). */
  executedDate?: string;
  /** Age in days (asOfDate - executedDate), when on file. */
  ageInDays?: number;
  /** Approved source label, when on file. */
  source?: string;
  /** Language the executed document is in, when on file. */
  languageCode?: string;
};

/** Flagged gaps / integrity concerns surfaced by the assessment. */
export type AcpFlagKind =
  | "missing-universal-directive"
  | "stale-directive"
  | "conditional-directive-recommended"
  | "off-catalog-source"
  | "language-access-required"
  | "language-mismatch";

export type AcpFlagSeverity = "routine" | "elevated" | "urgent";

/** A flagged ACP gap (a safe output — not a governance block). */
export type AcpFlag = {
  /** Which kind of ACP gap this is. */
  kind: AcpFlagKind;
  /** Human-readable flag label. */
  label: string;
  /** Deterministic severity. */
  severity: AcpFlagSeverity;
  /** Human-readable detail. */
  detail: string;
};

/**
 * The consent-gated conversation prompt the agent drafts for the care team.
 * State is "drafted" for the normal path (a clinician then delivers it), or
 * "withheld-language-access-required" when the patient is LEP and no
 * qualified-interpreter plan is documented — the agent WITHHOLDS the active
 * prompt (a safe completed answer) rather than draft a prompt the patient
 * cannot participate in. NEVER a directive change.
 */
export type ConversationPromptState =
  | "drafted"
  | "withheld-language-access-required";

export type ConversationPrompt = {
  /** drafted (delivered by a clinician) / withheld-language-access-required. */
  state: ConversationPromptState;
  /** True unless withheld. */
  actionable: boolean;
  /** The patient's preferred language for the conversation. */
  languageCode: string;
  /** Whether a qualified interpreter has been arranged. */
  qualifiedInterpreterPlanned: boolean;
  /** Human-readable prompt body (rule-based / templated — never a live-model narrative). */
  body: string;
};

/** The deterministic ACP assessment the agent returns. */
export type AcpAssessment = {
  /** The synthetic patient reference this assessment is about. */
  patientRef: string;
  /** The as-of date the assessment was computed against. */
  asOfDate: string;
  /** The preferred language (defers to consent). */
  preferredLanguageCode: string;
  /** Whether a qualified-interpreter plan is documented. */
  qualifiedInterpreterPlanned: boolean;
  /** Per-directive assessment (one per ACP_DIRECTIVES, in catalog order). */
  perDirective: DirectiveAssessment[];
  /**
   * Completeness — count of recommended directives on file (not stale) over
   * count of recommended directives, as a fraction in [0, 1]. Illustrative.
   */
  completeness: number;
  /** Flagged ACP gaps (ranked by severity; a safe output, not a block). */
  flags: AcpFlag[];
  /** The consent-gated conversation prompt (never a directive change). */
  conversationPrompt: ConversationPrompt;
  /** Always true — the directive catalog + sources are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** A directive-change PROPOSAL — always human-signoff-gated, never applied. */
export type DirectiveChangeState = "draft" | "ready-for-clinician-and-patient";

export type DirectiveChangeProposal = {
  /** draft / ready-for-clinician-and-patient. */
  state: DirectiveChangeState;
  /** The directive catalog id this proposal is about (never invented). */
  directiveId: string;
  /** Human-readable label of the proposed change. */
  proposedChange: string;
  /** Always true — a change ALWAYS requires clinician + patient sign-off. */
  requiresClinicianAndPatientSignoff: true;
  /** Always false — the agent NEVER autonomously applies a directive change. */
  applied: false;
  /** Human-readable proposal body. */
  body: string;
};

const SEVERITY_ORDER: Record<AcpFlagSeverity, number> = {
  urgent: 0,
  elevated: 1,
  routine: 2
};

/** Days between two ISO dates (asOf - executed), or Infinity if invalid. */
function daysBetween(asOf: string, executed: string): number {
  const a = Date.parse(asOf);
  const e = Date.parse(executed);
  if (Number.isNaN(a) || Number.isNaN(e)) return Number.POSITIVE_INFINITY;
  return Math.floor((a - e) / (1000 * 60 * 60 * 24));
}

/**
 * Assess a single patient's ACP state. DETERMINISTIC: checks the directives-
 * on-file against the ACP catalog, applies the staleness threshold, decides
 * whether POLST is applicable (only when serious-illness is flagged), flags
 * missing / stale / language-access gaps, and drafts a consent-gated
 * conversation prompt — WITHHELD when the patient is LEP and no qualified
 * interpreter plan is documented. A pure function of the context + as-of date
 * (no randomness, no clock).
 */
export function assessAdvanceCarePlanning(ctx: PatientAcpContext): AcpAssessment {
  const preferredLanguageCode =
    ctx.preferredLanguageCode ?? CLINICAL_DEFAULT_LANGUAGE_CODE;
  const isLep = preferredLanguageCode !== CLINICAL_DEFAULT_LANGUAGE_CODE;
  const qualifiedInterpreterPlanned = ctx.qualifiedInterpreterPlanned === true;
  const seriousIllness = ctx.seriousIllness === true;

  // Only consider on-file entries whose id + source are catalog-valid; the
  // off-catalog-source guard SURFACES fabricated entries via a flag, but the
  // per-directive assessment relies only on legitimate ones (the guard is
  // enforced separately by directivesTraceToCatalog()).
  const onFile = Array.isArray(ctx.directivesOnFile) ? ctx.directivesOnFile : [];
  const legitimateOnFile = onFile.filter(
    (d) => isAcpDirective(d.directiveId) && isApprovedSource(d.source)
  );
  const legitimateByDirective = new Map(
    legitimateOnFile.map((d) => [d.directiveId, d])
  );

  const perDirective: DirectiveAssessment[] = ACP_DIRECTIVES.map((directive) => {
    const recommended =
      directive.universallyRecommended || (directive.id === "directive.polst" && seriousIllness);
    const filed = legitimateByDirective.get(directive.id);
    if (!filed) {
      return {
        directiveId: directive.id,
        directiveLabel: directive.label,
        recommended,
        status: recommended ? "missing" : "not-applicable"
      };
    }
    const ageInDays = daysBetween(ctx.asOfDate, filed.executedDate);
    const stale = ageInDays > STALENESS_THRESHOLD_DAYS;
    return {
      directiveId: directive.id,
      directiveLabel: directive.label,
      recommended,
      status: stale ? "on-file-stale" : "on-file",
      executedDate: filed.executedDate,
      ageInDays,
      source: filed.source,
      languageCode: filed.languageCode
    };
  });

  const recommendedCount = perDirective.filter((d) => d.recommended).length;
  const onFileCount = perDirective.filter(
    (d) => d.recommended && d.status === "on-file"
  ).length;
  const completeness = recommendedCount === 0 ? 1 : onFileCount / recommendedCount;

  const flags: AcpFlag[] = [];

  for (const entry of perDirective) {
    if (!entry.recommended) continue;
    if (entry.status === "missing") {
      const universal =
        getDirective(entry.directiveId)?.universallyRecommended === true;
      if (universal) {
        flags.push({
          kind: "missing-universal-directive",
          label: `${entry.directiveLabel} not on file`,
          severity: "elevated",
          detail: `a ${entry.directiveLabel.toLowerCase()} is universally recommended at a midlife touchpoint but is not on file for this patient`
        });
      } else {
        flags.push({
          kind: "conditional-directive-recommended",
          label: `${entry.directiveLabel} recommended (serious illness on file)`,
          severity: "elevated",
          detail: `a ${entry.directiveLabel.toLowerCase()} is recommended when a serious-illness flag is on file — offer the conversation to this patient`
        });
      }
    } else if (entry.status === "on-file-stale") {
      flags.push({
        kind: "stale-directive",
        label: `${entry.directiveLabel} on file but > ${Math.floor(
          STALENESS_THRESHOLD_DAYS / 365
        )} years old`,
        severity: "routine",
        detail: `${entry.directiveLabel.toLowerCase()} executed on ${entry.executedDate} (${entry.ageInDays} days ago) — flag for a review conversation`
      });
    }
  }

  // Off-catalog / verbal-not-documented sources are surfaced as flags (a
  // legitimate ledger may still hold non-legitimate claims to review).
  for (const claim of onFile) {
    if (!isAcpDirective(claim.directiveId) || !isApprovedSource(claim.source)) {
      flags.push({
        kind: "off-catalog-source",
        label: `Claimed directive with an unapproved / off-catalog source`,
        severity: "elevated",
        detail: `claimed directiveId=${claim.directiveId} · source=${claim.source} — a verbal or ad-hoc source does not count as a directive on file; document and re-execute`
      });
    }
    if (
      isAcpDirective(claim.directiveId) &&
      isApprovedSource(claim.source) &&
      typeof claim.languageCode === "string" &&
      claim.languageCode !== preferredLanguageCode
    ) {
      flags.push({
        kind: "language-mismatch",
        label: `${getDirective(claim.directiveId)?.label} on file in ${claim.languageCode}, not the preferred language`,
        severity: "routine",
        detail: `the executed document is in ${claim.languageCode} but the patient's preferred language is ${preferredLanguageCode} — offer a language-access review`
      });
    }
  }

  if (isLep && !qualifiedInterpreterPlanned) {
    flags.push({
      kind: "language-access-required",
      label: "Qualified interpreter required for the ACP conversation (LEP patient)",
      severity: "urgent",
      detail: `the patient's preferred language is ${preferredLanguageCode} (LEP) but no qualified-interpreter plan is documented — defer to the Language Access & Health Equity agent before drafting an active ACP conversation`
    });
  }

  flags.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.kind.localeCompare(b.kind)
  );

  const conversationPrompt: ConversationPrompt =
    isLep && !qualifiedInterpreterPlanned
      ? {
          state: "withheld-language-access-required",
          actionable: false,
          languageCode: preferredLanguageCode,
          qualifiedInterpreterPlanned: false,
          body:
            `Advance-care-planning conversation is withheld pending a qualified-interpreter plan: the patient's preferred language is ${preferredLanguageCode} (LEP) and no interpreter is documented. ` +
            "Defer to the Language Access & Health Equity agent to arrange a qualified medical interpreter, then re-run this assessment. The agent will not ask a clinician to hold a legally-consequential conversation the patient cannot participate in."
        }
      : {
          state: "drafted",
          actionable: true,
          languageCode: preferredLanguageCode,
          qualifiedInterpreterPlanned,
          body:
            `Advance-care-planning midlife-touchpoint conversation prompt for the care team: review ${
              perDirective
                .filter((d) => d.recommended)
                .map(
                  (d) =>
                    `${d.directiveLabel} (${
                      d.status === "on-file"
                        ? "on file"
                        : d.status === "on-file-stale"
                        ? `stale, ${d.ageInDays}d`
                        : "missing"
                    })`
                )
                .join(", ") || "no recommended directives"
            }. ` +
            "A clinician delivers this conversation and, together with the patient, decides whether to execute, update, or ratify a directive. The agent NEVER creates, updates, or overrides a directive on its own."
        };

  const note =
    `Assessed advance-care-planning for ${ctx.patientRef} as of ${ctx.asOfDate}: ${onFileCount}/${recommendedCount} recommended directive${
      recommendedCount === 1 ? "" : "s"
    } on file (completeness ${Math.round(completeness * 100)}%), ${flags.length} flag${
      flags.length === 1 ? "" : "s"
    }. Conversation prompt ${conversationPrompt.state}. ` +
    "Every directive on file traces to the illustrative catalog + an approved source; the agent NEVER creates, updates, or overrides a directive — every change requires clinician + patient sign-off; and for an LEP patient the active prompt is withheld until a qualified-interpreter plan is documented. Synthetic/illustrative directives, sources, and thresholds — not a certified directives registry.";

  return {
    patientRef: ctx.patientRef,
    asOfDate: ctx.asOfDate,
    preferredLanguageCode,
    qualifiedInterpreterPlanned,
    perDirective,
    completeness,
    flags,
    conversationPrompt,
    synthetic: true,
    note
  };
}

/**
 * Propose a directive change for a clinician + patient to sign off on.
 * Deterministic on its input. NEVER autonomously applied:
 * requiresClinicianAndPatientSignoff is always true, applied is always false.
 */
export function proposeDirectiveChange(input: {
  directiveId: string;
  proposedChange: string;
}): DirectiveChangeProposal {
  const label = getDirective(input.directiveId)?.label ?? input.directiveId;
  return {
    state: "ready-for-clinician-and-patient",
    directiveId: input.directiveId,
    proposedChange: input.proposedChange,
    requiresClinicianAndPatientSignoff: true,
    applied: false,
    body:
      `Proposed ${label} change: ${input.proposedChange}. ` +
      "Ready for clinician + patient sign-off — the agent NEVER creates, updates, or overrides a directive on its own."
  };
}

/**
 * Source-integrity check: does EVERY directive claimed on file trace to the
 * ACP directive catalog AND to an approved source, with a recorded
 * executedDate? True when every entry meets all three; the guard that catches
 * a caller-asserted off-catalog directive id, an unapproved / verbal source,
 * or a missing execution date. This is the honest signal the route reports to
 * policy.acp.directive-source-integrity. A non-array input is a violation.
 */
export function directivesTraceToCatalog(
  onFile:
    | Array<{ directiveId?: string; source?: string; executedDate?: string }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(onFile)) return false;
  return onFile.every(
    (d) =>
      isAcpDirective(d.directiveId) &&
      isApprovedSource(d.source) &&
      typeof d.executedDate === "string" &&
      d.executedDate.length > 0
  );
}

/**
 * Human-signoff check: does EVERY directive-change proposal require clinician
 * AND patient sign-off, and is it explicitly NOT applied? True for anything
 * proposeDirectiveChange() produces; the guard that catches a caller-asserted
 * plan that would autonomously apply a directive change or bypass sign-off.
 * This is the honest signal the route reports to
 * policy.acp.no-autonomous-directive-change. A non-array input is a violation.
 */
export function directiveChangeRequiresHumanSignoff(
  proposals:
    | Array<{
        requiresClinicianAndPatientSignoff?: boolean;
        applied?: boolean;
        state?: string;
      }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(proposals)) return false;
  return proposals.every((p) => {
    if (p.requiresClinicianAndPatientSignoff !== true) return false;
    if (p.applied === true) return false;
    return true;
  });
}

/**
 * Language-access check: for an LEP patient (preferred language != English),
 * the conversation-prompt plan must have a documented qualified-interpreter
 * plan, or it must be WITHHELD. True when the patient is not LEP; when the
 * patient is LEP and interpreter is planned; or when the prompt state is the
 * withheld-language-access-required safe answer. The guard that catches a
 * caller-asserted plan claiming an active ACP conversation for an LEP patient
 * with no interpreter plan. This is the honest signal the route reports to
 * policy.acp.language-access-integrity. A non-object input is a violation.
 */
export function languageAccessSatisfied(
  plan:
    | {
        preferredLanguageCode?: string;
        qualifiedInterpreterPlanned?: boolean;
        conversationPromptState?: string;
      }
    | null
    | undefined
): boolean {
  if (!plan || typeof plan !== "object") return false;
  const code = plan.preferredLanguageCode ?? CLINICAL_DEFAULT_LANGUAGE_CODE;
  const isLep = code !== CLINICAL_DEFAULT_LANGUAGE_CODE;
  if (!isLep) return true;
  if (plan.qualifiedInterpreterPlanned === true) return true;
  return plan.conversationPromptState === "withheld-language-access-required";
}

/**
 * A representative, deterministic demo patient (illustrative). A midlife
 * English-speaking patient with a DPOA-HC on file but no living will — so the
 * happy path (a drafted conversation prompt + a missing-universal-directive
 * flag) is demonstrable. Synthetic / de-identified.
 */
export const DEMO_ACP_PATIENT: PatientAcpContext = {
  patientRef: "acp-patient-001",
  preferredLanguageCode: "en",
  asOfDate: "2026-07-01",
  directivesOnFile: [
    {
      directiveId: "directive.dpoahc",
      source: "attorney-executed",
      executedDate: "2023-04-12",
      languageCode: "en"
    }
  ]
};

/**
 * A representative LEP demo patient (illustrative). A Spanish-preferring
 * midlife patient with no directives on file and no interpreter plan — so the
 * withheld / language-access-required path is demonstrable as a safe
 * completed answer. Synthetic / de-identified.
 */
export const DEMO_LEP_ACP_PATIENT: PatientAcpContext = {
  patientRef: "acp-patient-002",
  preferredLanguageCode: "es",
  asOfDate: "2026-07-01",
  qualifiedInterpreterPlanned: false,
  directivesOnFile: []
};
