/**
 * De-Identification & Safe Harbor — the deterministic, transparent data-substrate layer
 * that screens a dataset's fields against the eighteen HIPAA Safe Harbor identifier
 * categories (45 CFR 164.514(b)(2)), decides whether the dataset qualifies as
 * de-identified, and ensures a dataset that still contains a remaining identifier is NEVER
 * released as de-identified.
 *
 * Deterministic, dependency-free domain core the De-Identification & Safe Harbor Agent
 * (app/api/agents/deidentification) wraps — a control-plane / data-substrate service on the
 * platform plane of Pause's Agent Fabric. Given a dataset described by its FIELDS (each a
 * name, the Safe Harbor identifier category it maps to — or "non-identifier" — and the
 * ACTION taken on it: removed / generalized / retained), the chosen de-identification
 * METHOD (safe-harbor or expert-determination), the categories explicitly attested absent,
 * and (for expert determination) the cited determination reference, it DETERMINISTICALLY
 * decides whether the dataset is de-identified under HIPAA Safe Harbor, which identifier
 * categories remain, whether all eighteen categories were screened, and whether the dataset
 * may be released.
 *
 *   Inbound:  a DeidentificationRequest { datasetRef, method, fields[], attestedAbsentCategories?, expertDeterminationRef? }
 *   Outbound: a DeidentificationDetermination { deidentified, remainingIdentifierCategories,
 *             categoriesScreened, allCategoriesScreened, methodCited, releaseApproved,
 *             requiresHumanReview, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other platform & data-substrate agents: the
 * Consent & Preferences Management agent governs a patient's consent SCOPES for
 * outreach/data-sharing; the Master Patient Index resolves IDENTITY; the Break-the-Glass
 * agent governs emergency PHI ACCESS; the Data Retention agent governs records DISPOSITION;
 * the Data-Sharing / TEFCA agent governs interoperability EXCHANGE — this decides whether a
 * dataset is DE-IDENTIFIED (no longer PHI) under Safe Harbor before it may be used or
 * disclosed for a secondary purpose.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: all eighteen Safe Harbor categories are screened.
 * ─────────────────────────────────────────────────────────────────────
 *  A de-identification determination must screen ALL EIGHTEEN Safe Harbor identifier
 *  categories — every category must be accounted for (either present as a field, or
 *  explicitly attested absent). A screen that skips a category is INCOMPLETE and cannot
 *  claim de-identification, because an un-screened category may hide a re-identifying
 *  identifier. deidAllCategoriesScreened() reports the honest signal the Agent Fabric
 *  enforces via policy.deid.all-categories-screened. (This is the load-bearing completeness
 *  gate — mirrors the Good Faith Estimate Agent's expected-items-complete and the Lab
 *  Result Agent's critical-value-notified: a completeness obligation that cannot be
 *  skipped.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: a recognized de-identification method is cited.
 * ─────────────────────────────────────────────────────────────────────
 *  De-identification must cite a recognized method — either Safe Harbor (§164.514(b)(2)) or
 *  Expert Determination (§164.514(b)(1), which additionally requires a cited determination
 *  reference) — there is no ad-hoc "we just removed some columns" de-identification.
 *  deidMethodCited() reports the honest signal the Agent Fabric enforces via
 *  policy.deid.method-cited. (Mirrors the Data Retention Agent's schedule-sourced and the
 *  Balance Billing Agent's protection-basis-sourced posture — every decision traces to a
 *  defined method.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: a re-identifiable dataset is never released as de-identified.
 * ─────────────────────────────────────────────────────────────────────
 *  A dataset that still contains a remaining identifier (a retained identifier, or a
 *  generalization that does not satisfy Safe Harbor) is NOT de-identified and may NEVER be
 *  marked de-identified or released as de-identified — releasing re-identifiable data
 *  requires human review under a data use agreement. deidNoReleaseOfReidentifiable() reports
 *  the honest signal the Agent Fabric enforces via policy.deid.no-release-of-reidentifiable.
 *  (Mirrors the Balance Billing Agent's no-autonomous-balance-bill and the Master Patient
 *  Index Agent's no-autonomous-merge posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — de-identified or NOT — is a SAFE, honest OUTPUT: the task COMPLETES (a
 *  not-de-identified dataset carries requiresHumanReview:true and releaseApproved:false). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (an incomplete
 *  screen, an un-cited method, or a re-identifiable dataset marked released) — which the
 *  Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified de-identification engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The category catalog, the generalization rules (only geographic → first three ZIP digits
 *  per the population rule, and dates → year only, satisfy Safe Harbor here), and the
 *  handling below are ILLUSTRATIVE synthetic/demo rules chosen to model the SHAPE of a
 *  governed de-identification control — they are NOT a certified de-identification engine,
 *  and a REAL determination applies the full Safe Harbor method (45 CFR 164.514(b)(2),
 *  including the actual-knowledge clause) or a qualified statistician's Expert Determination
 *  (§164.514(b)(1)). The dataset / field descriptors are synthetic. There is NO randomness
 *  and NO clock anywhere here: the determination is a pure function of the request + the
 *  category catalog (no Date.now()), so the same dataset always yields the same
 *  de-identification decision + remaining categories + release flag — which is what lets the
 *  demo, the seeded trace, and the tests agree.
 */

/** A HIPAA Safe Harbor identifier category. */
export type SafeHarborCategory = {
  /** Stable catalog code (cited on every field). */
  code: string;
  /** Human-readable label. */
  label: string;
  /** Whether generalization (not just removal) can satisfy Safe Harbor for this category. */
  generalizable: boolean;
  /** Illustrative note. Demo-honest. */
  note: string;
};

/**
 * The eighteen HIPAA Safe Harbor identifier categories (45 CFR 164.514(b)(2)(i)(A)–(R)).
 * Only geographic and dates are `generalizable` (geographic → first three ZIP digits per the
 * population rule; dates → year only); every other category must be removed to satisfy Safe
 * Harbor. Illustrative/synthetic labels (see the header).
 */
export const SAFE_HARBOR_CATEGORIES: SafeHarborCategory[] = [
  { code: "names", label: "Names", generalizable: false, note: "A: names of the individual, relatives, employers, or household members." },
  { code: "geographic", label: "Geographic subdivisions smaller than a state", generalizable: true, note: "B: street, city, county, precinct, ZIP — generalizable to the first three ZIP digits per the population rule." },
  { code: "dates", label: "Dates (except year) related to an individual", generalizable: true, note: "C: birth/admission/discharge/death dates and ages over 89 — generalizable to year only." },
  { code: "phone", label: "Telephone numbers", generalizable: false, note: "D." },
  { code: "fax", label: "Fax numbers", generalizable: false, note: "E." },
  { code: "email", label: "Email addresses", generalizable: false, note: "F." },
  { code: "ssn", label: "Social security numbers", generalizable: false, note: "G." },
  { code: "mrn", label: "Medical record numbers", generalizable: false, note: "H." },
  { code: "health-plan-id", label: "Health plan beneficiary numbers", generalizable: false, note: "I." },
  { code: "account", label: "Account numbers", generalizable: false, note: "J." },
  { code: "certificate-license", label: "Certificate / license numbers", generalizable: false, note: "K." },
  { code: "vehicle", label: "Vehicle identifiers and serial numbers", generalizable: false, note: "L: including license plate numbers." },
  { code: "device", label: "Device identifiers and serial numbers", generalizable: false, note: "M." },
  { code: "url", label: "Web URLs", generalizable: false, note: "N." },
  { code: "ip", label: "IP addresses", generalizable: false, note: "O." },
  { code: "biometric", label: "Biometric identifiers", generalizable: false, note: "P: finger and voice prints." },
  { code: "photo", label: "Full-face photographs and comparable images", generalizable: false, note: "Q." },
  { code: "other-unique", label: "Any other unique identifying number, characteristic, or code", generalizable: false, note: "R." }
];

/** The special non-identifier marker for a field that is not one of the eighteen categories. */
export const NON_IDENTIFIER = "non-identifier";

const CATEGORY_BY_CODE = new Map(SAFE_HARBOR_CATEGORIES.map((c) => [c.code, c]));
const CATEGORY_CODES = new Set<string>(SAFE_HARBOR_CATEGORIES.map((c) => c.code));

/** The total number of Safe Harbor identifier categories that must be screened (18). */
export const SAFE_HARBOR_CATEGORY_COUNT = SAFE_HARBOR_CATEGORIES.length;

/** Is `code` a recognized Safe Harbor category code? */
export function isSafeHarborCategory(code: unknown): boolean {
  return typeof code === "string" && CATEGORY_CODES.has(code);
}

/** Look up a Safe Harbor category by code (undefined for an off-catalog code). */
export function getSafeHarborCategory(code: string): SafeHarborCategory | undefined {
  return CATEGORY_BY_CODE.get(code);
}

/** A de-identification method. */
export type DeidentificationMethod = "safe-harbor" | "expert-determination";

/** The action taken on a field. */
export type FieldAction = "removed" | "generalized" | "retained";

/** A described field in the dataset being screened. */
export type DatasetField = {
  /** The field / column name (synthetic). */
  name: string;
  /** The Safe Harbor category it maps to, or NON_IDENTIFIER. */
  category: string;
  /** The action taken on the field. */
  action: FieldAction;
};

/** A de-identification determination request. */
export type DeidentificationRequest = {
  /** Synthetic dataset reference. */
  datasetRef: string;
  /** The chosen de-identification method. */
  method: DeidentificationMethod;
  /** The described dataset fields. */
  fields: DatasetField[];
  /** Safe Harbor category codes explicitly attested to be absent from the dataset. */
  attestedAbsentCategories?: string[];
  /** For expert determination: the cited determination reference (required for that method). */
  expertDeterminationRef?: string;
};

/** The deterministic de-identification determination the agent returns. */
export type DeidentificationDetermination = {
  /** Synthetic dataset reference. */
  datasetRef: string;
  /** The chosen method. */
  method: string;
  /** The number of described fields. */
  fieldCount: number;
  /** The Safe Harbor categories present among the fields. */
  identifierCategoriesPresent: string[];
  /** The Safe Harbor categories that remain identifiable after the field actions. */
  remainingIdentifierCategories: string[];
  /** The Safe Harbor categories screened (present as a field or attested absent). */
  categoriesScreened: string[];
  /** Whether all eighteen categories were screened. */
  allCategoriesScreened: boolean;
  /** Whether a recognized method is cited (expert-determination requires a ref). */
  methodCited: boolean;
  /** Whether the dataset qualifies as de-identified. */
  deidentified: boolean;
  /** Whether the dataset may be released as de-identified (=== deidentified). */
  releaseApproved: boolean;
  /** Whether the determination requires human review (any not-de-identified dataset). */
  requiresHumanReview: boolean;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the catalog + rules are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Whether a described field still holds an identifier after its action. */
function fieldIsIdentifiable(field: DatasetField): boolean {
  if (field.category === NON_IDENTIFIER) return false;
  const category = getSafeHarborCategory(field.category);
  // An off-catalog category is conservatively treated as an identifier unless removed.
  if (field.action === "removed") return false;
  if (field.action === "generalized") {
    // Generalization only satisfies Safe Harbor for generalizable categories.
    return !(category?.generalizable === true);
  }
  // "retained" (or any other action) leaves the identifier in place.
  return true;
}

function distinct(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * The deterministic de-identification function — the heart of the service. DETERMINISTIC: a
 * pure function of the request + the category catalog (no randomness, no clock). It screens
 * every field, computes which Safe Harbor categories are present and which remain
 * identifiable after the field actions, computes which of the eighteen categories were
 * screened (present or attested absent), validates the method citation, and decides
 * de-identification: a dataset is de-identified iff a recognized method is cited, all
 * eighteen categories were screened, and no identifier category remains. A not-de-identified
 * dataset is a completed determination requiring human review (releaseApproved:false).
 * Nothing is released here — this produces a determination, not a disclosure.
 */
export function evaluateDeidentification(
  request: DeidentificationRequest
): DeidentificationDetermination {
  const fields = Array.isArray(request.fields) ? request.fields : [];
  const attestedAbsent = Array.isArray(request.attestedAbsentCategories)
    ? request.attestedAbsentCategories.filter((c) => isSafeHarborCategory(c))
    : [];

  const identifierCategoriesPresent = distinct(
    fields
      .map((f) => f.category)
      .filter((c) => c !== NON_IDENTIFIER && isSafeHarborCategory(c))
  );

  const remainingIdentifierCategories = distinct(
    fields
      .filter((f) => fieldIsIdentifiable(f) && isSafeHarborCategory(f.category))
      .map((f) => f.category)
  );

  const categoriesScreened = distinct([...identifierCategoriesPresent, ...attestedAbsent]);
  const allCategoriesScreened = SAFE_HARBOR_CATEGORIES.every((c) =>
    categoriesScreened.includes(c.code)
  );

  const methodCited =
    request.method === "safe-harbor" ||
    (request.method === "expert-determination" &&
      typeof request.expertDeterminationRef === "string" &&
      request.expertDeterminationRef.trim().length > 0);

  const deidentified =
    methodCited && allCategoriesScreened && remainingIdentifierCategories.length === 0;
  const releaseApproved = deidentified;
  const requiresHumanReview = !deidentified;

  const synthNote =
    "Synthetic/illustrative Safe Harbor category catalog + generalization rules — NOT a certified de-identification engine; a real determination applies the full Safe Harbor method (45 CFR 164.514(b)(2), including the actual-knowledge clause) or a qualified statistician's Expert Determination (§164.514(b)(1)).";

  const reason = deidentified
    ? `Dataset ${request.datasetRef} qualifies as de-identified under ${request.method}: all ${SAFE_HARBOR_CATEGORY_COUNT} Safe Harbor categories were screened and no identifier remains — the dataset may be released as de-identified`
    : !methodCited
      ? `Dataset ${request.datasetRef} does not cite a recognized de-identification method (expert-determination requires a determination reference) — not de-identified; requires human review`
      : !allCategoriesScreened
        ? `Dataset ${request.datasetRef} did not screen all ${SAFE_HARBOR_CATEGORY_COUNT} Safe Harbor categories (${categoriesScreened.length} screened) — the screen is incomplete; not de-identified; requires human review`
        : `Dataset ${request.datasetRef} still contains ${remainingIdentifierCategories.length} remaining identifier categor${remainingIdentifierCategories.length === 1 ? "y" : "ies"} (${remainingIdentifierCategories.join(", ")}) — not de-identified; releasing re-identifiable data requires human review under a data use agreement`;

  return {
    datasetRef: request.datasetRef,
    method: request.method,
    fieldCount: fields.length,
    identifierCategoriesPresent,
    remainingIdentifierCategories,
    categoriesScreened,
    allCategoriesScreened,
    methodCited,
    deidentified,
    releaseApproved,
    requiresHumanReview,
    reason,
    synthetic: true,
    note:
      `De-identification determination for ${request.datasetRef}: method ${request.method}, ${fields.length} field(s), ${categoriesScreened.length}/${SAFE_HARBOR_CATEGORY_COUNT} categories screened → ${deidentified ? "DE-IDENTIFIED (release approved)" : "NOT de-identified (requires human review)"}. ` +
      `${remainingIdentifierCategories.length > 0 ? `Remaining identifier categories: ${remainingIdentifierCategories.join(", ")}. ` : "No remaining identifier categories. "}` +
      synthNote
  };
}

/**
 * All-categories-screened check: were all eighteen Safe Harbor categories screened? True
 * when allCategoriesScreened is set; the guard that catches an INCOMPLETE screen that skips
 * a category (an un-screened category may hide a re-identifying identifier). Anything
 * evaluateDeidentification() produces from a complete screen satisfies it. This is the
 * honest signal the route reports to policy.deid.all-categories-screened. A non-object input
 * is a violation.
 */
export function deidAllCategoriesScreened(
  determination: Pick<DeidentificationDetermination, "allCategoriesScreened"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return determination.allCategoriesScreened === true;
}

/**
 * Method-cited check: does the determination cite a recognized de-identification method?
 * True when methodCited is set; the guard that catches an ad-hoc / un-cited method (or an
 * expert determination with no cited reference). Anything evaluateDeidentification() produces
 * from a recognized method satisfies it. This is the honest signal the route reports to
 * policy.deid.method-cited. A non-object input is a violation.
 */
export function deidMethodCited(
  determination: Pick<DeidentificationDetermination, "methodCited"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return determination.methodCited === true;
}

/**
 * No-release-of-reidentifiable check: is a dataset with a remaining identifier kept from
 * being released? True unless a determination asserts a remaining identifier category while
 * nonetheless marking the dataset de-identified or release-approved; the guard that catches
 * releasing re-identifiable data as if it were de-identified. Anything
 * evaluateDeidentification() produces satisfies it (a dataset with a remaining identifier is
 * never de-identified / released). This is the honest signal the route reports to
 * policy.deid.no-release-of-reidentifiable. A non-object input is a violation.
 */
export function deidNoReleaseOfReidentifiable(
  determination:
    | Pick<
        DeidentificationDetermination,
        "remainingIdentifierCategories" | "releaseApproved" | "deidentified"
      >
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  const remaining = Array.isArray(determination.remainingIdentifierCategories)
    ? determination.remainingIdentifierCategories
    : [];
  const releasedOrDeidentified =
    determination.releaseApproved === true || determination.deidentified === true;
  return !(remaining.length > 0 && releasedOrDeidentified);
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent
 * Fabric trace + the response `meta`. Carries no field-level data (refs, counts, and the
 * flags only).
 */
export function deidentificationSummary(determination: DeidentificationDetermination): {
  datasetRef: string;
  method: string;
  fieldCount: number;
  remainingIdentifierCategoryCount: number;
  allCategoriesScreened: boolean;
  methodCited: boolean;
  deidentified: boolean;
  releaseApproved: boolean;
  synthetic: boolean;
} {
  return {
    datasetRef: determination.datasetRef,
    method: determination.method,
    fieldCount: determination.fieldCount,
    remainingIdentifierCategoryCount: determination.remainingIdentifierCategories.length,
    allCategoriesScreened: determination.allCategoriesScreened,
    methodCited: determination.methodCited,
    deidentified: determination.deidentified,
    releaseApproved: determination.releaseApproved,
    synthetic: determination.synthetic
  };
}

/** All eighteen Safe Harbor category codes — convenience for building a complete screen. */
const ALL_CATEGORY_CODES = SAFE_HARBOR_CATEGORIES.map((c) => c.code);

/** Category codes NOT present as a field in the demo fields below (attested absent). */
function absentExcept(present: string[]): string[] {
  return ALL_CATEGORY_CODES.filter((c) => !present.includes(c));
}

/**
 * A representative demo request (illustrative). A dataset scrubbed to Safe Harbor: names +
 * MRN removed, dates generalized to year, geography generalized to the first three ZIP
 * digits, with the remaining categories attested absent → de-identified, release approved.
 * Synthetic.
 */
export const DEMO_DEIDENTIFICATION_REQUEST: DeidentificationRequest = {
  datasetRef: "deid-dataset-001",
  method: "safe-harbor",
  fields: [
    { name: "patient_name", category: "names", action: "removed" },
    { name: "mrn", category: "mrn", action: "removed" },
    { name: "date_of_birth", category: "dates", action: "generalized" },
    { name: "home_zip", category: "geographic", action: "generalized" },
    { name: "diagnosis_code", category: NON_IDENTIFIER, action: "retained" },
    { name: "hormone_level", category: NON_IDENTIFIER, action: "retained" }
  ],
  attestedAbsentCategories: absentExcept(["names", "mrn", "dates", "geographic"])
};

/**
 * A representative expert-determination demo request (illustrative). The same dataset
 * de-identified under a cited Expert Determination reference. Synthetic.
 */
export const DEMO_DEIDENTIFICATION_EXPERT_REQUEST: DeidentificationRequest = {
  datasetRef: "deid-dataset-002",
  method: "expert-determination",
  expertDeterminationRef: "expert-det-2026-014",
  fields: [
    { name: "patient_name", category: "names", action: "removed" },
    { name: "mrn", category: "mrn", action: "removed" },
    { name: "date_of_birth", category: "dates", action: "generalized" },
    { name: "home_zip", category: "geographic", action: "generalized" },
    { name: "diagnosis_code", category: NON_IDENTIFIER, action: "retained" }
  ],
  attestedAbsentCategories: absentExcept(["names", "mrn", "dates", "geographic"])
};

/**
 * A representative demo request that is NOT de-identified (illustrative). The MRN is
 * retained → a remaining identifier; not de-identified, requires human review. Synthetic.
 */
export const DEMO_DEIDENTIFICATION_RETAINED_REQUEST: DeidentificationRequest = {
  datasetRef: "deid-dataset-003",
  method: "safe-harbor",
  fields: [
    { name: "patient_name", category: "names", action: "removed" },
    { name: "mrn", category: "mrn", action: "retained" },
    { name: "date_of_birth", category: "dates", action: "generalized" },
    { name: "home_zip", category: "geographic", action: "generalized" },
    { name: "diagnosis_code", category: NON_IDENTIFIER, action: "retained" }
  ],
  attestedAbsentCategories: absentExcept(["names", "mrn", "dates", "geographic"])
};

/**
 * A representative demo request with an INCOMPLETE screen (illustrative). Only a few
 * categories are screened; the rest are neither present nor attested absent → not
 * de-identified, requires human review. Synthetic.
 */
export const DEMO_DEIDENTIFICATION_INCOMPLETE_REQUEST: DeidentificationRequest = {
  datasetRef: "deid-dataset-004",
  method: "safe-harbor",
  fields: [
    { name: "patient_name", category: "names", action: "removed" },
    { name: "mrn", category: "mrn", action: "removed" },
    { name: "diagnosis_code", category: NON_IDENTIFIER, action: "retained" }
  ],
  attestedAbsentCategories: ["dates", "geographic"]
};
