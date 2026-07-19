/**
 * Language Access & Health Equity — deterministic language-access planning for
 * limited-English-proficiency (LEP) patients, with a qualified-interpreter-only
 * posture, an approved translated-materials catalog, and honest equity-gap
 * flagging.
 *
 * Deterministic, dependency-free domain core the Language Access & Health Equity
 * Agent (app/api/agents/language-access) wraps — a patient-care EQUITY agent on
 * Pause's Agent Fabric. It ensures LEP patients can actually understand their
 * care: it DETERMINISTICALLY determines the patient's PREFERRED LANGUAGE
 * (deferring — in copy — to the Consent & Preferences Management agent's
 * preferred-language preference), decides whether a QUALIFIED MEDICAL
 * INTERPRETER is required and of which MODALITY (in-person / video / phone),
 * checks whether the needed PATIENT MATERIALS are available in that language
 * (from an approved translated-materials catalog, each with a translation-
 * provenance label), and FLAGS EQUITY / ACCESS GAPS (e.g. no qualified
 * interpreter available for a language, a consent form only in English). It
 * NEVER substitutes machine translation or an untrained / family interpreter for
 * clinical communication or consent.
 *
 *   Inbound:  a PatientLanguageContext (a synthetic patientRef — clearly labeled
 *             illustrative — plus the patient's preferred-language code, which
 *             encounter materials are needed, and whether a clinical consent step
 *             is involved)
 *   Outbound: a LanguageAccessAssessment { preferredLanguage, interpreterNeeded,
 *             recommendedModality, qualifiedInterpreterAvailable,
 *             materialsInLanguage[], equityGaps[], synthetic:true, note } and a
 *             consent-safe InterpreterRequest from arrangeInterpreter()
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: qualified medical interpreter only.
 * ─────────────────────────────────────────────────────────────────────
 *  Clinical interpretation must use a QUALIFIED MEDICAL INTERPRETER — never an
 *  untrained / ad-hoc / family interpreter (or a minor) for clinical
 *  communication or consent. arrangeInterpreter() always returns qualified:true;
 *  when no qualified interpreter is available for a language it returns an
 *  EQUITY-GAP ESCALATION to a human coordinator, NOT a fallback to an unqualified
 *  option. usesQualifiedInterpreter() reports the honest signal the Agent Fabric
 *  enforces via policy.langaccess.qualified-interpreter-only.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: translated materials trace to an approved source.
 * ─────────────────────────────────────────────────────────────────────
 *  Every in-language material presented must come from the APPROVED translated-
 *  materials catalog (APPROVED_MATERIALS) — no unverified / ad-hoc translation is
 *  presented as an official document. materialsTraceToApprovedSource() reports
 *  the honest signal the Agent Fabric enforces via
 *  policy.langaccess.translated-material-source-integrity.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no machine translation for clinical consent.
 * ─────────────────────────────────────────────────────────────────────
 *  Machine / auto translation must NEVER be used for clinical consent or clinical
 *  decision communication — those go through a qualified human interpreter or an
 *  approved translated document. noMachineTranslationForConsent() reports the
 *  honest signal the Agent Fabric enforces via
 *  policy.langaccess.no-machine-translation-for-consent.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  EQUITY GAP vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  An EQUITY GAP (no qualified interpreter for a language, a consent form only in
 *  English) is a SAFE, honest OUTPUT — the agent surfaces it and escalates to a
 *  human language-access coordinator; the task COMPLETES (it is not a block). A
 *  GOVERNANCE BLOCK is when a plan would VIOLATE a policy — using a family /
 *  ad-hoc interpreter for clinical communication, presenting an unapproved
 *  translation as official, or machine-translating clinical consent — which the
 *  Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified language-access system.
 * ─────────────────────────────────────────────────────────────────────
 *  The supported-language list, interpreter availability, translated-materials
 *  catalog, and translation-provenance labels below are ILLUSTRATIVE synthetic /
 *  demo values chosen to model the SHAPE of language-access planning — they are
 *  NOT a real interpreter roster, a real translated-document library, or a
 *  certified language-access engine (real programs are jurisdiction-specific and
 *  continuously maintained). The patientRef is synthetic / de-identified. There
 *  is NO randomness and NO clock anywhere here: the assessment is a pure function
 *  of the patient context the caller passes, so the same context always yields
 *  the same assessment — which is what lets the demo, the seeded trace, and the
 *  tests agree.
 */

/** A medical-interpreter delivery modality. */
export type InterpreterModality = "in-person" | "video" | "phone";

/** The interpreter modalities in a stable, documented display order. */
export const INTERPRETER_MODALITIES: InterpreterModality[] = [
  "in-person",
  "video",
  "phone"
];

const MODALITY_SET = new Set<string>(INTERPRETER_MODALITIES);

/** Is `m` a defined interpreter modality? */
export function isInterpreterModality(m: unknown): m is InterpreterModality {
  return typeof m === "string" && MODALITY_SET.has(m);
}

/** The clinical default language — English needs no interpreter in this demo. */
export const CLINICAL_DEFAULT_LANGUAGE_CODE = "en";

/**
 * A supported language in the (illustrative) language-access program. Whether a
 * QUALIFIED MEDICAL INTERPRETER pool exists for the language — and, if so, the
 * preferred delivery modality — is a clearly-labeled synthetic. A language may be
 * "supported" (recognized, materials may exist) yet still have NO qualified
 * interpreter pool, which is exactly the equity gap the agent must surface.
 */
export type SupportedLanguage = {
  /** Stable, illustrative language code (BCP-47-ish). */
  code: string;
  /** Human-readable language label. */
  label: string;
  /**
   * Whether a QUALIFIED MEDICAL INTERPRETER pool is available for this language
   * (synthetic). English is trivially true (clinical default). A false value on a
   * non-English language is an equity gap.
   */
  qualifiedInterpreterAvailable: boolean;
  /**
   * The preferred interpreter modality when a qualified interpreter IS available
   * (synthetic). Moot when qualifiedInterpreterAvailable is false.
   */
  preferredModality: InterpreterModality;
};

/**
 * The supported-language catalog. Illustrative/synthetic; NOT a real interpreter
 * roster (see the module header). English is the clinical default (no interpreter
 * needed). Fulfulde/Pular is deliberately supported-but-unstaffed so the "no
 * qualified interpreter available" equity gap is demonstrable.
 */
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  {
    code: "en",
    label: "English",
    qualifiedInterpreterAvailable: true,
    preferredModality: "in-person"
  },
  {
    code: "es",
    label: "Spanish",
    qualifiedInterpreterAvailable: true,
    preferredModality: "video"
  },
  {
    code: "zh",
    label: "Chinese (Simplified)",
    qualifiedInterpreterAvailable: true,
    preferredModality: "video"
  },
  {
    code: "vi",
    label: "Vietnamese",
    qualifiedInterpreterAvailable: true,
    preferredModality: "phone"
  },
  {
    code: "ht",
    label: "Haitian Creole",
    qualifiedInterpreterAvailable: true,
    preferredModality: "phone"
  },
  {
    code: "ff",
    label: "Fulfulde (Pular)",
    // Supported / recognized, but NO qualified medical-interpreter pool in this
    // synthetic program — the load-bearing equity gap.
    qualifiedInterpreterAvailable: false,
    preferredModality: "in-person"
  }
];

const LANGUAGE_BY_CODE = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l]));

/** Is `code` a defined supported-language code? */
export function isSupportedLanguage(code: unknown): boolean {
  return typeof code === "string" && LANGUAGE_BY_CODE.has(code);
}

/** Look up a supported language by code (undefined for an off-catalog code). */
export function getLanguage(code: string): SupportedLanguage | undefined {
  return LANGUAGE_BY_CODE.get(code);
}

/**
 * A patient-material document in the (illustrative) approved translated-materials
 * catalog. `translations` lists the languages this document is APPROVED in, each
 * with a translation-provenance / approved-source label — this is the ONLY source
 * of legitimate in-language materials, so a presented in-language material can
 * never claim a translation the catalog doesn't hold. Illustrative — NOT a real
 * translated-document library.
 */
export type ApprovedMaterial = {
  /** Stable catalog id every material availability references. */
  id: string;
  /** Human-readable material label. */
  label: string;
  /** Whether this document carries a clinical consent / clinical-decision step. */
  isConsentDocument: boolean;
  /** Approved translations: languageCode → translation-provenance/source label. */
  translations: Array<{ languageCode: string; source: string }>;
  /** Always true — the catalog + provenance labels are illustrative synthetics. */
  synthetic: true;
};

/** A clearly-synthetic "original English source of record" provenance label. */
const SOURCE_ORIGINAL = "Original — English source of record (illustrative)";
/** A clearly-synthetic "professional human translation" provenance label. */
const SOURCE_HUMAN =
  "Professional human translation · vendor-certified (illustrative)";

/**
 * The approved translated-materials catalog. This is the ONLY source of
 * legitimate in-language materials assessLanguageAccess() reports available.
 * Illustrative/synthetic values + provenance labels; NOT a certified translated-
 * document library (see the module header). Deliberately UNEVEN coverage (the
 * consent form is only in English/Spanish/Chinese) so a "consent form only in
 * English" equity gap is demonstrable for Vietnamese / Haitian Creole / rare
 * languages.
 */
export const APPROVED_MATERIALS: ApprovedMaterial[] = [
  {
    id: "material.clinical-consent-form",
    label: "Clinical consent form",
    isConsentDocument: true,
    translations: [
      { languageCode: "en", source: SOURCE_ORIGINAL },
      { languageCode: "es", source: SOURCE_HUMAN },
      { languageCode: "zh", source: SOURCE_HUMAN }
    ],
    synthetic: true
  },
  {
    id: "material.after-visit-summary",
    label: "After-visit summary",
    isConsentDocument: false,
    translations: [
      { languageCode: "en", source: SOURCE_ORIGINAL },
      { languageCode: "es", source: SOURCE_HUMAN },
      { languageCode: "zh", source: SOURCE_HUMAN },
      { languageCode: "vi", source: SOURCE_HUMAN }
    ],
    synthetic: true
  },
  {
    id: "material.medication-instructions",
    label: "Medication instructions",
    isConsentDocument: false,
    translations: [
      { languageCode: "en", source: SOURCE_ORIGINAL },
      { languageCode: "es", source: SOURCE_HUMAN },
      { languageCode: "zh", source: SOURCE_HUMAN },
      { languageCode: "vi", source: SOURCE_HUMAN },
      { languageCode: "ht", source: SOURCE_HUMAN }
    ],
    synthetic: true
  },
  {
    id: "material.rights-and-privacy-notice",
    label: "Patient rights & privacy notice",
    isConsentDocument: false,
    translations: [
      { languageCode: "en", source: SOURCE_ORIGINAL },
      { languageCode: "es", source: SOURCE_HUMAN },
      { languageCode: "zh", source: SOURCE_HUMAN },
      { languageCode: "vi", source: SOURCE_HUMAN },
      { languageCode: "ht", source: SOURCE_HUMAN }
    ],
    synthetic: true
  }
];

const MATERIAL_BY_ID = new Map(APPROVED_MATERIALS.map((m) => [m.id, m]));

/** Is `id` a defined approved-material catalog id? */
export function isApprovedMaterial(id: unknown): boolean {
  return typeof id === "string" && MATERIAL_BY_ID.has(id);
}

/** Look up an approved material by id (undefined for an off-catalog id). */
export function getMaterial(id: string): ApprovedMaterial | undefined {
  return MATERIAL_BY_ID.get(id);
}

/**
 * Is a given material APPROVED (present in the catalog) as an in-language
 * translation for `languageCode`? The guard the source-integrity signal builds
 * on: a material claiming an in-language version the catalog doesn't hold is an
 * unverified / ad-hoc translation, not an approved one.
 */
export function isApprovedTranslation(
  materialId: unknown,
  languageCode: unknown
): boolean {
  if (typeof materialId !== "string" || typeof languageCode !== "string") {
    return false;
  }
  const material = MATERIAL_BY_ID.get(materialId);
  if (!material) return false;
  return material.translations.some((t) => t.languageCode === languageCode);
}

/** The approved translation-provenance/source label, or undefined if none. */
function approvedSourceFor(
  materialId: string,
  languageCode: string
): string | undefined {
  return MATERIAL_BY_ID.get(materialId)?.translations.find(
    (t) => t.languageCode === languageCode
  )?.source;
}

/**
 * The structured patient signals the language-access planner reads. `patientRef`
 * is a synthetic, de-identified id — clearly labeled illustrative. Deferring to
 * the Consent & Preferences Management agent's preferred-language preference,
 * `preferredLanguageCode` is the authoritative preferred language (English when
 * unset). Deterministic — a pure function of the context (no clock).
 */
export type PatientLanguageContext = {
  /** Synthetic, de-identified patient reference (e.g. "langaccess-patient-001"). */
  patientRef: string;
  /**
   * The patient's preferred language code (the Consent & Preferences Management
   * agent's preferred-language preference). Defaults to English when unset.
   */
  preferredLanguageCode?: string;
  /**
   * The catalog material ids needed for this encounter. Defaults to the whole
   * APPROVED_MATERIALS catalog when unset. Off-catalog ids are ignored.
   */
  neededMaterialIds?: string[];
  /**
   * Whether this encounter involves a clinical consent step (raises the severity
   * of a missing in-language consent document). Defaults to true.
   */
  requiresConsentStep?: boolean;
};

/** The availability of one needed material in the patient's preferred language. */
export type MaterialAvailability = {
  /** The approved-material catalog id (never invented). */
  materialId: string;
  /** Copied from the catalog for display convenience. */
  materialLabel: string;
  /** The language the availability is about. */
  languageCode: string;
  /** True iff an APPROVED translation exists in the catalog for this language. */
  available: boolean;
  /** Whether the document carries a clinical consent / decision step. */
  isConsentDocument: boolean;
  /** The approved translation-provenance/source label (present only when available). */
  source?: string;
};

export type EquityGapKind =
  | "no-qualified-interpreter"
  | "unsupported-language"
  | "consent-material-not-in-language"
  | "material-not-in-language";

export type EquityGapSeverity = "routine" | "elevated" | "urgent";

/** A flagged equity / language-access gap (a safe, honest output — not a block). */
export type EquityGap = {
  /** Which kind of access gap this is. */
  kind: EquityGapKind;
  /** Human-readable gap label. */
  label: string;
  /** Deterministic severity (a consent gap or a missing interpreter ranks higher). */
  severity: EquityGapSeverity;
  /** Human-readable detail. */
  detail: string;
};

/** The deterministic language-access assessment the agent returns. */
export type LanguageAccessAssessment = {
  /** The synthetic patient reference this assessment is about. */
  patientRef: string;
  /** The resolved preferred language (deferring to the consent preference). */
  preferredLanguage: { code: string; label: string; supported: boolean };
  /** True when the preferred language is not the clinical default (English). */
  interpreterNeeded: boolean;
  /** The recommended interpreter modality, or null when none is needed/available. */
  recommendedModality: InterpreterModality | null;
  /** Whether a QUALIFIED medical interpreter is available for the language. */
  qualifiedInterpreterAvailable: boolean;
  /** Per-material availability in the preferred language (catalog-sourced). */
  materialsInLanguage: MaterialAvailability[];
  /** Flagged equity / access gaps (ranked; a safe output, escalated to a human). */
  equityGaps: EquityGap[];
  /** Always true — languages, availability, and materials are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

const SEVERITY_ORDER: Record<EquityGapSeverity, number> = {
  urgent: 0,
  elevated: 1,
  routine: 2
};

/** Resolve the needed materials (catalog-only, in catalog order) for a context. */
function neededMaterials(ctx: PatientLanguageContext): ApprovedMaterial[] {
  const ids = ctx.neededMaterialIds;
  if (!Array.isArray(ids)) return APPROVED_MATERIALS.slice();
  const wanted = new Set(ids);
  // Preserve the catalog order; drop off-catalog ids (never fabricated).
  return APPROVED_MATERIALS.filter((m) => wanted.has(m.id));
}

/**
 * Assess a single patient's language-access needs. DETERMINISTIC: resolves the
 * preferred language (English when unset), decides whether a qualified medical
 * interpreter is needed and of which modality, checks the approved translated-
 * materials catalog for in-language availability, and flags equity / access gaps
 * — a pure function of the context (no randomness, no clock), so the same context
 * always yields the same assessment. It NEVER proposes machine translation or an
 * unqualified interpreter; a missing qualified interpreter or in-language document
 * is surfaced as an equity gap for a human coordinator, not silently substituted.
 */
export function assessLanguageAccess(
  ctx: PatientLanguageContext
): LanguageAccessAssessment {
  const code = ctx.preferredLanguageCode ?? CLINICAL_DEFAULT_LANGUAGE_CODE;
  const lang = getLanguage(code);
  const supported = lang !== undefined;
  const label = lang?.label ?? code;
  const requiresConsentStep = ctx.requiresConsentStep !== false;

  const interpreterNeeded = code !== CLINICAL_DEFAULT_LANGUAGE_CODE;
  // A qualified interpreter is "available" trivially when none is needed
  // (English), otherwise it depends on the language's synthetic staffing.
  const qualifiedInterpreterAvailable = interpreterNeeded
    ? Boolean(lang?.qualifiedInterpreterAvailable)
    : true;
  const recommendedModality =
    interpreterNeeded && qualifiedInterpreterAvailable && lang
      ? lang.preferredModality
      : null;

  // Per-material availability against the APPROVED catalog (English is always
  // available as the original source of record).
  const materialsInLanguage: MaterialAvailability[] = neededMaterials(ctx).map(
    (m) => {
      const available = isApprovedTranslation(m.id, code);
      return {
        materialId: m.id,
        materialLabel: m.label,
        languageCode: code,
        available,
        isConsentDocument: m.isConsentDocument,
        ...(available ? { source: approvedSourceFor(m.id, code) } : {})
      };
    }
  );

  const equityGaps: EquityGap[] = [];

  if (interpreterNeeded && !supported) {
    equityGaps.push({
      kind: "unsupported-language",
      label: "Preferred language not in the supported-language program",
      severity: "urgent",
      detail: `preferred language "${code}" is not a recognized supported language — escalate to a human language-access coordinator`
    });
  }

  if (interpreterNeeded && !qualifiedInterpreterAvailable) {
    equityGaps.push({
      kind: "no-qualified-interpreter",
      label: "No qualified medical interpreter available for this language",
      severity: "urgent",
      detail: `no qualified medical interpreter pool for ${label} — escalate to a human language-access coordinator (never substitute a family / ad-hoc / machine interpreter for clinical use)`
    });
  }

  for (const m of materialsInLanguage) {
    if (m.available) continue;
    if (m.isConsentDocument) {
      equityGaps.push({
        kind: "consent-material-not-in-language",
        label: `${m.materialLabel} not available in ${label}`,
        severity: requiresConsentStep ? "urgent" : "elevated",
        detail: `${m.materialLabel.toLowerCase()} is only available in English — a clinical consent document must be delivered via a qualified interpreter and, where possible, an approved translation (never machine translation)`
      });
    } else {
      equityGaps.push({
        kind: "material-not-in-language",
        label: `${m.materialLabel} not available in ${label}`,
        severity: "elevated",
        detail: `${m.materialLabel.toLowerCase()} has no approved ${label} translation on file — flag for the approved-materials translation queue`
      });
    }
  }

  // Deterministic ranking: by severity (urgent → elevated → routine); a stable,
  // documented tie-break on the gap kind (lexical) so the same context always
  // yields the same ordering.
  equityGaps.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.kind.localeCompare(b.kind)
  );

  const availableCount = materialsInLanguage.filter((m) => m.available).length;
  const note = interpreterNeeded
    ? `Preferred language ${label} (${code}); a qualified medical interpreter is ${
        qualifiedInterpreterAvailable
          ? `available (${recommendedModality})`
          : "NOT available — escalated to a human coordinator"
      }; ${availableCount}/${materialsInLanguage.length} needed materials have an approved ${label} translation. ${
        equityGaps.length
      } equity gap${equityGaps.length === 1 ? "" : "s"} flagged. ` +
      "Clinical interpretation uses a qualified medical interpreter only (never family / ad-hoc / machine); in-language materials trace to the approved translated-materials catalog; machine translation is never used for clinical consent. Synthetic/illustrative languages, interpreter availability, materials, and provenance — not a certified language-access system."
    : `Preferred language is English (${code}), the clinical default — no medical interpreter required; ${availableCount}/${materialsInLanguage.length} needed materials available. ` +
      "Synthetic/illustrative catalog — not a certified language-access system.";

  return {
    patientRef: ctx.patientRef,
    preferredLanguage: { code, label, supported },
    interpreterNeeded,
    recommendedModality,
    qualifiedInterpreterAvailable,
    materialsInLanguage,
    equityGaps,
    synthetic: true,
    note
  };
}

/** The state of an interpreter arrangement. NEVER an unqualified fallback. */
export type InterpreterRequestState =
  | "arranged"
  | "not-needed"
  | "equity-gap-escalation";

/**
 * A qualified-interpreter arrangement. It is ALWAYS qualified:true /
 * requiresQualifiedInterpreter:true — the agent never proposes a family /
 * ad-hoc / machine interpreter for clinical use. When no qualified interpreter is
 * available for the language it is an EQUITY-GAP ESCALATION (escalated:true,
 * routed to a human coordinator), NOT a fallback to an unqualified option.
 */
export type InterpreterRequest = {
  /** arranged (qualified available) / not-needed (English) / equity-gap-escalation. */
  state: InterpreterRequestState;
  /** The language the request is about. */
  languageCode: string;
  /** Copied for display convenience. */
  languageLabel: string;
  /** The arranged modality, or null when none is needed/available. */
  modality: InterpreterModality | null;
  /** Always true — clinical interpretation only ever uses a qualified interpreter. */
  qualified: true;
  /** Always true — never an ad-hoc / family / machine interpreter for clinical use. */
  requiresQualifiedInterpreter: true;
  /** True when no qualified interpreter is available and this is an equity escalation. */
  escalated: boolean;
  /** The human this is routed to when escalated (null otherwise). */
  routedTo: "language-access-coordinator" | null;
  /** Human-readable request/escalation body. */
  body: string;
};

/**
 * Arrange a qualified medical interpreter for an assessment. Deterministic on its
 * input. NEVER proposes an unqualified interpreter: qualified is always true. When
 * no interpreter is needed (English) the state is "not-needed"; when a qualified
 * interpreter is available it is "arranged" with the recommended modality; when a
 * qualified interpreter is NOT available it is an "equity-gap-escalation" routed
 * to a human language-access coordinator — never a fallback to a family / ad-hoc /
 * machine interpreter.
 */
export function arrangeInterpreter(
  assessment: Pick<
    LanguageAccessAssessment,
    | "preferredLanguage"
    | "interpreterNeeded"
    | "qualifiedInterpreterAvailable"
    | "recommendedModality"
  >
): InterpreterRequest {
  const languageCode = assessment.preferredLanguage.code;
  const languageLabel = assessment.preferredLanguage.label;

  const base = {
    languageCode,
    languageLabel,
    qualified: true,
    requiresQualifiedInterpreter: true
  } as const;

  if (!assessment.interpreterNeeded) {
    return {
      ...base,
      state: "not-needed",
      modality: null,
      escalated: false,
      routedTo: null,
      body: `Preferred language is English (clinical default) — no medical interpreter required.`
    };
  }

  if (!assessment.qualifiedInterpreterAvailable) {
    return {
      ...base,
      state: "equity-gap-escalation",
      modality: null,
      escalated: true,
      routedTo: "language-access-coordinator",
      body:
        `No qualified medical interpreter is available for ${languageLabel} — escalating to a human language-access coordinator. ` +
        "The agent will NOT substitute a family member, an ad-hoc bilingual staffer, or machine translation for clinical communication or consent."
    };
  }

  return {
    ...base,
    state: "arranged",
    modality: assessment.recommendedModality,
    escalated: false,
    routedTo: null,
    body:
      `Arranging a QUALIFIED medical interpreter for ${languageLabel} (${
        assessment.recommendedModality
      }). ` +
      "Clinical communication and consent go through the qualified interpreter — never a family / ad-hoc / machine interpreter."
  };
}

/** The interpreter types that are NOT acceptable for clinical communication. */
const DISALLOWED_CLINICAL_INTERPRETER_TYPES = new Set<string>([
  "family",
  "family-member",
  "friend",
  "minor",
  "ad-hoc",
  "untrained",
  "bilingual-staff-untrained",
  "machine",
  "machine-translation"
]);

/**
 * Qualified-interpreter check: does the interpreter plan use a QUALIFIED medical
 * interpreter for clinical communication (never an untrained / ad-hoc / family
 * interpreter)? True for anything arrangeInterpreter() produces (qualified:true).
 * The guard that catches a caller-asserted plan that would use an unqualified
 * interpreter for clinical use — qualified:false, or an interpreterType on the
 * disallowed list. This is the honest signal the route reports to
 * policy.langaccess.qualified-interpreter-only. A non-object input is a violation.
 */
export function usesQualifiedInterpreter(
  plan:
    | { qualified?: boolean; interpreterType?: string; state?: string }
    | null
    | undefined
): boolean {
  if (!plan || typeof plan !== "object") return false;
  if (plan.qualified === false) return false;
  if (
    typeof plan.interpreterType === "string" &&
    DISALLOWED_CLINICAL_INTERPRETER_TYPES.has(plan.interpreterType)
  ) {
    return false;
  }
  return true;
}

/**
 * Source-integrity check: does EVERY in-language material presented trace to the
 * APPROVED translated-materials catalog? True for anything assessLanguageAccess()
 * produces — an unavailable material makes no claim, and every available material
 * references an approved catalog translation. The guard that catches a caller-
 * asserted material presented as an official in-language document without an
 * approved translation (an unverified / ad-hoc translation). This is the honest
 * signal the route reports to policy.langaccess.translated-material-source-integrity.
 * A non-array input is a violation.
 */
export function materialsTraceToApprovedSource(
  materials:
    | Array<{ materialId?: string; languageCode?: string; available?: boolean }>
    | null
    | undefined
): boolean {
  if (!Array.isArray(materials)) return false;
  return materials.every((m) => {
    if (m.available !== true) return true;
    return isApprovedTranslation(m.materialId, m.languageCode);
  });
}

/**
 * No-machine-translation-for-consent check: does the communication plan avoid
 * machine / auto translation for clinical consent or clinical decision
 * communication? True unless the plan uses a machine/auto translation method FOR
 * a clinical consent / decision. The guard that catches a caller-asserted plan
 * that would machine-translate clinical consent. This is the honest signal the
 * route reports to policy.langaccess.no-machine-translation-for-consent. A
 * non-object input is a violation.
 */
export function noMachineTranslationForConsent(
  plan:
    | {
        translationMethod?: string;
        forClinicalConsent?: boolean;
        forClinicalDecision?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!plan || typeof plan !== "object") return false;
  const method = plan.translationMethod;
  const isMachine = method === "machine-translation" || method === "auto-translate";
  const forClinical =
    plan.forClinicalConsent === true || plan.forClinicalDecision === true;
  return !(isMachine && forClinical);
}

/**
 * The default, consent-SAFE communication plan the agent produces for an
 * assessment: clinical consent / decision content goes through a qualified human
 * interpreter (when one is needed) or an approved translated document — NEVER
 * machine translation. noMachineTranslationForConsent() over this plan is always
 * true. The route uses it unless the caller asserts a plan (to demo the block).
 */
export function defaultConsentCommunicationPlan(
  assessment: Pick<LanguageAccessAssessment, "interpreterNeeded">
): {
  translationMethod: "qualified-human-interpreter" | "approved-translated-material";
  forClinicalConsent: true;
} {
  return {
    translationMethod: assessment.interpreterNeeded
      ? "qualified-human-interpreter"
      : "approved-translated-material",
    forClinicalConsent: true
  };
}

/**
 * A representative, deterministic demo patient (illustrative). A Spanish-
 * preferring patient with a clinical consent step: a qualified video interpreter
 * is available and every needed material has an approved Spanish translation — so
 * the happy path (interpreter arranged + full in-language materials, no equity
 * gaps) is demonstrable. Synthetic / de-identified patient ref.
 */
export const DEMO_LANGUAGE_PATIENT: PatientLanguageContext = {
  patientRef: "langaccess-patient-001",
  preferredLanguageCode: "es",
  requiresConsentStep: true
};

/**
 * A representative equity-gap demo patient (illustrative). A patient preferring a
 * rare language (Fulfulde/Pular) with no qualified-interpreter pool and no
 * approved translated materials — so the equity-gap path (no qualified
 * interpreter → escalation, consent form only in English) is demonstrable as a
 * SAFE completed answer (not a governance block). Synthetic / de-identified.
 */
export const DEMO_EQUITY_GAP_PATIENT: PatientLanguageContext = {
  patientRef: "langaccess-patient-002",
  preferredLanguageCode: "ff",
  requiresConsentStep: true
};
