/**
 * Prior Authorization — assemble a clinician-gated, documentation-complete PA.
 *
 * Deterministic, dependency-free domain core the Prior Authorization Agent
 * (app/api/agents/prior-authorization) wraps — the Salesforce "Agentforce for
 * Health" / Health Cloud CareRequest + Utilization Management analog on Pause's
 * Agent Fabric. For a PA-requiring item (systemic HRT / compounded estradiol, a
 * bone-density DEXA, or a specialized hormone lab panel) it pulls the (synthetic)
 * clinical context, matches the payer's medical-necessity criteria, assembles the
 * required supporting-documentation checklist (present vs missing), and tracks a
 * status — WITHOUT ever autonomously submitting the PA.
 *
 *   Inbound:  a PriorAuthRequest (item id, member/plan, clinical context, the
 *             documentation the caller has attached, and an optional action)
 *   Outbound: a PriorAuthPackage (matched payer criteria, documentation
 *             completeness, a synthetic PA / CareRequest id, a status of
 *             draft | ready-for-clinician (never submitted from assembly),
 *             requiresClinicianApproval:true, submitted:false, and a `source`
 *             provenance block marked synthetic:true)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  THIS IS THE HEAVIEST AGENT AND THE LEAST DEMO-HONEST OF THE SET.
 * ─────────────────────────────────────────────────────────────────────
 *  Real prior authorization is a genuinely multi-system workflow: an X12 278
 *  (Health Care Services Review) EDI transaction (or a FHIR PAS / Da Vinci
 *  Coverage Requirements Discovery + Documentation Templates and Rules exchange)
 *  against a payer's utilization-management system, with payer-specific policy
 *  bulletins, clinical review, and appeals. NONE of that exists here. There is
 *  NO real 278/EDI, NO real payer PA portal, NO real CareRequest write, NO
 *  network call, NO randomness, and NO clock. Every payer criterion, every
 *  required document, every synthetic CareRequest / authorization id, and every
 *  figure is a DETERMINISTIC value derived by hashing stable request keys. The
 *  criteria and document checklists below are ILLUSTRATIVE synthetic/demo values
 *  chosen to model the SHAPE of a PA package — they are NOT a certified or
 *  payer-authoritative utilization-management engine, and no PA assembled here is
 *  a real coverage determination.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  TWO LOAD-BEARING HONESTY PROPERTIES, both governance-enforced.
 * ─────────────────────────────────────────────────────────────────────
 *  (1) The agent must NOT autonomously submit a PA — a clinician must approve
 *      before submission. This module encodes that: assemblePriorAuth() never
 *      returns a submitted package (status is draft | ready-for-clinician,
 *      submitted:false, requiresClinicianApproval:true), and submitPriorAuth()
 *      REFUSES (throws) unless a clinician approved. priorAuthHasClinicianApproval()
 *      reports the honest signal the Agent Fabric enforces via
 *      policy.pa.no-autonomous-submission (a caller-asserted submit-without-approval
 *      → false → blocked).
 *  (2) A PA submission must include the required supporting documentation
 *      (documentation integrity). The package computes present vs missing docs
 *      deterministically; submitPriorAuth() REFUSES (throws) on a submission with
 *      any missing required document, and priorAuthDocumentationComplete() reports
 *      the honest signal the Agent Fabric enforces via
 *      policy.pa.documentation-integrity (a caller-asserted submit with an
 *      incomplete package → false → blocked). Assembling a DRAFT with missing docs
 *      is allowed — the draft honestly lists what is still outstanding.
 *
 *  Because it is deterministic on its inputs, a given request always produces the
 *  same package — which is what lets the demo, the seeded trace, and the tests
 *  agree.
 */

/** A single payer medical-necessity criterion in the (illustrative) catalog. */
export type PayerCriteria = {
  /** Stable criterion id. */
  id: string;
  /** Human-readable criterion label. */
  label: string;
  /**
   * The (illustrative) medical-necessity rule this criterion encodes. NOT a
   * certified payer policy — a demo-honest description of what the payer would
   * typically require for this item.
   */
  description: string;
};

/** A single required supporting document in the (illustrative) catalog. */
export type SupportingDocRequirement = {
  /** Stable document id (referenced by an item's requiredDocumentation). */
  id: string;
  /** Human-readable document label. */
  label: string;
  /** What the document contains / why the payer requires it (illustrative). */
  description: string;
};

/**
 * A PA-requiring item in the (illustrative) catalog. This is the ONLY source of
 * legitimate PAs — assemblePriorAuth() looks the item up here, so a returned
 * package can never reference an item that isn't defined. Illustrative/synthetic
 * values; NOT a certified utilization-management engine (see the module header).
 */
export type PriorAuthItem = {
  /** Stable catalog id every PA request must reference. */
  id: string;
  /** Human-readable item label. */
  label: string;
  /** The kind of item (drug / imaging / lab), for display + grouping. */
  category: "medication" | "imaging" | "lab";
  /** Short description of the item + why it typically needs a PA (illustrative). */
  description: string;
  /** The payer criteria this item must satisfy (all must be met). */
  criteria: PayerCriteria[];
  /** The document ids the payer requires to accompany a submission. */
  requiredDocumentation: string[];
};

/**
 * The supporting-document catalog: id → label + description. Shared across items
 * so a document (e.g. the clinical note) is described once.
 */
export const SUPPORTING_DOCUMENTS: SupportingDocRequirement[] = [
  {
    id: "doc.clinical-notes",
    label: "Clinical / visit note",
    description:
      "The clinician's note documenting the presentation, exam, and clinical reasoning for the requested item. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "doc.diagnosis-code",
    label: "Diagnosis (ICD-10) code",
    description:
      "The coded diagnosis that establishes the indication (e.g. N95.1 menopausal state). (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "doc.medication-history",
    label: "Medication / therapy history",
    description:
      "The medication + therapy history showing prior/conservative treatment relevant to the request. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "doc.risk-assessment",
    label: "Fracture / osteoporosis risk assessment",
    description:
      "The documented fracture / osteoporosis risk assessment establishing medical necessity for bone-density imaging. (Illustrative — not a certified documentation requirement.)"
  },
  {
    id: "doc.lab-order",
    label: "Signed lab order",
    description:
      "The signed order stating the diagnostic indication for the requested lab panel. (Illustrative — not a certified documentation requirement.)"
  }
];

const DOCUMENT_BY_ID = new Map(SUPPORTING_DOCUMENTS.map((d) => [d.id, d]));

/** Look up a supporting-document requirement by id (undefined if unknown). */
export function getSupportingDocument(
  id: string
): SupportingDocRequirement | undefined {
  return DOCUMENT_BY_ID.get(id);
}

/**
 * The PA-requiring item catalog. Three illustrative items across the menopause
 * neighborhood: systemic HRT (compounded estradiol), a bone-density DEXA scan,
 * and a specialized hormone lab panel. Illustrative/synthetic; NOT a certified
 * utilization-management engine (see the module header).
 */
export const PRIOR_AUTH_ITEMS: PriorAuthItem[] = [
  {
    id: "pa.systemic-hrt",
    label: "Systemic HRT · compounded estradiol",
    category: "medication",
    description:
      "Systemic hormone therapy (compounded estradiol) for moderate-to-severe menopausal symptoms — a compounded / specialty formulation that a payer typically prior-authorizes. (Illustrative.)",
    criteria: [
      {
        id: "pa.hrt.symptoms-documented",
        label: "Moderate-to-severe vasomotor symptoms documented",
        description:
          "The clinical record documents moderate-to-severe vasomotor (or other qualifying menopausal) symptoms."
      },
      {
        id: "pa.hrt.contraindications-screened",
        label: "Hormone-therapy contraindications screened",
        description:
          "Contraindications to hormone therapy have been screened for and documented."
      },
      {
        id: "pa.hrt.conservative-tried",
        label: "First-line / conservative measures considered",
        description:
          "First-line or conservative measures were considered or tried before the compounded formulation."
      }
    ],
    requiredDocumentation: [
      "doc.clinical-notes",
      "doc.diagnosis-code",
      "doc.medication-history"
    ]
  },
  {
    id: "pa.dexa-bone-density",
    label: "Bone-density DEXA scan",
    category: "imaging",
    description:
      "A dual-energy X-ray absorptiometry (DEXA) bone-density scan to assess post-menopausal osteoporosis / fracture risk. (Illustrative.)",
    criteria: [
      {
        id: "pa.dexa.risk-factor",
        label: "Postmenopausal with an osteoporosis risk factor",
        description:
          "The patient is postmenopausal with a documented osteoporosis / fracture risk factor (or meets the payer's age threshold)."
      },
      {
        id: "pa.dexa.interval",
        label: "No prior DEXA within the re-screen interval",
        description:
          "There is no prior DEXA within the payer's minimum re-screen interval (a repeat inside the interval fails medical necessity)."
      }
    ],
    requiredDocumentation: [
      "doc.clinical-notes",
      "doc.diagnosis-code",
      "doc.risk-assessment"
    ]
  },
  {
    id: "pa.hormone-lab-panel",
    label: "Specialized hormone lab panel",
    category: "lab",
    description:
      "A specialized hormone lab panel (e.g. an extended FSH / estradiol / thyroid workup) ordered for a diagnostic indication rather than routine screening. (Illustrative.)",
    criteria: [
      {
        id: "pa.lab.clinical-indication",
        label: "Documented clinical indication for the panel",
        description:
          "The record documents a specific clinical indication for the panel (e.g. suspected premature ovarian insufficiency or an atypical presentation)."
      },
      {
        id: "pa.lab.not-routine-screening",
        label: "Ordered for a diagnostic indication, not routine screening",
        description:
          "The panel is ordered for a diagnostic indication, not as routine screening (which the payer would not authorize)."
      }
    ],
    requiredDocumentation: [
      "doc.clinical-notes",
      "doc.diagnosis-code",
      "doc.lab-order"
    ]
  }
];

const ITEM_BY_ID = new Map(PRIOR_AUTH_ITEMS.map((i) => [i.id, i]));

/** Is `id` a defined PA-requiring item catalog id? */
export function isCatalogItem(id: string): boolean {
  return ITEM_BY_ID.has(id);
}

/** Look up a catalog item by id (undefined for an off-catalog id). */
export function getPriorAuthItem(id: string): PriorAuthItem | undefined {
  return ITEM_BY_ID.get(id);
}

/**
 * The clinical facts the criteria matcher reads. Deterministic: a pure function
 * of the context (no randomness, no clock). Each field is an explicit clinical
 * fact the (synthetic) clinical record would carry; the matcher below maps each
 * item's criteria onto these facts.
 */
export type PriorAuthClinicalContext = {
  // Systemic HRT
  moderateToSevereSymptoms?: boolean;
  contraindicationsScreened?: boolean;
  conservativeMeasuresTried?: boolean;
  // DEXA
  postmenopausalWithRiskFactor?: boolean;
  /** A prior DEXA WITHIN the payer's re-screen interval — a repeat too soon. */
  priorDexaWithinInterval?: boolean;
  // Hormone lab panel
  clinicalIndicationDocumented?: boolean;
  diagnosticIndicationNotScreening?: boolean;
};

/** The member + plan a PA request is filed under (no free-text PII). */
export type PriorAuthMember = {
  /** Member id (structured; not a name). */
  memberId: string;
  /** Plan / policy id the PA is filed under. */
  planId: string;
  /** Payer name (display; drives no math). */
  payer?: string;
};

/** A PA-related action the caller might ask the agent to take. */
export type PriorAuthAction = {
  /** "assemble" drafts the package; "submit" attempts to file it. */
  kind: "assemble" | "submit";
  /** For a submit, whether a clinician approved the PA. */
  clinicianApproved?: boolean;
};

/** A request to assemble (and possibly submit) a prior authorization. */
export type PriorAuthRequest = {
  /** The PA-requiring catalog item this request is about. */
  itemId: string;
  /** The member + plan the PA is filed under. */
  member: PriorAuthMember;
  /** The clinical facts the criteria matcher reads. */
  clinicalContext: PriorAuthClinicalContext;
  /** The document ids the caller has attached (present in the package). */
  attachedDocuments?: string[];
  /** Whether an active ai-decision-support consent is on file for grounding. */
  hasConsent?: boolean;
  /** The action to take (defaults to "assemble"). */
  action?: PriorAuthAction;
};

/** Whether a single payer criterion is met, with a short note. */
export type MatchedCriterion = {
  /** The payer-criteria catalog id (never invented). */
  criteriaId: string;
  /** Copied from the catalog for display convenience. */
  label: string;
  /** Whether the clinical context satisfies this criterion. */
  met: boolean;
  /** Human-readable note (the criterion description). */
  note: string;
};

/** A single supporting document's present/missing status. */
export type SupportingDocStatus = {
  /** The supporting-document catalog id. */
  docId: string;
  /** Copied from the catalog for display convenience. */
  label: string;
  /** Whether this required document was attached to the request. */
  present: boolean;
};

/** The documentation checklist: per-doc status + a completeness roll-up. */
export type SupportingDocs = {
  /** Every required document with its present/missing status. */
  checklist: SupportingDocStatus[];
  /** The ids of documents that are present. */
  present: string[];
  /** The ids of required documents that are still missing. */
  missing: string[];
  /** True iff no required document is missing. */
  complete: boolean;
};

export type PriorAuthStatus =
  | "draft"
  | "ready-for-clinician"
  | "submitted"
  | "approved"
  | "denied";

/** The (mock) utilization-management provenance every package carries. */
export type PriorAuthSource = {
  /** Always true — this provenance describes a synthetic PA package. */
  synthetic: true;
  /** The (mock) utilization-management system the PA is attributed to. */
  system: string;
  /** Deterministic synthetic Health Cloud CareRequest id. */
  careRequestId: string;
  /** Deterministic synthetic authorization / PA reference (hashed, not real). */
  authorizationId: string;
  /** Honesty note kept on the wire so the mock is auditable downstream. */
  note: string;
};

/** The structured, deterministic output of assembling a prior authorization. */
export type PriorAuthPackage = {
  /** The catalog item id this PA is for (never invented). */
  itemId: string;
  /** Copied from the catalog for display convenience. */
  itemLabel: string;
  category: PriorAuthItem["category"];
  /** The member + plan the PA is filed under. */
  member: PriorAuthMember;
  /** The payer criteria matched against the clinical context. */
  criteria: MatchedCriterion[];
  /** Whether EVERY payer criterion is met. */
  criteriaComplete: boolean;
  /** The supporting-documentation checklist + completeness. */
  documentation: SupportingDocs;
  /** The PA status. assemblePriorAuth only ever emits draft | ready-for-clinician. */
  status: PriorAuthStatus;
  /** Always true — a clinician must approve before this PA can be submitted. */
  requiresClinicianApproval: true;
  /** assemblePriorAuth never submits, so this is false until submitPriorAuth. */
  submitted: boolean;
  /** Mock utilization-management provenance — required, always present. */
  source: PriorAuthSource;
  /** A trace/UI-safe one-line summary of the package state. */
  summary: string;
};

/**
 * FNV-1a 32-bit string hash. Pure and deterministic — the same string always
 * produces the same synthetic value, so there is deliberately NO randomness and
 * NO clock anywhere here. (Same hash the scheduling/benefits modules use; kept
 * local so this file stays dependency-free.)
 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic mock utilization-management provenance for a PA request. */
function buildSource(req: PriorAuthRequest): PriorAuthSource {
  const key = `${req.itemId}|${req.member.memberId}|${req.member.planId}`;
  const careRequestId = `care-req-${hashString(`carerequest:${key}`).toString(36)}`;
  const authorizationId = `pa-${hashString(`authorization:${key}`).toString(36)}`;
  return {
    synthetic: true,
    system: "Salesforce Health Cloud · CareRequest / Utilization Management (synthetic)",
    careRequestId,
    authorizationId,
    note: "Synthetic prior-authorization package — deterministic mock, NOT a real X12 278 / FHIR PAS EDI transaction or payer PA portal submission."
  };
}

/**
 * Evaluate a single payer criterion against the clinical context. Deterministic
 * (illustrative, not certified). Returns whether the criterion is met.
 */
function evaluateCriterion(
  criteriaId: string,
  ctx: PriorAuthClinicalContext
): boolean {
  switch (criteriaId) {
    case "pa.hrt.symptoms-documented":
      return ctx.moderateToSevereSymptoms === true;
    case "pa.hrt.contraindications-screened":
      return ctx.contraindicationsScreened === true;
    case "pa.hrt.conservative-tried":
      return ctx.conservativeMeasuresTried === true;
    case "pa.dexa.risk-factor":
      return ctx.postmenopausalWithRiskFactor === true;
    case "pa.dexa.interval":
      // Met only when there is NO prior DEXA within the re-screen interval.
      return ctx.priorDexaWithinInterval === false;
    case "pa.lab.clinical-indication":
      return ctx.clinicalIndicationDocumented === true;
    case "pa.lab.not-routine-screening":
      return ctx.diagnosticIndicationNotScreening === true;
    default:
      return false;
  }
}

/**
 * Match an item's payer criteria against the clinical context. DETERMINISTIC:
 * iterates the item's criteria in order. Because it only ever iterates the
 * catalog item's criteria, every returned criteriaId is a catalog id by
 * construction — the integrity property the Agent Fabric relies on.
 */
export function matchPayerCriteria(
  item: PriorAuthItem,
  ctx: PriorAuthClinicalContext
): MatchedCriterion[] {
  return item.criteria.map((c) => ({
    criteriaId: c.id,
    label: c.label,
    met: evaluateCriterion(c.id, ctx),
    note: c.description
  }));
}

/**
 * Assemble the supporting-documentation checklist for an item against the docs
 * the caller attached. DETERMINISTIC. Every required document appears with its
 * present/missing status; `complete` is true iff nothing required is missing.
 */
export function assembleSupportingDocs(
  item: PriorAuthItem,
  attached: string[] | undefined
): SupportingDocs {
  const attachedSet = new Set(attached ?? []);
  const checklist: SupportingDocStatus[] = item.requiredDocumentation.map(
    (docId) => ({
      docId,
      label: getSupportingDocument(docId)?.label ?? docId,
      present: attachedSet.has(docId)
    })
  );
  const present = checklist.filter((c) => c.present).map((c) => c.docId);
  const missing = checklist.filter((c) => !c.present).map((c) => c.docId);
  return { checklist, present, missing, complete: missing.length === 0 };
}

/**
 * Assemble a prior-authorization package DETERMINISTICALLY. Matches the item's
 * payer criteria against the clinical context, assembles the required-document
 * checklist, and returns a package with a synthetic CareRequest/authorization
 * id and a status of draft | ready-for-clinician.
 *
 * CRITICAL: this NEVER submits. The returned package always carries
 * requiresClinicianApproval:true and submitted:false — a clinician must approve
 * before any submission. "ready-for-clinician" means the package is complete
 * (all criteria met AND all documentation present) and can be handed to a
 * clinician to approve; it does NOT mean it was or will be auto-submitted.
 *
 * Throws on an off-catalog item id (the agent can't assemble a PA for an item
 * that isn't defined) — the integrity guard the governance layer complements.
 */
export function assemblePriorAuth(req: PriorAuthRequest): PriorAuthPackage {
  const item = getPriorAuthItem(req.itemId);
  if (!item) {
    throw new Error(
      `Unknown prior-authorization item "${req.itemId}"; refusing to assemble a PA for an off-catalog item`
    );
  }

  const criteria = matchPayerCriteria(item, req.clinicalContext);
  const criteriaComplete = criteria.every((c) => c.met);
  const documentation = assembleSupportingDocs(item, req.attachedDocuments);

  const status: PriorAuthStatus =
    criteriaComplete && documentation.complete ? "ready-for-clinician" : "draft";

  const summary =
    status === "ready-for-clinician"
      ? `${item.label}: all ${criteria.length} payer criteria met and documentation complete — ready for clinician approval (not submitted).`
      : `${item.label}: draft — ${
          criteria.filter((c) => !c.met).length
        } unmet criteria, ${documentation.missing.length} missing document${
          documentation.missing.length === 1 ? "" : "s"
        } (not submitted).`;

  return {
    itemId: item.id,
    itemLabel: item.label,
    category: item.category,
    member: req.member,
    criteria,
    criteriaComplete,
    documentation,
    status,
    requiresClinicianApproval: true,
    submitted: false,
    source: buildSource(req),
    summary
  };
}

/**
 * The honest governance signal for the no-autonomous-submission property: does
 * this PA action carry the required clinician approval? TRUE for an assemble/
 * draft (the only thing the agent does on its own) and for a clinician-approved
 * submit; FALSE for a caller-asserted AUTONOMOUS submit (no approval). The route
 * reports this to policy.pa.no-autonomous-submission, which blocks when it is
 * false — so the agent can never submit a PA without a clinician's approval.
 */
export function priorAuthHasClinicianApproval(
  action?: PriorAuthAction | null
): boolean {
  if (!action || action.kind === "assemble") return true;
  return action.kind === "submit" ? action.clinicianApproved === true : true;
}

/**
 * The honest governance signal for the documentation-integrity property: is the
 * PA documentation-complete for what is being attempted? TRUE for an assemble/
 * draft (drafting an incomplete package is fine — the draft lists the missing
 * docs) and for a submit whose package is documentation-complete; FALSE ONLY for
 * a submit whose package is missing a required document. The route reports this
 * to policy.pa.documentation-integrity, which blocks when it is false — so a PA
 * can never be submitted missing its required supporting documentation.
 */
export function priorAuthDocumentationComplete(
  pkg: Pick<PriorAuthPackage, "documentation">,
  action?: PriorAuthAction | null
): boolean {
  if (!action || action.kind !== "submit") return true;
  return pkg.documentation.complete === true;
}

/**
 * Submit a prior-authorization package. DEFENSE IN DEPTH: this THROWS rather
 * than submit when either honesty property is violated —
 *   (1) no clinician approval (no-autonomous-submission), or
 *   (2) missing required supporting documentation (documentation-integrity).
 * The agent route sets the matching governance signals so a violation is
 * normally blocked before we get here; this refusal is the belt-and-braces that
 * keeps the domain honest even if a caller bypasses the gate. On success it
 * returns the package advanced to status "submitted" (submitted:true). It is
 * still a SYNTHETIC mock — no real 278/EDI or payer submission occurs.
 */
export function submitPriorAuth(
  pkg: PriorAuthPackage,
  action: PriorAuthAction
): PriorAuthPackage {
  if (!priorAuthHasClinicianApproval(action)) {
    throw new Error(
      "Refusing to submit a prior authorization without clinician approval"
    );
  }
  if (!pkg.documentation.complete) {
    throw new Error(
      "Refusing to submit a prior authorization missing required supporting documentation"
    );
  }
  return {
    ...pkg,
    status: "submitted",
    submitted: true,
    summary: `${pkg.itemLabel}: submitted after clinician approval with complete documentation (synthetic — not a real 278/EDI submission).`
  };
}

/**
 * A compact, trace-safe summary of a PA package — the shape stamped onto the
 * Agent Fabric trace + the response `meta`. Carries no free-text PII (ids,
 * counts, status only).
 */
export function priorAuthSummary(pkg: PriorAuthPackage): {
  itemId: string;
  itemLabel: string;
  category: PriorAuthItem["category"];
  careRequestId: string;
  authorizationId: string;
  criteriaMet: number;
  criteriaTotal: number;
  criteriaComplete: boolean;
  documentsPresent: number;
  documentsRequired: number;
  documentationComplete: boolean;
  status: PriorAuthStatus;
  requiresClinicianApproval: boolean;
  submitted: boolean;
  synthetic: boolean;
} {
  return {
    itemId: pkg.itemId,
    itemLabel: pkg.itemLabel,
    category: pkg.category,
    careRequestId: pkg.source.careRequestId,
    authorizationId: pkg.source.authorizationId,
    criteriaMet: pkg.criteria.filter((c) => c.met).length,
    criteriaTotal: pkg.criteria.length,
    criteriaComplete: pkg.criteriaComplete,
    documentsPresent: pkg.documentation.present.length,
    documentsRequired: pkg.documentation.checklist.length,
    documentationComplete: pkg.documentation.complete,
    status: pkg.status,
    requiresClinicianApproval: pkg.requiresClinicianApproval,
    submitted: pkg.submitted,
    synthetic: pkg.source.synthetic
  };
}

/**
 * A representative, deterministic demo PA request (illustrative). A systemic-HRT
 * PA with all payer criteria met and all required documentation attached — so it
 * assembles to a "ready-for-clinician" package (complete, but still not
 * submitted: a clinician must approve).
 */
export const DEMO_PRIOR_AUTH_REQUEST: PriorAuthRequest = {
  itemId: "pa.systemic-hrt",
  member: {
    memberId: "member-demo-001",
    planId: "plan-choice-ppo",
    payer: "Aetna"
  },
  clinicalContext: {
    moderateToSevereSymptoms: true,
    contraindicationsScreened: true,
    conservativeMeasuresTried: true
  },
  attachedDocuments: [
    "doc.clinical-notes",
    "doc.diagnosis-code",
    "doc.medication-history"
  ],
  hasConsent: true,
  action: { kind: "assemble" }
};
