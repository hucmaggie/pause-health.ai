/**
 * Clinical Trials & Research Matching — deterministic eligibility matching of a
 * single patient against a synthetic catalog of menopause/midlife research
 * studies, with a consent-gated outreach draft that NEVER auto-enrolls.
 *
 * Deterministic, dependency-free domain core the Clinical Trials & Research
 * Matching Agent (app/api/agents/clinical-trials) wraps — the Salesforce
 * "Agentforce for Health" / Health Cloud clinical-trials / research-matching
 * analog on Pause's Agent Fabric. It evaluates a patient's STRUCTURED context
 * (age band, symptom profile, comorbidities, geography, prior therapy, HRT
 * status, postmenopausal status) against each study's DEFINED eligibility
 * criteria (inclusion + exclusion), returns the matching studies ranked with
 * per-criterion match explanations, and drafts a consent-gated outreach — it
 * never auto-enrolls a patient (informed consent + a human are required).
 *
 *   Inbound:  a PatientTrialContext (structured, de-identified patient signals;
 *             a synthetic patientRef — clearly labeled illustrative), plus
 *             whether the patient's RESEARCH consent is present
 *   Outbound: a TrialMatchResult { matches[] (each: eligible, matchedCriteria[],
 *             failedCriteria[], matchScore), eligibleCount, recommendedStudyIds[],
 *             outreach (consent-gated, never enrolled), synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: eligibility traces to defined criteria.
 * ─────────────────────────────────────────────────────────────────────
 *  Every eligibility determination must trace to the study catalog's DEFINED
 *  criteria (TRIAL_CRITERIA) — there is no fabricated / ad-hoc eligibility.
 *  matchTrials() only ever emits catalog criterion ids, and
 *  eligibilityTracesToCriteria() reports the honest signal the Agent Fabric
 *  enforces via policy.trials.eligibility-criteria-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: research consent is required before outreach.
 * ─────────────────────────────────────────────────────────────────────
 *  No trial outreach (or enrollment step) happens without the patient's RESEARCH
 *  consent. draftTrialOutreach() returns a consent-required state — it does NOT
 *  draft an active outreach — when research consent is not present, and
 *  outreachHasResearchConsent() reports the honest signal the Agent Fabric
 *  enforces via policy.trials.research-consent-required. This ties to the
 *  Consent & Preferences Management agent's `research` consent scope (withheld by
 *  default in that agent's demo ledger); this agent does its own eligibility
 *  logic but defers to that authoritative research-consent state before reaching
 *  out.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the agent never enrolls a patient autonomously.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent may NEVER enroll a patient in a study on its own — enrollment
 *  requires informed consent AND a human. Every outreach is requiresHuman:true /
 *  enrolled:false (there is no "enrolled" state), and enrollmentRequiresHuman()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.trials.no-autonomous-enrollment.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified trial-eligibility engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The study catalog, sponsor labels, and eligibility criteria below are
 *  ILLUSTRATIVE synthetic/demo values chosen to model the SHAPE of structured
 *  trial-eligibility matching — they are NOT real studies, real sponsors, or a
 *  certified / clinically-authoritative eligibility engine (real trial criteria
 *  are protocol-specific, individualized, and continuously updated). The
 *  patientRef is synthetic/de-identified. There is NO randomness and NO clock
 *  anywhere here: eligibility is a pure function of the patient context the
 *  caller passes against the defined criteria (dates, if any, are accepted as
 *  data), so the same context always yields the same matches + ranking (with a
 *  documented, stable tie-break) — which is what lets the demo, the seeded
 *  trace, and the tests agree.
 */

/** Whether a criterion is an inclusion (must meet) or exclusion (must be clear of). */
export type TrialCriterionKind = "inclusion" | "exclusion";

/**
 * A single documented eligibility criterion in the (illustrative) catalog. This
 * is the ONLY source of legitimate eligibility logic — a study references these
 * by id and matchTrials() evaluates them, so an eligibility determination can
 * never reference a criterion that isn't defined here. Illustrative — not a
 * certified eligibility rule.
 */
export type TrialCriterion = {
  /** Stable catalog id every criterion evaluation references. */
  id: string;
  /** Human-readable criterion label. */
  label: string;
  /** inclusion = patient must meet it; exclusion = patient must be clear of it. */
  kind: TrialCriterionKind;
  /**
   * The (illustrative) reason this criterion exists. NOT a certified protocol
   * citation — a demo-honest description.
   */
  rationale: string;
};

/**
 * The eligibility-criterion catalog. Illustrative/synthetic; NOT a certified
 * eligibility rule set (see the module header). A small, menopause/midlife-
 * relevant set of inclusion + exclusion criteria the synthetic studies compose.
 */
export const TRIAL_CRITERIA: TrialCriterion[] = [
  {
    id: "crit.age-midlife",
    label: "Age within the midlife band (40–60)",
    kind: "inclusion",
    rationale:
      "Menopause/midlife studies enroll within a midlife age band. (Illustrative — not a certified eligibility rule.)"
  },
  {
    id: "crit.postmenopausal",
    label: "Postmenopausal status",
    kind: "inclusion",
    rationale:
      "A postmenopausal cohort is required for some bone-health / hormone studies. (Illustrative — not a certified eligibility rule.)"
  },
  {
    id: "crit.vasomotor-symptoms",
    label: "Moderate–severe vasomotor symptoms (hot flashes / night sweats)",
    kind: "inclusion",
    rationale:
      "Vasomotor-symptom trials require a reported vasomotor symptom burden. (Illustrative — not a certified eligibility rule.)"
  },
  {
    id: "crit.insomnia-symptoms",
    label: "Sleep disturbance / insomnia symptoms",
    kind: "inclusion",
    rationale:
      "Sleep studies require a reported sleep-disturbance / insomnia symptom. (Illustrative — not a certified eligibility rule.)"
  },
  {
    id: "crit.osteoporosis-risk",
    label: "Osteoporosis / osteopenia (bone-loss) risk",
    kind: "inclusion",
    rationale:
      "Bone-health studies enroll patients with an osteoporosis / osteopenia risk. (Illustrative — not a certified eligibility rule.)"
  },
  {
    id: "crit.geography-us",
    label: "US-based (study geography)",
    kind: "inclusion",
    rationale:
      "The synthetic study sites are US-based; a patient's region must match the study geography. (Illustrative — not a certified eligibility rule.)"
  },
  {
    id: "crit.excl-active-cancer",
    label: "No active hormone-sensitive cancer",
    kind: "exclusion",
    rationale:
      "An active hormone-sensitive cancer excludes hormone / hormone-adjacent studies. (Illustrative — not a certified eligibility rule.)"
  },
  {
    id: "crit.excl-current-hrt",
    label: "Not currently on hormone therapy",
    kind: "exclusion",
    rationale:
      "A hormone-initiation trial excludes patients already on hormone therapy. (Illustrative — not a certified eligibility rule.)"
  },
  {
    id: "crit.excl-prior-investigational",
    label: "No prior investigational hormone therapy",
    kind: "exclusion",
    rationale:
      "Prior investigational-therapy exposure excludes a patient from some registries. (Illustrative — not a certified eligibility rule.)"
  }
];

const CRITERION_BY_ID = new Map(TRIAL_CRITERIA.map((c) => [c.id, c]));

/** Is `id` a defined eligibility-criterion catalog id? */
export function isTrialCriterion(id: unknown): boolean {
  return typeof id === "string" && CRITERION_BY_ID.has(id);
}

/** Look up an eligibility criterion by id (undefined for an off-catalog id). */
export function getTrialCriterion(id: string): TrialCriterion | undefined {
  return CRITERION_BY_ID.get(id);
}

/**
 * A synthetic research study / clinical trial in the (illustrative) catalog.
 * `criteriaIds` reference TRIAL_CRITERIA — the eligibility logic is composed
 * from defined criteria, never invented per study. Illustrative — NOT a real
 * study, sponsor, or protocol.
 */
export type Study = {
  /** Stable catalog id every StudyMatch references. */
  id: string;
  /** Human-readable study title (synthetic). */
  title: string;
  /** Sponsor label (clearly-labeled synthetic / illustrative). */
  sponsor: string;
  /** Phase / study type (e.g. "Interventional · Phase II", "Observational", "Registry"). */
  phase: string;
  /** Study geography / setting (synthetic). */
  location: string;
  /** The eligibility criteria (catalog ids) this study composes — inclusion + exclusion. */
  criteriaIds: string[];
  /** Always true — the study, sponsor, and criteria are illustrative synthetics. */
  synthetic: true;
};

/**
 * The synthetic study catalog. This is the ONLY source of studies matchTrials()
 * ranks over. Illustrative/synthetic values; NOT real studies or a certified
 * eligibility engine (see the module header).
 */
export const STUDY_CATALOG: Study[] = [
  {
    id: "study.vms-nonhormonal-rct",
    title: "Non-Hormonal Therapy for Moderate–Severe Vasomotor Symptoms",
    sponsor: "Synthetic Menopause Research Collaborative (illustrative)",
    phase: "Interventional · Phase II",
    location: "US · multi-site (synthetic)",
    criteriaIds: [
      "crit.age-midlife",
      "crit.vasomotor-symptoms",
      "crit.geography-us",
      "crit.excl-active-cancer",
      "crit.excl-current-hrt"
    ],
    synthetic: true
  },
  {
    id: "study.sleep-cbt-observational",
    title: "Sleep & Insomnia in the Menopause Transition (Observational)",
    sponsor: "Synthetic Midlife Sleep Consortium (illustrative)",
    phase: "Observational",
    location: "US · remote (synthetic)",
    criteriaIds: ["crit.age-midlife", "crit.insomnia-symptoms", "crit.geography-us"],
    synthetic: true
  },
  {
    id: "study.bone-health-registry",
    title: "Postmenopausal Bone-Health Longitudinal Registry",
    sponsor: "Synthetic Osteoporosis Prevention Network (illustrative)",
    phase: "Registry",
    location: "US · multi-site (synthetic)",
    criteriaIds: [
      "crit.postmenopausal",
      "crit.osteoporosis-risk",
      "crit.geography-us",
      "crit.excl-prior-investigational"
    ],
    synthetic: true
  },
  {
    id: "study.hrt-initiation-rct",
    title: "Hormone-Therapy Initiation & Cardiometabolic Outcomes",
    sponsor: "Synthetic Women's Cardiometabolic Health Group (illustrative)",
    phase: "Interventional · Phase III",
    location: "US · multi-site (synthetic)",
    criteriaIds: [
      "crit.age-midlife",
      "crit.vasomotor-symptoms",
      "crit.geography-us",
      "crit.excl-current-hrt",
      "crit.excl-active-cancer"
    ],
    synthetic: true
  }
];

const STUDY_BY_ID = new Map(STUDY_CATALOG.map((s) => [s.id, s]));

/** Is `id` a defined study-catalog id? */
export function isCatalogStudy(id: unknown): boolean {
  return typeof id === "string" && STUDY_BY_ID.has(id);
}

/** Look up a study by id (undefined for an off-catalog id). */
export function getStudy(id: string): Study | undefined {
  return STUDY_BY_ID.get(id);
}

/**
 * The structured, de-identified patient signals the matcher reads. Every field
 * is optional (a missing signal simply fails the criteria that need it), so a
 * partial context matches cleanly. `patientRef` is a synthetic, de-identified id
 * — clearly labeled illustrative. Deterministic: no clock — any dates are data.
 */
export type PatientTrialContext = {
  /** Synthetic, de-identified patient reference (e.g. "trial-patient-001"). */
  patientRef: string;
  /** Age band, e.g. "40-45", "46-50", "51-55", "56-60". */
  ageBand?: string;
  /** Whether the patient is postmenopausal. */
  postmenopausal?: boolean;
  /** Reported symptom profile, e.g. ["hot_flashes", "insomnia"]. */
  symptoms?: string[];
  /** Reported comorbidities, e.g. ["osteopenia"], ["active_cancer"]. */
  comorbidities?: string[];
  /** Region / geography, e.g. "US-CA", "US-NY". */
  region?: string;
  /** Prior therapy exposure, e.g. ["investigational_hormone"]. */
  priorTherapies?: string[];
  /** Whether the patient is currently on hormone therapy. */
  onHrt?: boolean;
};

/** A single criterion's evaluation against the patient context. */
export type CriterionEvaluation = {
  /** The eligibility-criterion catalog id (never invented). */
  criterionId: string;
  /** Copied from the catalog for display convenience. */
  label: string;
  /** inclusion / exclusion. */
  kind: TrialCriterionKind;
  /** Whether the patient satisfies the criterion (inclusion met / not excluded). */
  met: boolean;
  /** Human-readable detail (why it was met / not met). */
  detail: string;
};

/** A single study's deterministic match result for the patient. */
export type StudyMatch = {
  /** The study-catalog id this match is about. */
  studyId: string;
  /** Copied from the catalog for display convenience. */
  title: string;
  /** True iff every criterion is met. */
  eligible: boolean;
  /** Criteria the patient satisfied (each references a catalog criterion). */
  matchedCriteria: CriterionEvaluation[];
  /** Criteria the patient did not satisfy (each references a catalog criterion). */
  failedCriteria: CriterionEvaluation[];
  /** Count of criteria met (used for a deterministic, stable ranking). */
  matchScore: number;
};

/** The state of a consent-gated outreach draft. NEVER "enrolled". */
export type TrialOutreachState = "drafted" | "consent-required" | "no-eligible-studies";

/**
 * A consent-gated outreach draft. It is ALWAYS human-gated and never enrolled:
 * requiresHuman is true, requiresInformedConsent is true, and enrolled is false
 * for every state. When research consent is absent the state is
 * "consent-required" and NO active outreach is drafted (invitedStudyIds is
 * empty).
 */
export type TrialOutreach = {
  /** drafted (consent present + eligible) / consent-required / no-eligible-studies. */
  state: TrialOutreachState;
  /** The eligible studies the outreach would invite the patient to consider (empty unless drafted). */
  invitedStudyIds: string[];
  /** Draft body (no PII; study + invitation-to-consider only). */
  body: string;
  /** Whether the patient's research consent is present (drives the state). */
  researchConsentPresent: boolean;
  /** Always true — informed consent is required before any enrollment step. */
  requiresInformedConsent: true;
  /** Always true — a human is required; the agent never enrolls autonomously. */
  requiresHuman: true;
  /** Always false — the agent never enrolls a patient. There is no "enrolled" state. */
  enrolled: false;
};

/** The deterministic trial-matching result the agent returns. */
export type TrialMatchResult = {
  /** The synthetic patient reference this result is about. */
  patientRef: string;
  /** Per-study matches, deterministically ranked (eligible first, then score, then id). */
  matches: StudyMatch[];
  /** Count of eligible studies. */
  eligibleCount: number;
  /** Eligible study ids in ranked order (the recommended studies to consider). */
  recommendedStudyIds: string[];
  /** The consent-gated outreach draft (never enrolled). */
  outreach: TrialOutreach;
  /** Always true — the catalog, sponsors, and criteria are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** The midlife age bands crit.age-midlife accepts (illustrative). */
const MIDLIFE_AGE_BANDS = new Set(["40-45", "46-50", "51-55", "56-60"]);

function hasAny(list: string[] | undefined, values: string[]): boolean {
  if (!Array.isArray(list)) return false;
  return values.some((v) => list.includes(v));
}

/**
 * Does the patient SATISFY a given criterion? For an inclusion criterion, met
 * means the patient meets the requirement; for an exclusion criterion, met means
 * the exclusion does NOT apply (the patient is clear of it). Deterministic — a
 * pure function of the context. An off-catalog / unknown criterion is never met.
 */
function criterionMet(criterionId: string, ctx: PatientTrialContext): boolean {
  switch (criterionId) {
    case "crit.age-midlife":
      return typeof ctx.ageBand === "string" && MIDLIFE_AGE_BANDS.has(ctx.ageBand);
    case "crit.postmenopausal":
      return ctx.postmenopausal === true;
    case "crit.vasomotor-symptoms":
      return hasAny(ctx.symptoms, ["hot_flashes", "night_sweats", "vasomotor"]);
    case "crit.insomnia-symptoms":
      return hasAny(ctx.symptoms, ["insomnia", "sleep_disturbance"]);
    case "crit.osteoporosis-risk":
      return hasAny(ctx.comorbidities, ["osteoporosis", "osteopenia"]);
    case "crit.geography-us":
      return typeof ctx.region === "string" && ctx.region.toUpperCase().startsWith("US");
    case "crit.excl-active-cancer":
      // Clear of the exclusion when no active hormone-sensitive cancer is reported.
      return !hasAny(ctx.comorbidities, ["active_cancer", "hormone_sensitive_cancer"]);
    case "crit.excl-current-hrt":
      // Clear of the exclusion when the patient is not currently on hormone therapy.
      return ctx.onHrt !== true;
    case "crit.excl-prior-investigational":
      // Clear of the exclusion when no prior investigational-hormone exposure.
      return !hasAny(ctx.priorTherapies, ["investigational_hormone"]);
    default:
      return false;
  }
}

function criterionDetail(
  criterion: TrialCriterion,
  met: boolean,
  ctx: PatientTrialContext
): string {
  switch (criterion.id) {
    case "crit.age-midlife":
      return `age band ${ctx.ageBand ?? "unknown"}`;
    case "crit.postmenopausal":
      return `postmenopausal ${ctx.postmenopausal === true ? "yes" : "no"}`;
    case "crit.vasomotor-symptoms":
      return `symptoms ${(ctx.symptoms ?? []).join(", ") || "none"}`;
    case "crit.insomnia-symptoms":
      return `symptoms ${(ctx.symptoms ?? []).join(", ") || "none"}`;
    case "crit.osteoporosis-risk":
      return `comorbidities ${(ctx.comorbidities ?? []).join(", ") || "none"}`;
    case "crit.geography-us":
      return `region ${ctx.region ?? "unknown"}`;
    case "crit.excl-active-cancer":
      return met
        ? "no active hormone-sensitive cancer reported"
        : "active hormone-sensitive cancer reported";
    case "crit.excl-current-hrt":
      return met ? "not currently on hormone therapy" : "currently on hormone therapy";
    case "crit.excl-prior-investigational":
      return met
        ? "no prior investigational hormone therapy"
        : "prior investigational hormone therapy reported";
    default:
      return criterion.label;
  }
}

/**
 * Evaluate a single study against the patient context. DETERMINISTIC: iterates
 * the study's DEFINED criteria (all from TRIAL_CRITERIA), decides each met /
 * not-met, and marks the study eligible iff every criterion is met. Every
 * emitted criterion references a catalog id by construction. A criterion id the
 * study references that isn't in the catalog is skipped (never fabricated).
 */
export function matchStudy(study: Study, ctx: PatientTrialContext): StudyMatch {
  const matchedCriteria: CriterionEvaluation[] = [];
  const failedCriteria: CriterionEvaluation[] = [];

  for (const criterionId of study.criteriaIds) {
    const criterion = getTrialCriterion(criterionId);
    if (!criterion) continue; // never emit an off-catalog criterion
    const met = criterionMet(criterionId, ctx);
    const evaluation: CriterionEvaluation = {
      criterionId,
      label: criterion.label,
      kind: criterion.kind,
      met,
      detail: criterionDetail(criterion, met, ctx)
    };
    if (met) matchedCriteria.push(evaluation);
    else failedCriteria.push(evaluation);
  }

  return {
    studyId: study.id,
    title: study.title,
    eligible: failedCriteria.length === 0,
    matchedCriteria,
    failedCriteria,
    matchScore: matchedCriteria.length
  };
}

/**
 * Rank study matches deterministically: eligible first, then by matchScore
 * descending, with a stable, documented tie-break on studyId ascending
 * (lexical) — so the same patient always yields the same ranking.
 */
export function rankMatches(matches: StudyMatch[]): StudyMatch[] {
  return [...matches].sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      b.matchScore - a.matchScore ||
      a.studyId.localeCompare(b.studyId)
  );
}

/**
 * Draft a consent-gated outreach for a set of eligible studies. Deterministic on
 * its inputs. NEVER auto-enrolls: the draft is always requiresHuman:true,
 * requiresInformedConsent:true, and enrolled:false. When research consent is NOT
 * present it returns a "consent-required" state and does NOT draft an active
 * outreach (invitedStudyIds is empty); when there are no eligible studies it
 * returns "no-eligible-studies"; otherwise it drafts an invitation-to-consider.
 * This defers to the patient's `research` consent scope (the scope the Consent &
 * Preferences Management agent holds — withheld by default in that demo ledger).
 */
export function draftTrialOutreach(
  recommendedStudyIds: string[],
  researchConsent: boolean | undefined
): TrialOutreach {
  const researchConsentPresent = researchConsent === true;
  const hasEligible = recommendedStudyIds.length > 0;

  const base = {
    researchConsentPresent,
    requiresInformedConsent: true,
    requiresHuman: true,
    enrolled: false
  } as const;

  if (!hasEligible) {
    return {
      ...base,
      state: "no-eligible-studies",
      invitedStudyIds: [],
      body:
        "No eligible synthetic studies matched this patient's structured context — no outreach drafted. (Illustrative — not a certified eligibility engine.)"
    };
  }

  if (!researchConsentPresent) {
    return {
      ...base,
      state: "consent-required",
      invitedStudyIds: [],
      body:
        "Research consent is not present for this patient, so no trial outreach is drafted. Capture the patient's `research` consent scope (via the Consent & Preferences Management agent) before any invitation — the agent never reaches out, and never enrolls, without informed consent + a human."
    };
  }

  return {
    ...base,
    state: "drafted",
    invitedStudyIds: [...recommendedStudyIds],
    body:
      `Hi — based on your care profile you may be eligible to CONSIDER ${recommendedStudyIds.length} synthetic research ` +
      `stud${recommendedStudyIds.length === 1 ? "y" : "ies"}. This is an invitation to learn more, not an enrollment: ` +
      "a study coordinator will review informed consent with you, and nothing is enrolled without your explicit consent + a human."
  };
}

/**
 * Match a single patient against the synthetic study catalog. DETERMINISTIC:
 * evaluates every study's DEFINED criteria against the structured context, ranks
 * the matches (eligible first, then score, then studyId), and drafts a
 * consent-gated outreach that never auto-enrolls. A pure function of the context
 * + research-consent flag (no randomness, no clock), so the same inputs always
 * yield the same matches + ranking + outreach state.
 */
export function matchTrials(
  ctx: PatientTrialContext,
  opts: { researchConsent?: boolean; catalog?: Study[] } = {}
): TrialMatchResult {
  const catalog = opts.catalog ?? STUDY_CATALOG;
  const matches = rankMatches(catalog.map((study) => matchStudy(study, ctx)));
  const eligible = matches.filter((m) => m.eligible);
  const recommendedStudyIds = eligible.map((m) => m.studyId);
  const outreach = draftTrialOutreach(recommendedStudyIds, opts.researchConsent);

  const note =
    `Matched ${ctx.patientRef} against ${catalog.length} synthetic stud${
      catalog.length === 1 ? "y" : "ies"
    }: ${eligible.length} eligible. ` +
    (outreach.state === "drafted"
      ? `Consent-gated outreach drafted for ${recommendedStudyIds.length} stud${
          recommendedStudyIds.length === 1 ? "y" : "ies"
        }.`
      : outreach.state === "consent-required"
        ? "Outreach withheld — research consent not present."
        : "No outreach — no eligible studies.") +
    " Every eligibility determination traces to a defined criterion; outreach is research-consent-gated and the agent never auto-enrolls (informed consent + a human required). Synthetic/illustrative catalog + sponsors + criteria — not a certified trial-eligibility engine.";

  return {
    patientRef: ctx.patientRef,
    matches,
    eligibleCount: eligible.length,
    recommendedStudyIds,
    outreach,
    synthetic: true,
    note
  };
}

/**
 * Integrity check: does EVERY eligibility determination trace to a defined
 * criterion? True when every matched/failed criterion in every study match
 * references a catalog criterion id; the guard that catches a caller-asserted,
 * fabricated / ad-hoc (off-catalog) eligibility determination. This is the
 * honest signal the route reports to policy.trials.eligibility-criteria-sourced.
 * A non-array input is a violation.
 */
export function eligibilityTracesToCriteria(
  matches:
    | Array<{
        matchedCriteria?: Array<Pick<CriterionEvaluation, "criterionId">>;
        failedCriteria?: Array<Pick<CriterionEvaluation, "criterionId">>;
      }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(matches)) return false;
  return matches.every((m) =>
    [...(m.matchedCriteria ?? []), ...(m.failedCriteria ?? [])].every((c) =>
      isTrialCriterion(c.criterionId)
    )
  );
}

/**
 * Consent check: does the outreach honor the research-consent gate? True when an
 * ACTIVE (drafted) outreach has research consent present; true for a
 * consent-required / no-eligible-studies state (which drafts no active
 * outreach). The guard that catches a caller-asserted active outreach WITHOUT
 * research consent. This is the honest signal the route reports to
 * policy.trials.research-consent-required. Anything draftTrialOutreach()
 * produces satisfies it. A non-object input is a violation.
 */
export function outreachHasResearchConsent(
  outreach:
    | { state?: string; researchConsentPresent?: boolean }
    | null
    | undefined
): boolean {
  if (!outreach || typeof outreach !== "object") return false;
  if (outreach.state === "drafted") return outreach.researchConsentPresent === true;
  return true;
}

/**
 * No-autonomous-enrollment check: does the outreach require a human and never
 * enroll? True when enrolled is not true AND requiresHuman is not false; the
 * guard that catches a caller-asserted autonomous enrollment (an "enrolled"
 * outreach, or one that doesn't require a human). This is the honest signal the
 * route reports to policy.trials.no-autonomous-enrollment. Anything
 * draftTrialOutreach() produces satisfies it. A non-object input is a violation.
 */
export function enrollmentRequiresHuman(
  outreach: { enrolled?: boolean; requiresHuman?: boolean } | null | undefined
): boolean {
  if (!outreach || typeof outreach !== "object") return false;
  return outreach.enrolled !== true && outreach.requiresHuman !== false;
}

/**
 * A representative, deterministic demo patient context (illustrative). Matches
 * three of the four synthetic studies (vasomotor non-hormonal, sleep, and
 * hormone-initiation) and fails the bone-health registry (no osteoporosis
 * risk on record) — so both eligible matches with per-criterion explanations and
 * a failed study are demonstrable. Synthetic / de-identified patient ref.
 */
export const DEMO_TRIAL_PATIENT: PatientTrialContext = {
  patientRef: "trial-patient-001",
  ageBand: "51-55",
  postmenopausal: true,
  symptoms: ["hot_flashes", "insomnia"],
  comorbidities: [],
  region: "US-CA",
  priorTherapies: [],
  onHrt: false
};
