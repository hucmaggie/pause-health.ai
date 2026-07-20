/**
 * Formulary & Drug Utilization Review — deterministic formulary evaluation
 * (tier, step-therapy, quantity limits, drug-drug interactions) with a
 * catalog-sourced rule engine and clinician-cosign-gated exceptions.
 *
 * Deterministic, dependency-free domain core the Formulary & Drug
 * Utilization Review Agent (app/api/agents/formulary-review) wraps — the
 * Salesforce "Agentforce for Health" / Health Cloud formulary / DUR analog
 * on Pause's Agent Fabric. For a proposed medication it looks up the
 * payer's formulary tier, verifies step-therapy sequencing against the
 * patient's prior-therapy history, applies quantity limits, and screens for
 * documented drug-drug interactions — classifying each request as
 * preferred-approved / pend-step-therapy / pend-quantity-limit /
 * pend-interaction-review / pend-non-formulary. It NEVER autonomously
 * overrides a formulary exception; every non-preferred override is DRAFTED
 * for clinician cosign. Menopause-relevant because HRT tier placement
 * varies significantly by plan (transdermal estradiol is often Tier 2 or
 * non-formulary despite being clinically preferred for CVD-risk profiles).
 *
 *   Inbound:  FormularyReviewRequest (a synthetic memberRef + proposed
 *             drugRef — clearly labeled illustrative — the patient's prior-
 *             therapy history, current medications, an ISO asOfDate accepted
 *             as data, and the plan's formulary reference)
 *   Outbound: FormularyReviewDecision { requestRef, decision:
 *             'preferred-approved' | 'pend-step-therapy' | 'pend-quantity-
 *             limit' | 'pend-interaction-review' | 'pend-non-formulary',
 *             appliedRules[], primaryReasonCode, routedTo, tier,
 *             requiresClinicianCosign, cosigned:false, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: drugs + rules trace to the catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every proposed drug must trace to the defined FORMULARY_DRUG_CATALOG
 *  and every applied rule to FORMULARY_RULE_CATALOG (tier, step-therapy,
 *  quantity-limit, interaction). Fabricating a rule ("we just said no") or
 *  citing an off-catalog drug fails. rulesTraceToCatalog() reports the
 *  honest signal the Agent Fabric enforces via policy.formulary.catalog-
 *  sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: step-therapy is honored.
 *  ─────────────────────────────────────────────────────────────────────
 *  When the plan requires step-therapy (must try drug A before drug B), the
 *  agent must verify prior-therapy history is DOCUMENTED before returning
 *  a preferred-approved decision. Skipping step therapy or approving on
 *  claimed-but-undocumented history is a common audit finding and payer-
 *  compliance failure. stepTherapyIsHonored() reports the honest signal
 *  the Agent Fabric enforces via policy.formulary.step-therapy-honored.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous override / exception.
 *  ─────────────────────────────────────────────────────────────────────
 *  A formulary exception, non-preferred override, or manual tier-lower is
 *  legally consequential (Medicare Advantage Chapter 6 + Part D requires
 *  a documented rationale from a prescriber). Every non-preferred-approved
 *  decision the agent produces is requiresClinicianCosign:true /
 *  cosigned:false; a caller-asserted plan that claims cosigned:true or
 *  bypasses cosign is a violation. Mirrors the Claims Adjudication Agent's
 *  no-autonomous-denial, the PA Agent's no-autonomous-submission, and the
 *  CCM Agent's no-autonomous-billing posture. exceptionRequiresClinicianCosign()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.formulary.no-autonomous-override.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified formulary / DUR engine.
 *  ─────────────────────────────────────────────────────────────────────
 *  The drug catalog, rule catalog, tier assignments, step-therapy chains,
 *  quantity limits, and interaction pairs below are ILLUSTRATIVE synthetic
 *  / demo values that model the SHAPE of a payer's formulary + drug-
 *  utilization-review pipeline — they are NOT Medi-Span, First Databank,
 *  RxNorm, an actual payer's formulary file, or a certified DUR engine.
 *  The refs + amounts are synthetic / de-identified. There is NO random-
 *  ness and NO clock anywhere here: the decision is a pure function of the
 *  request + patient history + catalog + caller-provided asOfDate, so the
 *  same context always yields the same decision.
 */

/** A single drug in the illustrative formulary catalog. */
export type FormularyDrug = {
  /** Stable catalog id every proposed drug references (never invented). */
  id: string;
  /** Human-readable label (illustrative name). */
  label: string;
  /**
   * Formulary tier under the plan's design. 1 = preferred generic,
   * 2 = preferred brand / non-preferred generic, 3 = non-preferred brand,
   * 4 = specialty / high-cost, "non-formulary" = requires exception.
   * Illustrative — real plans have plan-specific tier maps.
   */
  tier: 1 | 2 | 3 | 4 | "non-formulary";
  /** Therapeutic class (illustrative). */
  therapeuticClass: string;
  /**
   * The illustrative quantity limit (units per month), or null when the
   * plan has no explicit limit for this drug.
   */
  quantityLimit: number | null;
  /** Always true — the catalog is an illustrative synthetic. */
  synthetic: true;
};

/**
 * The illustrative formulary drug catalog. Menopause-relevant drugs +
 * a few common midlife maintenance meds to model the SHAPE of a payer's
 * formulary file. NOT a real payer's formulary.
 */
export const FORMULARY_DRUG_CATALOG: FormularyDrug[] = [
  {
    id: "drug.estradiol-oral-1mg",
    label: "Estradiol 1mg oral tablet",
    tier: 1,
    therapeuticClass: "menopausal HRT (systemic estrogen)",
    quantityLimit: 30,
    synthetic: true
  },
  {
    id: "drug.estradiol-patch-0.05mg",
    label: "Estradiol 0.05mg/24h transdermal patch",
    tier: 2,
    therapeuticClass: "menopausal HRT (systemic estrogen)",
    quantityLimit: 8,
    synthetic: true
  },
  {
    id: "drug.estradiol-vaginal-cream",
    label: "Estradiol vaginal cream (0.01%)",
    tier: 3,
    therapeuticClass: "menopausal HRT (local estrogen)",
    quantityLimit: 42,
    synthetic: true
  },
  {
    id: "drug.progesterone-oral-100mg",
    label: "Progesterone 100mg oral (micronized)",
    tier: 1,
    therapeuticClass: "menopausal HRT (progestin)",
    quantityLimit: 30,
    synthetic: true
  },
  {
    id: "drug.paroxetine-7.5mg",
    label: "Paroxetine 7.5mg (non-hormonal vasomotor)",
    tier: 2,
    therapeuticClass: "SSRI (vasomotor symptoms — Brisdelle)",
    quantityLimit: 30,
    synthetic: true
  },
  {
    id: "drug.venlafaxine-er-75mg",
    label: "Venlafaxine ER 75mg (off-label vasomotor)",
    tier: 1,
    therapeuticClass: "SNRI (off-label vasomotor)",
    quantityLimit: 30,
    synthetic: true
  },
  {
    id: "drug.fezolinetant-45mg",
    label: "Fezolinetant 45mg (Veozah, NK3 antagonist)",
    tier: "non-formulary",
    therapeuticClass: "NK3 antagonist (non-hormonal vasomotor)",
    quantityLimit: 30,
    synthetic: true
  },
  {
    id: "drug.alendronate-70mg-weekly",
    label: "Alendronate 70mg oral weekly (bone)",
    tier: 1,
    therapeuticClass: "bisphosphonate",
    quantityLimit: 4,
    synthetic: true
  },
  {
    id: "drug.zolpidem-10mg",
    label: "Zolpidem 10mg (sleep)",
    tier: 2,
    therapeuticClass: "hypnotic",
    quantityLimit: 15,
    synthetic: true
  },
  {
    id: "drug.warfarin-5mg",
    label: "Warfarin 5mg (anticoagulant)",
    tier: 1,
    therapeuticClass: "anticoagulant",
    quantityLimit: 30,
    synthetic: true
  }
];

const DRUG_BY_ID = new Map<string, FormularyDrug>(
  FORMULARY_DRUG_CATALOG.map((d) => [d.id, d])
);

/** Is `id` a defined formulary drug catalog id? */
export function isFormularyDrug(id: unknown): boolean {
  return typeof id === "string" && DRUG_BY_ID.has(id);
}

/** Look up a drug (undefined for an off-catalog id). */
export function getFormularyDrug(id: string): FormularyDrug | undefined {
  return DRUG_BY_ID.get(id);
}

/** A rule the review engine can apply. */
export type FormularyRule = {
  id: string;
  label: string;
  /** The decision tier when this rule fires. */
  fires:
    | "pend-step-therapy"
    | "pend-quantity-limit"
    | "pend-interaction-review"
    | "pend-non-formulary";
  rationale: string;
  synthetic: true;
};

/** The illustrative rule catalog. */
export const FORMULARY_RULE_CATALOG: FormularyRule[] = [
  {
    id: "rule.step-therapy-required",
    label: "Step therapy — try preferred agent before this one",
    fires: "pend-step-therapy",
    rationale:
      "Payer requires a documented trial of the preferred agent before this non-preferred one; pend for clinician review or step-therapy exception.",
    synthetic: true
  },
  {
    id: "rule.quantity-limit-exceeded",
    label: "Quantity limit exceeded",
    fires: "pend-quantity-limit",
    rationale:
      "Requested quantity exceeds the plan's monthly quantity limit for this drug; pend for clinician review or quantity-limit exception.",
    synthetic: true
  },
  {
    id: "rule.drug-drug-interaction",
    label: "Drug-drug interaction with a documented current medication",
    fires: "pend-interaction-review",
    rationale:
      "The proposed drug has a documented interaction with a current medication on the member's list; pend for clinician review.",
    synthetic: true
  },
  {
    id: "rule.non-formulary",
    label: "Non-formulary — requires formulary exception",
    fires: "pend-non-formulary",
    rationale:
      "This drug is non-formulary under the plan; a formulary exception requires prescriber attestation and clinician review.",
    synthetic: true
  }
];

const RULE_BY_ID = new Map<string, FormularyRule>(
  FORMULARY_RULE_CATALOG.map((r) => [r.id, r])
);

/** Is `id` a defined rule catalog id? */
export function isFormularyRule(id: unknown): boolean {
  return typeof id === "string" && RULE_BY_ID.has(id);
}

/** Look up a rule (undefined for an off-catalog id). */
export function getFormularyRule(id: string): FormularyRule | undefined {
  return RULE_BY_ID.get(id);
}

/**
 * Illustrative step-therapy chains: for each key drug, the plan requires a
 * DOCUMENTED trial of at least one drug on the `mustTryFirst` list before
 * approving the target. Illustrative — real chains are plan-specific.
 */
export const STEP_THERAPY_CHAINS: Record<string, readonly string[]> = {
  "drug.estradiol-patch-0.05mg": ["drug.estradiol-oral-1mg"],
  "drug.paroxetine-7.5mg": ["drug.venlafaxine-er-75mg"],
  "drug.fezolinetant-45mg": [
    "drug.estradiol-oral-1mg",
    "drug.venlafaxine-er-75mg"
  ]
};

/**
 * Illustrative interaction pairs: any of these pairs on the member's
 * medication list at the same time triggers pend-interaction-review.
 * Illustrative — a real DUR engine has thousands of pairs.
 */
export const INTERACTION_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // Estrogen + warfarin: estrogens can alter INR — clinician review.
  ["drug.estradiol-oral-1mg", "drug.warfarin-5mg"],
  ["drug.estradiol-patch-0.05mg", "drug.warfarin-5mg"],
  // Zolpidem + venlafaxine (an SSRI-adjacent): serotonergic / CNS interaction.
  ["drug.zolpidem-10mg", "drug.venlafaxine-er-75mg"]
];

/**
 * Standard reason codes the fabric emits alongside every non-preferred
 * decision. Illustrative — not real X12 CARC / RARC codes.
 */
export const FORMULARY_REASON_CODE_CATALOG = [
  {
    id: "reason.PF-100",
    label: "PF-100 — Preferred formulary approval (Tier 1 or Tier 2)",
    synthetic: true
  },
  {
    id: "reason.PF-200",
    label: "PF-200 — Step therapy required (try preferred agent first)",
    synthetic: true
  },
  {
    id: "reason.PF-201",
    label: "PF-201 — Quantity limit exceeded (pend for exception)",
    synthetic: true
  },
  {
    id: "reason.PF-202",
    label: "PF-202 — Drug-drug interaction (pend for clinician review)",
    synthetic: true
  },
  {
    id: "reason.PF-203",
    label: "PF-203 — Non-formulary (pend for formulary exception)",
    synthetic: true
  }
] as const;

const REASON_BY_ID = new Map<string, (typeof FORMULARY_REASON_CODE_CATALOG)[number]>(
  FORMULARY_REASON_CODE_CATALOG.map((r) => [r.id, r])
);

/** Is `id` a defined formulary reason code? */
export function isFormularyReasonCode(id: unknown): boolean {
  return typeof id === "string" && REASON_BY_ID.has(id);
}

/**
 * A member's current medication (subset — just the drug id + start date).
 * Illustrative — a real DUR consumer would have richer records.
 */
export type CurrentMedication = {
  drugId: string;
  startedOn: string;
};

/**
 * A member's prior-therapy history — documented trials of drugs the plan
 * cares about for step-therapy sequencing. Each entry has a start + end
 * date + a documentation source; `documented:false` entries are ignored
 * for step-therapy honoring (the load-bearing failure the fabric catches).
 */
export type PriorTherapy = {
  drugId: string;
  startedOn: string;
  endedOn: string;
  /**
   * True when the therapy trial is documented in an approved source
   * (pharmacy-fill, prescriber-attestation). Undocumented / self-reported
   * therapy is DELIBERATELY excluded from step-therapy honoring.
   */
  documented: boolean;
};

/** The structured input the reviewer reads. */
export type FormularyReviewRequest = {
  requestRef: string;
  memberRef: string;
  /** ISO asOfDate (accepted as data — no clock). */
  asOfDate: string;
  /** The proposed drug (must be catalog-sourced). */
  proposedDrugId: string;
  /** Requested quantity (units for the month). */
  requestedQuantity: number;
  /** The member's currently-on-file medications. */
  currentMedications?: readonly CurrentMedication[];
  /** The member's prior-therapy history. */
  priorTherapy?: readonly PriorTherapy[];
};

/** A single rule hit — the rule id + reason code + detail. */
export type AppliedRule = {
  ruleId: string;
  ruleLabel: string;
  reasonCode: string;
  reasonLabel: string;
  detail: string;
};

/** The decision tier. */
export type FormularyDecision =
  | "preferred-approved"
  | "pend-step-therapy"
  | "pend-quantity-limit"
  | "pend-interaction-review"
  | "pend-non-formulary";

/** The routing target when the decision isn't preferred-approved. */
export type FormularyRoute =
  | "auto-approved"
  | "clinician-review"
  | "pharmacist-review"
  | null;

/** The full review decision. */
export type FormularyReviewDecision = {
  requestRef: string;
  memberRef: string;
  asOfDate: string;
  proposedDrugId: string;
  proposedDrugLabel: string;
  tier: FormularyDrug["tier"];
  decision: FormularyDecision;
  appliedRules: readonly AppliedRule[];
  primaryReasonCode: string;
  primaryReasonLabel: string;
  routedTo: FormularyRoute;
  requiresClinicianCosign: boolean;
  /** Always false — the agent NEVER autonomously cosigns an override. */
  cosigned: false;
  /** Always true — the catalog + refs are illustrative synthetics. */
  synthetic: true;
  note: string;
};

/** Decision severity (higher = later route). */
const DECISION_SEVERITY: Record<FormularyDecision, number> = {
  "preferred-approved": 0,
  "pend-quantity-limit": 1,
  "pend-interaction-review": 2,
  "pend-step-therapy": 3,
  "pend-non-formulary": 4
};

/**
 * Deterministically evaluate all rules for a review request. Returns the
 * sorted (by rule-id ascending) list of applied rules.
 */
export function evaluateFormularyRules(
  req: FormularyReviewRequest
): readonly AppliedRule[] {
  const drug = getFormularyDrug(req.proposedDrugId);
  if (!drug) return [];
  const hits: AppliedRule[] = [];

  // Non-formulary tier → single-rule pend.
  if (drug.tier === "non-formulary") {
    hits.push({
      ruleId: "rule.non-formulary",
      ruleLabel: getFormularyRule("rule.non-formulary")!.label,
      reasonCode: "reason.PF-203",
      reasonLabel: REASON_BY_ID.get("reason.PF-203")!.label,
      detail: `${drug.label} is non-formulary under the plan`
    });
  }

  // Step-therapy: any documented prior therapy from the chain satisfies.
  const chain = STEP_THERAPY_CHAINS[req.proposedDrugId] ?? [];
  if (chain.length > 0) {
    const documentedTrials = (req.priorTherapy ?? []).filter(
      (t) => t.documented === true && chain.includes(t.drugId)
    );
    if (documentedTrials.length === 0) {
      hits.push({
        ruleId: "rule.step-therapy-required",
        ruleLabel: getFormularyRule("rule.step-therapy-required")!.label,
        reasonCode: "reason.PF-200",
        reasonLabel: REASON_BY_ID.get("reason.PF-200")!.label,
        detail: `step-therapy required — documented trial of ${chain.join(", ")} not on file`
      });
    }
  }

  // Quantity-limit.
  if (
    typeof drug.quantityLimit === "number" &&
    req.requestedQuantity > drug.quantityLimit
  ) {
    hits.push({
      ruleId: "rule.quantity-limit-exceeded",
      ruleLabel: getFormularyRule("rule.quantity-limit-exceeded")!.label,
      reasonCode: "reason.PF-201",
      reasonLabel: REASON_BY_ID.get("reason.PF-201")!.label,
      detail: `requested ${req.requestedQuantity} exceeds plan limit ${drug.quantityLimit} for ${drug.label}`
    });
  }

  // Drug-drug interaction.
  const currentIds = new Set((req.currentMedications ?? []).map((m) => m.drugId));
  const interactionHit = INTERACTION_PAIRS.find(([a, b]) => {
    return (a === req.proposedDrugId && currentIds.has(b)) ||
      (b === req.proposedDrugId && currentIds.has(a));
  });
  if (interactionHit) {
    const otherDrugId = interactionHit[0] === req.proposedDrugId ? interactionHit[1] : interactionHit[0];
    const otherDrug = getFormularyDrug(otherDrugId);
    hits.push({
      ruleId: "rule.drug-drug-interaction",
      ruleLabel: getFormularyRule("rule.drug-drug-interaction")!.label,
      reasonCode: "reason.PF-202",
      reasonLabel: REASON_BY_ID.get("reason.PF-202")!.label,
      detail: `interaction with ${otherDrug?.label ?? otherDrugId} on the member's medication list`
    });
  }

  return [...hits].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/** Combine hits into a final decision. Highest-severity wins. */
export function summarizeFormularyDecision(
  hits: readonly AppliedRule[]
): { decision: FormularyDecision; primaryReasonCode: string; primaryReasonLabel: string; routedTo: FormularyRoute } {
  if (hits.length === 0) {
    return {
      decision: "preferred-approved",
      primaryReasonCode: "reason.PF-100",
      primaryReasonLabel: REASON_BY_ID.get("reason.PF-100")!.label,
      routedTo: "auto-approved"
    };
  }
  let bestDecision: FormularyDecision = "pend-quantity-limit";
  let bestReasonCode = "";
  let bestReasonLabel = "";
  for (const hit of hits) {
    const rule = getFormularyRule(hit.ruleId)!;
    if (DECISION_SEVERITY[rule.fires] > DECISION_SEVERITY[bestDecision] || bestReasonCode === "") {
      bestDecision = rule.fires;
      bestReasonCode = hit.reasonCode;
      bestReasonLabel = hit.reasonLabel;
    }
  }
  const routedTo: FormularyRoute =
    bestDecision === "pend-interaction-review"
      ? "pharmacist-review"
      : "clinician-review";
  return { decision: bestDecision, primaryReasonCode: bestReasonCode, primaryReasonLabel: bestReasonLabel, routedTo };
}

/** Deterministically produce the full review decision. */
export function reviewFormularyRequest(
  req: FormularyReviewRequest
): FormularyReviewDecision {
  const drug = getFormularyDrug(req.proposedDrugId);
  if (!drug) {
    return {
      requestRef: req.requestRef,
      memberRef: req.memberRef,
      asOfDate: req.asOfDate,
      proposedDrugId: req.proposedDrugId,
      proposedDrugLabel: "(off-catalog)",
      tier: "non-formulary",
      decision: "pend-non-formulary",
      appliedRules: [],
      primaryReasonCode: "reason.PF-203",
      primaryReasonLabel: REASON_BY_ID.get("reason.PF-203")!.label,
      routedTo: "clinician-review",
      requiresClinicianCosign: true,
      cosigned: false,
      synthetic: true,
      note: `Off-catalog drug ${req.proposedDrugId} — pended for clinician review; the agent NEVER autonomously overrides a formulary exception.`
    };
  }
  const appliedRules = evaluateFormularyRules(req);
  const { decision, primaryReasonCode, primaryReasonLabel, routedTo } =
    summarizeFormularyDecision(appliedRules);
  const requiresClinicianCosign = decision !== "preferred-approved";
  const note =
    decision === "preferred-approved"
      ? `Preferred-approved: ${drug.label} (Tier ${drug.tier}) — no rules fired.`
      : `${decision} for ${drug.label} (Tier ${drug.tier}): ${appliedRules.length} rule${appliedRules.length === 1 ? "" : "s"} hit, primary reason ${primaryReasonCode}. Routed to ${routedTo}. ` +
        "The agent NEVER autonomously overrides a formulary exception — every non-preferred decision is DRAFTED for clinician cosign.";
  return {
    requestRef: req.requestRef,
    memberRef: req.memberRef,
    asOfDate: req.asOfDate,
    proposedDrugId: req.proposedDrugId,
    proposedDrugLabel: drug.label,
    tier: drug.tier,
    decision,
    appliedRules,
    primaryReasonCode,
    primaryReasonLabel,
    routedTo,
    requiresClinicianCosign,
    cosigned: false,
    synthetic: true,
    note
  };
}

/**
 * Catalog-source check: does the decision cite a drug on FORMULARY_DRUG_
 * CATALOG AND every applied rule on FORMULARY_RULE_CATALOG? True when both
 * hold. The guard against a fabricated drug or an off-catalog rule.
 * A non-object input is a violation.
 */
export function rulesTraceToCatalog(
  input:
    | {
        proposedDrugId?: string;
        appliedRules?: ReadonlyArray<{ ruleId?: string; reasonCode?: string }>;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  if (!isFormularyDrug(input.proposedDrugId)) return false;
  const rules = input.appliedRules ?? [];
  if (!Array.isArray(rules)) return false;
  return rules.every(
    (r) => isFormularyRule(r.ruleId) && isFormularyReasonCode(r.reasonCode)
  );
}

/**
 * Step-therapy check: when the plan requires step-therapy for the proposed
 * drug, does the member have a DOCUMENTED prior-therapy trial on file for
 * one of the chain drugs? True when either no step-therapy is required OR
 * a documented trial is on file. False when step-therapy is required but
 * only undocumented / self-reported trials are on file (the load-bearing
 * failure). A non-object input is a violation.
 */
export function stepTherapyIsHonored(
  input:
    | {
        proposedDrugId?: string;
        priorTherapy?: readonly { drugId?: string; documented?: boolean }[];
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  if (typeof input.proposedDrugId !== "string") return false;
  const chain = STEP_THERAPY_CHAINS[input.proposedDrugId];
  if (!chain || chain.length === 0) return true; // no step therapy required
  const priorTherapy = input.priorTherapy ?? [];
  if (!Array.isArray(priorTherapy)) return false;
  return priorTherapy.some(
    (t) =>
      t.documented === true &&
      typeof t.drugId === "string" &&
      chain.includes(t.drugId)
  );
}

/**
 * Cosign-gate check: does the decision require clinician cosign when it
 * isn't preferred-approved, and is it explicitly NOT cosigned? True when
 * either the decision is preferred-approved (no cosign needed) OR the
 * pend is properly gated. The guard against a caller-asserted cosigned:
 * true or requiresClinicianCosign:false on a pend. This is the honest
 * signal the route reports to policy.formulary.no-autonomous-override.
 * A non-object input is a violation.
 */
export function exceptionRequiresClinicianCosign(
  decision:
    | {
        decision?: string;
        requiresClinicianCosign?: boolean;
        cosigned?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.decision === "preferred-approved") return true;
  if (decision.requiresClinicianCosign !== true) return false;
  if (decision.cosigned === true) return false;
  return true;
}

/** Preferred-approved happy-path demo — Tier 1 estradiol oral, in-quantity. */
export const DEMO_PREFERRED_REQUEST: FormularyReviewRequest = {
  requestRef: "formulary-req-2026-07-001",
  memberRef: "member-001",
  asOfDate: "2026-07-05",
  proposedDrugId: "drug.estradiol-oral-1mg",
  requestedQuantity: 30,
  currentMedications: [],
  priorTherapy: []
};

/** Step-therapy demo — patch requested, no documented oral trial. */
export const DEMO_STEP_THERAPY_REQUEST: FormularyReviewRequest = {
  requestRef: "formulary-req-2026-07-002",
  memberRef: "member-002",
  asOfDate: "2026-07-05",
  proposedDrugId: "drug.estradiol-patch-0.05mg",
  requestedQuantity: 8,
  currentMedications: [],
  priorTherapy: [
    // self-reported (documented:false) — should NOT satisfy step therapy
    {
      drugId: "drug.estradiol-oral-1mg",
      startedOn: "2025-01-01",
      endedOn: "2025-06-30",
      documented: false
    }
  ]
};

/** Quantity-limit demo — 60 units requested vs. 30 limit. */
export const DEMO_QUANTITY_LIMIT_REQUEST: FormularyReviewRequest = {
  requestRef: "formulary-req-2026-07-003",
  memberRef: "member-003",
  asOfDate: "2026-07-05",
  proposedDrugId: "drug.estradiol-oral-1mg",
  requestedQuantity: 60,
  currentMedications: [],
  priorTherapy: []
};

/** Interaction demo — estradiol proposed while on warfarin. */
export const DEMO_INTERACTION_REQUEST: FormularyReviewRequest = {
  requestRef: "formulary-req-2026-07-004",
  memberRef: "member-004",
  asOfDate: "2026-07-05",
  proposedDrugId: "drug.estradiol-oral-1mg",
  requestedQuantity: 30,
  currentMedications: [
    { drugId: "drug.warfarin-5mg", startedOn: "2025-06-01" }
  ],
  priorTherapy: []
};

/** Non-formulary demo — fezolinetant (Veozah). */
export const DEMO_NON_FORMULARY_REQUEST: FormularyReviewRequest = {
  requestRef: "formulary-req-2026-07-005",
  memberRef: "member-005",
  asOfDate: "2026-07-05",
  proposedDrugId: "drug.fezolinetant-45mg",
  requestedQuantity: 30,
  currentMedications: [],
  priorTherapy: []
};
