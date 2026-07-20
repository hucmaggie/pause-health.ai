/**
 * Utilization Review (MCG/InterQual analog) — deterministic medical-necessity
 * screening for a proposed procedure or inpatient admission, with clinician
 * cosign for any denial and a peer-to-peer path when partial criteria are met.
 *
 * Deterministic, dependency-free domain core the Utilization Review Agent
 * (app/api/agents/utilization-review) wraps — the Salesforce "Agentforce
 * for Health" / Health Cloud utilization-management analog on Pause's
 * Agent Fabric. Distinct from the Prior Authorization Agent (which
 * ASSEMBLES a clinician-gated PA submission) and the Claims Adjudication
 * Assistant (which decides POST-SERVICE clean-pay vs deny with mechanical
 * edits): this is the PRE-SERVICE medical-necessity engine — it takes a
 * proposed procedure or admission plus catalog criteria (MCG-analog /
 * InterQual-analog) and classifies it as approves-meets-criteria /
 * pend-for-clinical-review / require-peer-to-peer / blocked-non-covered.
 * It NEVER autonomously denies — every denial-shaped decision is DRAFTED
 * for clinician cosign, and the case has a catalog-sourced SLA deadline
 * that traces to the case-type catalog (illustrative CMS / state timelines).
 *
 *   Inbound:  UtilizationReviewRequest (a synthetic memberRef + proposed
 *             serviceTypeId + evidence flags for each criterion, urgency,
 *             ISO asOfDate accepted as data)
 *   Outbound: UtilizationReviewDecision { requestRef, decision:
 *             'approves-meets-criteria' | 'pend-for-clinical-review' |
 *             'require-peer-to-peer' | 'blocked-non-covered',
 *             appliedRules[], criteriaMet[], criteriaMissing[],
 *             primaryReasonCode, routedTo, slaDeadline, slaWindowHours,
 *             requiresClinicianCosign, cosigned:false, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: applied criteria trace to the catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every applied criterion must trace to the defined UR_CRITERIA_SETS
 *  catalog for the proposed service type, and every applied rule must
 *  trace to UR_RULES. An ad-hoc "we-just-decided-you-don't-need-it"
 *  criterion fails. criteriaTraceToCatalog() reports the honest signal
 *  the Agent Fabric enforces via policy.ur.criteria-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no autonomous denial.
 * ─────────────────────────────────────────────────────────────────────
 *  A UR denial is legally consequential (Medicare Advantage / state
 *  utilization-review-agent codes / due-process notice requirements).
 *  Every denial-shaped decision (pend-for-clinical-review,
 *  require-peer-to-peer) requires clinician cosign — an autonomous
 *  denial is blocked. Every non-approved decision is
 *  requiresClinicianCosign:true / cosigned:false; a caller-asserted
 *  plan that claims cosigned:true or bypasses the cosign gate is a
 *  violation. Mirrors the Claims Adjudication Agent's no-autonomous-
 *  denial, the Formulary Agent's no-autonomous-override, the FWA
 *  Agent's no-autonomous-denial, and the Trial Payments Agent's
 *  no-autonomous-irb-deviation posture. denialRequiresClinicianCosign()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.ur.no-autonomous-denial.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: SLA deadline integrity.
 * ─────────────────────────────────────────────────────────────────────
 *  Every UR case has a regulatory SLA (illustrative: standard 72
 *  hours, expedited/urgent 24 hours, concurrent-review 24 hours).
 *  The case deadline must trace to the case-type catalog + received
 *  date — silently extending it past the maximum breaches Medicare
 *  Advantage Chapter 4 / state utilization-review-agent timelines and
 *  parallels the Grievance & Appeals Agent's deadline-integrity guard.
 *  slaTracesToCatalog() reports the honest signal the Agent Fabric
 *  enforces via policy.ur.sla-integrity.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified utilization-review engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The service-type catalog, criteria sets, rules, reason codes, and
 *  SLA windows below are ILLUSTRATIVE synthetic/demo values that model
 *  the SHAPE of a utilization-review workflow — they are NOT MCG
 *  (Milliman Care Guidelines / Indicia), InterQual, an actual payer's
 *  UR rule set, or a certified medical-necessity engine. The
 *  memberRefs, service-type ids, and criteria ids are synthetic /
 *  de-identified. There is NO randomness and NO clock anywhere here:
 *  review is a pure function of the request + criteria catalog +
 *  caller-provided asOfDate.
 */

/** Urgency of the UR request. */
export type UrgencyLevel = "standard" | "urgent" | "concurrent-review";

/** SLA window hours per urgency level (illustrative CMS timelines). */
export const UR_SLA_WINDOW_HOURS: Record<UrgencyLevel, number> = {
  standard: 72,
  urgent: 24,
  "concurrent-review": 24
};

export function isUrgencyLevel(id: unknown): id is UrgencyLevel {
  return id === "standard" || id === "urgent" || id === "concurrent-review";
}

/** A single service (procedure / admission) in the illustrative catalog. */
export type UrServiceType = {
  id: string;
  label: string;
  /** Whether the service is covered per the illustrative plan-benefit shape. */
  covered: boolean;
  /**
   * The catalog of criteria that need to be MET for medical necessity to be
   * clean-approved. The engine reads evidence per-criterion from the request.
   */
  criteria: readonly UrCriterion[];
  synthetic: true;
};

/** A single medical-necessity criterion for a service type. */
export type UrCriterion = {
  id: string;
  label: string;
  /** Whether this is a required (must-meet) criterion or a supporting one. */
  required: boolean;
  synthetic: true;
};

/** The illustrative service-type catalog (five menopause-relevant services). */
export const UR_SERVICE_TYPES: UrServiceType[] = [
  {
    id: "service.dexa-bone-density",
    label: "DEXA bone-density scan",
    covered: true,
    criteria: [
      {
        id: "criterion.dexa.age-gate-or-risk",
        label: "Age ≥ 65 OR one documented osteoporosis risk factor",
        required: true,
        synthetic: true
      },
      {
        id: "criterion.dexa.interval-since-last",
        label: "≥ 24 months since last DEXA scan",
        required: true,
        synthetic: true
      },
      {
        id: "criterion.dexa.symptom-documentation",
        label: "Symptom / risk documented in chart",
        required: false,
        synthetic: true
      }
    ],
    synthetic: true
  },
  {
    id: "service.hysterectomy-abnormal-bleeding",
    label: "Hysterectomy for abnormal uterine bleeding",
    covered: true,
    criteria: [
      {
        id: "criterion.hyst.bleed-pattern-documented",
        label: "Bleeding pattern documented ≥ 6 months",
        required: true,
        synthetic: true
      },
      {
        id: "criterion.hyst.first-line-failed",
        label: "Documented failure of hormonal / IUD / ablation first-line",
        required: true,
        synthetic: true
      },
      {
        id: "criterion.hyst.malignancy-workup",
        label: "Endometrial biopsy negative for malignancy",
        required: true,
        synthetic: true
      }
    ],
    synthetic: true
  },
  {
    id: "service.inpatient-medical",
    label: "Inpatient medical admission",
    covered: true,
    criteria: [
      {
        id: "criterion.inpt.severity-of-illness",
        label: "Severity-of-illness threshold met (vitals / labs / clinical picture)",
        required: true,
        synthetic: true
      },
      {
        id: "criterion.inpt.intensity-of-service",
        label: "Intensity-of-service requirement (IV meds / monitoring / procedures)",
        required: true,
        synthetic: true
      },
      {
        id: "criterion.inpt.observation-insufficient",
        label: "Observation-level care insufficient for this admission",
        required: false,
        synthetic: true
      }
    ],
    synthetic: true
  },
  {
    id: "service.sleep-study-osa",
    label: "In-lab polysomnography for OSA workup",
    covered: true,
    criteria: [
      {
        id: "criterion.sleep.symptoms-documented",
        label: "Documented OSA symptoms (snoring, witnessed apneas, EDS)",
        required: true,
        synthetic: true
      },
      {
        id: "criterion.sleep.home-test-inappropriate",
        label: "Home sleep test inappropriate / prior HSAT non-diagnostic",
        required: true,
        synthetic: true
      }
    ],
    synthetic: true
  },
  {
    id: "service.cosmetic-non-covered",
    label: "Cosmetic procedure (illustrative non-covered service)",
    covered: false,
    criteria: [],
    synthetic: true
  }
];

const SERVICE_BY_ID = new Map<string, UrServiceType>(
  UR_SERVICE_TYPES.map((s) => [s.id, s])
);

const CRITERION_BY_ID = new Map<string, UrCriterion>(
  UR_SERVICE_TYPES.flatMap((s) => s.criteria.map((c) => [c.id, c] as const))
);

/** Is `id` a defined service-type catalog id? */
export function isUrServiceType(id: unknown): boolean {
  return typeof id === "string" && SERVICE_BY_ID.has(id);
}

/** Look up a service type (undefined for an off-catalog id). */
export function getUrServiceType(id: string): UrServiceType | undefined {
  return SERVICE_BY_ID.get(id);
}

/** Is `id` a defined criterion catalog id? */
export function isUrCriterion(id: unknown): boolean {
  return typeof id === "string" && CRITERION_BY_ID.has(id);
}

/** A UR rule the engine can apply. */
export type UrRule = {
  id: string;
  label: string;
  fires:
    | "approves-meets-criteria"
    | "pend-for-clinical-review"
    | "require-peer-to-peer"
    | "blocked-non-covered";
  rationale: string;
  synthetic: true;
};

/** The illustrative rule catalog. */
export const UR_RULES: UrRule[] = [
  {
    id: "rule.all-required-met",
    label: "All required criteria met — clean-approve",
    fires: "approves-meets-criteria",
    rationale:
      "All required medical-necessity criteria for this service type are documented — approve at first-pass review.",
    synthetic: true
  },
  {
    id: "rule.missing-required-criterion",
    label: "One or more required criteria not met — pend for clinical review",
    fires: "pend-for-clinical-review",
    rationale:
      "One or more required criteria are not documented — pend for a clinical reviewer (nurse or physician) to evaluate additional evidence.",
    synthetic: true
  },
  {
    id: "rule.partial-criteria-p2p",
    label: "Partial criteria — escalate to peer-to-peer",
    fires: "require-peer-to-peer",
    rationale:
      "At least one required criterion is met AND at least one is not, AND the requesting provider has flagged clinical judgment — escalate to peer-to-peer between the payer physician and the requesting physician.",
    synthetic: true
  },
  {
    id: "rule.non-covered-service",
    label: "Non-covered service — blocked at first-pass",
    fires: "blocked-non-covered",
    rationale:
      "The requested service is not on the covered-benefits catalog — blocked at first pass; member may pursue coverage appeal through the Grievance & Appeals agent.",
    synthetic: true
  },
  {
    id: "rule.sla-window-required",
    label: "SLA window applies per case-type / urgency",
    fires: "pend-for-clinical-review",
    rationale:
      "Every non-approved case must carry a catalog-sourced SLA deadline that traces to urgency + received date; a silently-extended deadline breaches CMS / state UR-agent timelines.",
    synthetic: true
  }
];

const RULE_BY_ID = new Map<string, UrRule>(UR_RULES.map((r) => [r.id, r]));

export function isUrRule(id: unknown): boolean {
  return typeof id === "string" && RULE_BY_ID.has(id);
}

export function getUrRule(id: string): UrRule | undefined {
  return RULE_BY_ID.get(id);
}

/** Reason codes for the decision. */
export const UR_REASON_CODES = [
  { id: "reason.UR-100", label: "UR-100 — Meets medical necessity (clean-approve)", synthetic: true },
  {
    id: "reason.UR-200",
    label: "UR-200 — Required criteria not met — pend for clinical review",
    synthetic: true
  },
  {
    id: "reason.UR-201",
    label: "UR-201 — Partial criteria — escalate to peer-to-peer",
    synthetic: true
  },
  {
    id: "reason.UR-300",
    label: "UR-300 — Non-covered service — blocked at first pass",
    synthetic: true
  }
] as const;

const REASON_BY_ID = new Map<string, (typeof UR_REASON_CODES)[number]>(
  UR_REASON_CODES.map((r) => [r.id, r])
);

export function isUrReasonCode(id: unknown): boolean {
  return typeof id === "string" && REASON_BY_ID.has(id);
}

/** Evidence a caller provides for one criterion. */
export type UrCriterionEvidence = {
  criterionId: string;
  /** Whether the criterion is met per the caller's documentation. */
  met: boolean;
};

/** Structured input the UR engine reads. */
export type UtilizationReviewRequest = {
  requestRef: string;
  memberRef: string;
  serviceTypeId: string;
  urgency: UrgencyLevel;
  /** ISO asOfDate accepted as data. */
  asOfDate: string;
  /** Per-criterion evidence flags. */
  criteriaEvidence: readonly UrCriterionEvidence[];
  /**
   * When true, the requesting provider is asking for peer-to-peer if
   * partial criteria are met (rather than a pend-review).
   */
  providerRequestsPeerToPeer?: boolean;
};

/** A single applied rule on the decision. */
export type AppliedUrRule = {
  ruleId: string;
  ruleLabel: string;
  reasonCode: string;
  reasonLabel: string;
  detail: string;
};

/** Decision tier. */
export type UrDecisionTier =
  | "approves-meets-criteria"
  | "pend-for-clinical-review"
  | "require-peer-to-peer"
  | "blocked-non-covered";

export type UrRoute =
  | "auto-approve"
  | "clinical-reviewer-queue"
  | "peer-to-peer-scheduling"
  | "blocked-non-covered-appeal";

/** The full decision. */
export type UtilizationReviewDecision = {
  requestRef: string;
  memberRef: string;
  serviceTypeId: string;
  serviceTypeLabel: string;
  urgency: UrgencyLevel;
  asOfDate: string;
  decision: UrDecisionTier;
  appliedRules: readonly AppliedUrRule[];
  criteriaMet: readonly string[];
  criteriaMissing: readonly string[];
  primaryReasonCode: string;
  primaryReasonLabel: string;
  routedTo: UrRoute;
  /** ISO deadline computed from asOfDate + SLA window hours. */
  slaDeadline: string;
  /** Window in hours drawn from UR_SLA_WINDOW_HOURS. */
  slaWindowHours: number;
  requiresClinicianCosign: boolean;
  /** Always false — the agent NEVER autonomously cosigns a denial. */
  cosigned: false;
  /** Always true — the catalog + refs are illustrative synthetics. */
  synthetic: true;
  note: string;
};

/** Decision severity for precedence — blocked > p2p > pend > approved. */
const DECISION_RANK: Record<UrDecisionTier, number> = {
  "approves-meets-criteria": 0,
  "pend-for-clinical-review": 1,
  "require-peer-to-peer": 2,
  "blocked-non-covered": 3
};

/**
 * Deterministically evaluate rules for a UR request. Sorted by rule-id
 * ascending.
 */
export function evaluateUrRules(req: UtilizationReviewRequest): readonly AppliedUrRule[] {
  const rules: AppliedUrRule[] = [];
  const service = getUrServiceType(req.serviceTypeId);

  // Non-covered — highest priority; short-circuits catalog evaluation.
  if (service && service.covered === false) {
    rules.push({
      ruleId: "rule.non-covered-service",
      ruleLabel: getUrRule("rule.non-covered-service")!.label,
      reasonCode: "reason.UR-300",
      reasonLabel: REASON_BY_ID.get("reason.UR-300")!.label,
      detail: `service ${service.label} is not on the covered-benefits catalog`
    });
    return [...rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  }

  if (!service) {
    // Off-catalog service — the fabric-level catalog check will pick this up.
    return rules;
  }

  const evidenceById = new Map<string, boolean>(
    req.criteriaEvidence.map((e) => [e.criterionId, e.met])
  );
  const required = service.criteria.filter((c) => c.required);
  const requiredMet = required.filter((c) => evidenceById.get(c.id) === true);
  const requiredMissing = required.filter((c) => evidenceById.get(c.id) !== true);

  if (requiredMissing.length === 0) {
    // All required met.
    rules.push({
      ruleId: "rule.all-required-met",
      ruleLabel: getUrRule("rule.all-required-met")!.label,
      reasonCode: "reason.UR-100",
      reasonLabel: REASON_BY_ID.get("reason.UR-100")!.label,
      detail: `all ${required.length} required criteria met for ${service.label}`
    });
  } else if (requiredMet.length > 0 && req.providerRequestsPeerToPeer === true) {
    // Partial + provider requests P2P.
    rules.push({
      ruleId: "rule.partial-criteria-p2p",
      ruleLabel: getUrRule("rule.partial-criteria-p2p")!.label,
      reasonCode: "reason.UR-201",
      reasonLabel: REASON_BY_ID.get("reason.UR-201")!.label,
      detail: `${requiredMet.length}/${required.length} required met, provider requested peer-to-peer`
    });
    rules.push({
      ruleId: "rule.sla-window-required",
      ruleLabel: getUrRule("rule.sla-window-required")!.label,
      reasonCode: "reason.UR-201",
      reasonLabel: REASON_BY_ID.get("reason.UR-201")!.label,
      detail: `SLA window ${UR_SLA_WINDOW_HOURS[req.urgency]}h for urgency ${req.urgency}`
    });
  } else {
    // Missing required — pend for clinical reviewer.
    rules.push({
      ruleId: "rule.missing-required-criterion",
      ruleLabel: getUrRule("rule.missing-required-criterion")!.label,
      reasonCode: "reason.UR-200",
      reasonLabel: REASON_BY_ID.get("reason.UR-200")!.label,
      detail: `${requiredMissing.length}/${required.length} required criteria missing evidence`
    });
    rules.push({
      ruleId: "rule.sla-window-required",
      ruleLabel: getUrRule("rule.sla-window-required")!.label,
      reasonCode: "reason.UR-200",
      reasonLabel: REASON_BY_ID.get("reason.UR-200")!.label,
      detail: `SLA window ${UR_SLA_WINDOW_HOURS[req.urgency]}h for urgency ${req.urgency}`
    });
  }

  return [...rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/** Summarize applied rules into a decision tier. */
export function summarizeUrDecision(rules: readonly AppliedUrRule[]): {
  decision: UrDecisionTier;
  primaryReasonCode: string;
  primaryReasonLabel: string;
  routedTo: UrRoute;
} {
  if (rules.length === 0) {
    return {
      decision: "approves-meets-criteria",
      primaryReasonCode: "reason.UR-100",
      primaryReasonLabel: REASON_BY_ID.get("reason.UR-100")!.label,
      routedTo: "auto-approve"
    };
  }
  let bestDecision: UrDecisionTier = "approves-meets-criteria";
  let bestReasonCode: string = "reason.UR-100";
  let bestReasonLabel: string = REASON_BY_ID.get("reason.UR-100")!.label;
  for (const r of rules) {
    const rule = getUrRule(r.ruleId);
    if (!rule) continue;
    if (DECISION_RANK[rule.fires] > DECISION_RANK[bestDecision]) {
      bestDecision = rule.fires;
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    } else if (
      bestDecision === "approves-meets-criteria" &&
      rule.fires === "approves-meets-criteria"
    ) {
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    }
  }
  const routedTo: UrRoute =
    bestDecision === "blocked-non-covered"
      ? "blocked-non-covered-appeal"
      : bestDecision === "require-peer-to-peer"
      ? "peer-to-peer-scheduling"
      : bestDecision === "pend-for-clinical-review"
      ? "clinical-reviewer-queue"
      : "auto-approve";
  return {
    decision: bestDecision,
    primaryReasonCode: bestReasonCode,
    primaryReasonLabel: bestReasonLabel,
    routedTo
  };
}

/** Compute the SLA deadline ISO from an asOfDate + urgency (deterministic). */
export function computeSlaDeadline(asOfDate: string, urgency: UrgencyLevel): string {
  const base = new Date(asOfDate);
  const hours = UR_SLA_WINDOW_HOURS[urgency];
  base.setUTCHours(base.getUTCHours() + hours);
  return base.toISOString();
}

/** Deterministically produce the UR decision. */
export function reviewUtilization(
  req: UtilizationReviewRequest
): UtilizationReviewDecision {
  const service = getUrServiceType(req.serviceTypeId);
  const rules = evaluateUrRules(req);
  const { decision, primaryReasonCode, primaryReasonLabel, routedTo } =
    summarizeUrDecision(rules);
  const requiresClinicianCosign = decision !== "approves-meets-criteria";

  const evidenceById = new Map<string, boolean>(
    req.criteriaEvidence.map((e) => [e.criterionId, e.met])
  );
  const criteriaMet: string[] = [];
  const criteriaMissing: string[] = [];
  if (service) {
    for (const c of service.criteria) {
      if (evidenceById.get(c.id) === true) criteriaMet.push(c.id);
      else if (c.required) criteriaMissing.push(c.id);
    }
  }

  const slaWindowHours = UR_SLA_WINDOW_HOURS[req.urgency];
  const slaDeadline = computeSlaDeadline(req.asOfDate, req.urgency);

  const note =
    decision === "approves-meets-criteria"
      ? `Clean-approved: ${service?.label ?? req.serviceTypeId} — all required criteria met at first pass.`
      : `${decision} for ${service?.label ?? req.serviceTypeId}: ${rules.length} rule${rules.length === 1 ? "" : "s"} fired, primary reason ${primaryReasonCode}. Routed to ${routedTo} with SLA ${slaWindowHours}h. ` +
        (decision === "blocked-non-covered"
          ? "BLOCKED — service not on covered-benefits catalog. Member may appeal through the Grievance & Appeals agent."
          : "DRAFTED for clinician cosign — the agent NEVER autonomously denies a UR case; denial letters are legally consequential.");

  return {
    requestRef: req.requestRef,
    memberRef: req.memberRef,
    serviceTypeId: req.serviceTypeId,
    serviceTypeLabel: service?.label ?? "(off-catalog)",
    urgency: req.urgency,
    asOfDate: req.asOfDate,
    decision,
    appliedRules: rules,
    criteriaMet,
    criteriaMissing,
    primaryReasonCode,
    primaryReasonLabel,
    routedTo,
    slaDeadline,
    slaWindowHours,
    requiresClinicianCosign,
    cosigned: false,
    synthetic: true,
    note
  };
}

/** Criteria-catalog check. True when service + criteria + rule + reason ids are all catalog-sourced. */
export function criteriaTraceToCatalog(
  input:
    | {
        serviceTypeId?: string;
        criteriaMet?: readonly string[];
        criteriaMissing?: readonly string[];
        appliedRules?: ReadonlyArray<{ ruleId?: string; reasonCode?: string }>;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  if (!isUrServiceType(input.serviceTypeId)) return false;
  const met = input.criteriaMet ?? [];
  const missing = input.criteriaMissing ?? [];
  if (!Array.isArray(met) || !Array.isArray(missing)) return false;
  // Every referenced criterion id must be catalog-sourced (or empty).
  if (!met.every((id) => isUrCriterion(id))) return false;
  if (!missing.every((id) => isUrCriterion(id))) return false;
  const rules = input.appliedRules ?? [];
  if (!Array.isArray(rules)) return false;
  return rules.every(
    (r) => isUrRule(r.ruleId) && isUrReasonCode(r.reasonCode)
  );
}

/** Clinician-cosign check. True when non-approved decision is properly gated. */
export function denialRequiresClinicianCosign(
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
  if (decision.decision === "approves-meets-criteria") return true;
  if (decision.requiresClinicianCosign !== true) return false;
  if (decision.cosigned === true) return false;
  return true;
}

/** SLA-integrity check. True when the deadline traces to catalog urgency + received date. */
export function slaTracesToCatalog(
  input:
    | {
        urgency?: string;
        asOfDate?: string;
        slaWindowHours?: number;
        slaDeadline?: string;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  if (!isUrgencyLevel(input.urgency)) return false;
  const expectedHours = UR_SLA_WINDOW_HOURS[input.urgency];
  if (input.slaWindowHours !== expectedHours) return false;
  if (typeof input.asOfDate !== "string" || typeof input.slaDeadline !== "string") {
    return false;
  }
  const expectedIso = computeSlaDeadline(input.asOfDate, input.urgency);
  return input.slaDeadline === expectedIso;
}

// Illustrative demo requests.

export const DEMO_UR_APPROVE: UtilizationReviewRequest = {
  requestRef: "ur-req-2026-07-001",
  memberRef: "member-001",
  serviceTypeId: "service.dexa-bone-density",
  urgency: "standard",
  asOfDate: "2026-07-05T14:00:00.000Z",
  criteriaEvidence: [
    { criterionId: "criterion.dexa.age-gate-or-risk", met: true },
    { criterionId: "criterion.dexa.interval-since-last", met: true },
    { criterionId: "criterion.dexa.symptom-documentation", met: true }
  ]
};

export const DEMO_UR_PEND: UtilizationReviewRequest = {
  requestRef: "ur-req-2026-07-002",
  memberRef: "member-002",
  serviceTypeId: "service.hysterectomy-abnormal-bleeding",
  urgency: "standard",
  asOfDate: "2026-07-05T14:00:00.000Z",
  criteriaEvidence: [
    { criterionId: "criterion.hyst.bleed-pattern-documented", met: true },
    { criterionId: "criterion.hyst.first-line-failed", met: false },
    { criterionId: "criterion.hyst.malignancy-workup", met: true }
  ]
};

export const DEMO_UR_P2P: UtilizationReviewRequest = {
  requestRef: "ur-req-2026-07-003",
  memberRef: "member-003",
  serviceTypeId: "service.inpatient-medical",
  urgency: "urgent",
  asOfDate: "2026-07-05T14:00:00.000Z",
  criteriaEvidence: [
    { criterionId: "criterion.inpt.severity-of-illness", met: true },
    { criterionId: "criterion.inpt.intensity-of-service", met: false }
  ],
  providerRequestsPeerToPeer: true
};

export const DEMO_UR_NON_COVERED: UtilizationReviewRequest = {
  requestRef: "ur-req-2026-07-004",
  memberRef: "member-004",
  serviceTypeId: "service.cosmetic-non-covered",
  urgency: "standard",
  asOfDate: "2026-07-05T14:00:00.000Z",
  criteriaEvidence: []
};

export const DEMO_UR_URGENT_PEND: UtilizationReviewRequest = {
  requestRef: "ur-req-2026-07-005",
  memberRef: "member-005",
  serviceTypeId: "service.sleep-study-osa",
  urgency: "urgent",
  asOfDate: "2026-07-05T14:00:00.000Z",
  criteriaEvidence: [
    { criterionId: "criterion.sleep.symptoms-documented", met: true },
    { criterionId: "criterion.sleep.home-test-inappropriate", met: false }
  ]
};
