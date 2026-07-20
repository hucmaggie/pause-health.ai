/**
 * Clinical Trial Payments & Stipends — deterministic participant stipend
 * computation against IRB-approved payment schedules, with study-coordinator
 * cosign for any non-standard payment.
 *
 * Deterministic, dependency-free domain core the Trial Payments & Stipends
 * Agent (app/api/agents/trial-payments) wraps — the Salesforce "Agentforce
 * for Health" / Health Cloud clinical-trial payments analog on Pause's
 * Agent Fabric. Pairs with the Clinical Trials Matching agent (which
 * selects candidates): this one handles the reimbursable/regulated
 * PAYMENTS side. For each visit in an active menopause trial, it looks up
 * the IRB-approved compensation schedule, verifies the participant has
 * research-payment consent on file, computes the stipend + travel
 * reimbursement per visit type (screening / treatment / follow-up / safety
 * / early-termination), and routes non-standard payments (missed visit,
 * out-of-range travel, extra procedure) to the study coordinator for
 * cosign. It NEVER autonomously deviates from an IRB-approved schedule.
 *
 *   Inbound:  TrialPaymentRequest (a synthetic participantRef + trialRef —
 *             clearly labeled illustrative — visit type, visit outcome,
 *             travel-miles-round-trip, consent flags, requested amounts,
 *             ISO asOfDate accepted as data)
 *   Outbound: TrialPaymentDecision { requestRef, decision: 'schedule-
 *             approved' | 'pend-coordinator-review' | 'blocked-no-consent',
 *             stipendAmountCents, travelReimbursementCents, appliedRules[],
 *             primaryReasonCode, routedTo, requiresCoordinatorCosign,
 *             cosigned:false, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: payments trace to the schedule catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every payment must cite a trial and visit type from the defined
 *  TRIAL_PAYMENT_SCHEDULES catalog (menopause vasomotor, HRT dosing, bone
 *  density, etc.), and applied rules from the schedule-rules catalog. An
 *  ad-hoc "we-decided-to-pay-more-because" payment fails. paymentsTraceToCatalog()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.trial-payments.schedule-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no autonomous IRB deviation.
 * ─────────────────────────────────────────────────────────────────────
 *  The IRB has approved a specific payment schedule and rules. Deviations
 *  (missed visits with partial payment, out-of-range travel, extra
 *  procedure compensation) require study-coordinator cosign — an
 *  autonomous deviation is a research-ethics failure and could invalidate
 *  the study. Every non-schedule-approved decision is
 *  requiresCoordinatorCosign:true / cosigned:false; a caller-asserted
 *  plan that claims cosigned:true or bypasses the cosign gate is a
 *  violation. Mirrors the Claims Adjudication Agent's no-autonomous-
 *  denial, the Formulary Agent's no-autonomous-override, and the FWA
 *  Agent's no-autonomous-denial posture. deviationRequiresCoordinatorCosign()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.trial-payments.no-autonomous-irb-deviation.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: participant informed-consent required.
 * ─────────────────────────────────────────────────────────────────────
 *  No payment may be issued to a participant whose informed-consent for
 *  research-payment scope is not on file (or has been withdrawn). This
 *  is a Common Rule / 45 CFR 46 requirement — payments issued to
 *  non-consented participants are a serious research-ethics violation.
 *  paymentHasParticipantConsent() reports the honest signal the Agent
 *  Fabric enforces via policy.trial-payments.participant-consented.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified trial payments engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The trial catalog, IRB payment schedules, visit types, and travel rate
 *  below are ILLUSTRATIVE synthetic/demo values that model the SHAPE of a
 *  trial-payments workflow — they are NOT IRBNet, WCG IRB, Advarra IRB,
 *  or an actual sponsor's payment protocol. The participantRefs, trialRefs,
 *  and amounts are synthetic / de-identified. There is NO randomness and
 *  NO clock anywhere here: payment computation is a pure function of the
 *  request + schedule catalog + caller-provided asOfDate.
 */

/** A single visit type in the illustrative catalog. */
export type TrialVisitType = {
  id: string;
  label: string;
  /** Illustrative stipend for a completed visit of this type (in cents). */
  standardStipendCents: number;
  /**
   * Whether missed-visit partial compensation is allowed by default for
   * this type (illustrative — real schedules vary).
   */
  allowsMissedVisitCompensation: boolean;
  synthetic: true;
};

/** The illustrative trial visit-type catalog. */
export const TRIAL_VISIT_TYPES: TrialVisitType[] = [
  {
    id: "visit.screening",
    label: "Screening visit",
    standardStipendCents: 10000, // $100.00
    allowsMissedVisitCompensation: false,
    synthetic: true
  },
  {
    id: "visit.treatment",
    label: "Treatment / dosing visit",
    standardStipendCents: 15000, // $150.00
    allowsMissedVisitCompensation: true,
    synthetic: true
  },
  {
    id: "visit.follow-up",
    label: "Follow-up assessment visit",
    standardStipendCents: 10000, // $100.00
    allowsMissedVisitCompensation: true,
    synthetic: true
  },
  {
    id: "visit.safety-labs",
    label: "Safety labs visit",
    standardStipendCents: 5000, // $50.00
    allowsMissedVisitCompensation: false,
    synthetic: true
  },
  {
    id: "visit.early-termination",
    label: "Early-termination visit",
    standardStipendCents: 15000, // $150.00
    allowsMissedVisitCompensation: false,
    synthetic: true
  }
];

const VISIT_TYPE_BY_ID = new Map<string, TrialVisitType>(
  TRIAL_VISIT_TYPES.map((v) => [v.id, v])
);

/** Is `id` a defined visit-type catalog id? */
export function isTrialVisitType(id: unknown): boolean {
  return typeof id === "string" && VISIT_TYPE_BY_ID.has(id);
}

/** Look up a visit type (undefined for an off-catalog id). */
export function getTrialVisitType(id: string): TrialVisitType | undefined {
  return VISIT_TYPE_BY_ID.get(id);
}

/** An IRB-approved payment schedule for a specific trial. */
export type TrialPaymentSchedule = {
  /** Stable trial catalog id. */
  trialId: string;
  /** Trial label (illustrative). */
  trialLabel: string;
  /** Sponsor label (illustrative). */
  sponsorLabel: string;
  /** IRB approval identifier (illustrative — never a real IRB number). */
  irbApprovalRef: string;
  /**
   * Travel reimbursement rate in cents per mile (illustrative — real IRS
   * medical mileage rate is 21¢/mile 2024).
   */
  travelReimbursementCentsPerMile: number;
  /** Max reimbursable miles per visit (round-trip). */
  maxReimbursableMiles: number;
  /**
   * Per-visit stipend overrides (rare — most trials use the visit-type
   * defaults). Illustrative.
   */
  visitStipendOverridesCents?: Partial<Record<string, number>>;
  synthetic: true;
};

/** The illustrative trial payment schedules catalog. */
export const TRIAL_PAYMENT_SCHEDULES: TrialPaymentSchedule[] = [
  {
    trialId: "trial.mn-vasomotor-fezolinetant-p3",
    trialLabel: "Menopause Vasomotor Symptoms — Fezolinetant Phase 3",
    sponsorLabel: "Illustrative Sponsor Inc.",
    irbApprovalRef: "irb-2026-001",
    travelReimbursementCentsPerMile: 21,
    maxReimbursableMiles: 100,
    synthetic: true
  },
  {
    trialId: "trial.mn-hrt-transdermal-p4",
    trialLabel: "Menopause HRT — Transdermal Estradiol Phase 4 Observational",
    sponsorLabel: "Illustrative Sponsor Inc.",
    irbApprovalRef: "irb-2026-002",
    travelReimbursementCentsPerMile: 21,
    maxReimbursableMiles: 60,
    // Follow-up visits pay slightly more in this trial (illustrative).
    visitStipendOverridesCents: {
      "visit.follow-up": 12500
    },
    synthetic: true
  },
  {
    trialId: "trial.mn-bone-density-p3",
    trialLabel: "Menopause Bone Density — Bisphosphonate Phase 3",
    sponsorLabel: "Illustrative Sponsor Inc.",
    irbApprovalRef: "irb-2026-003",
    travelReimbursementCentsPerMile: 21,
    maxReimbursableMiles: 120,
    synthetic: true
  }
];

const SCHEDULE_BY_TRIAL = new Map<string, TrialPaymentSchedule>(
  TRIAL_PAYMENT_SCHEDULES.map((s) => [s.trialId, s])
);

/** Is `id` a defined trial catalog id? */
export function isTrialSchedule(id: unknown): boolean {
  return typeof id === "string" && SCHEDULE_BY_TRIAL.has(id);
}

/** Look up a schedule (undefined for an off-catalog trial). */
export function getTrialSchedule(id: string): TrialPaymentSchedule | undefined {
  return SCHEDULE_BY_TRIAL.get(id);
}

/** A trial-payment rule the engine can apply. */
export type TrialPaymentRule = {
  id: string;
  label: string;
  fires: "schedule-approved" | "pend-coordinator-review" | "blocked-no-consent";
  rationale: string;
  synthetic: true;
};

/** The illustrative rule catalog. */
export const TRIAL_PAYMENT_RULES: TrialPaymentRule[] = [
  {
    id: "rule.standard-visit-completed",
    label: "Standard completed visit — schedule stipend applies",
    fires: "schedule-approved",
    rationale:
      "Participant completed a scheduled visit — the IRB-approved stipend applies.",
    synthetic: true
  },
  {
    id: "rule.missed-visit-partial-comp",
    label: "Missed visit — partial compensation (per schedule allowance)",
    fires: "pend-coordinator-review",
    rationale:
      "Visit was missed; the visit type may allow partial compensation per the IRB schedule — pend for study coordinator to review whether partial payment applies.",
    synthetic: true
  },
  {
    id: "rule.travel-out-of-range",
    label: "Travel exceeds schedule maxReimbursableMiles",
    fires: "pend-coordinator-review",
    rationale:
      "Travel round-trip exceeds the IRB-approved maxReimbursableMiles — pend for coordinator review or protocol amendment.",
    synthetic: true
  },
  {
    id: "rule.extra-procedure-comp",
    label: "Extra procedure requested for compensation",
    fires: "pend-coordinator-review",
    rationale:
      "Participant is requesting compensation for a procedure outside the IRB-approved schedule — pend for coordinator review.",
    synthetic: true
  },
  {
    id: "rule.consent-missing",
    label: "Research-payment consent not on file",
    fires: "blocked-no-consent",
    rationale:
      "Participant has no research-payment consent on file (or has withdrawn); no payment may be issued — Common Rule / 45 CFR 46 requirement.",
    synthetic: true
  }
];

const RULE_BY_ID = new Map<string, TrialPaymentRule>(
  TRIAL_PAYMENT_RULES.map((r) => [r.id, r])
);

/** Is `id` a defined rule catalog id? */
export function isTrialPaymentRule(id: unknown): boolean {
  return typeof id === "string" && RULE_BY_ID.has(id);
}

/** Look up a rule (undefined for an off-catalog id). */
export function getTrialPaymentRule(id: string): TrialPaymentRule | undefined {
  return RULE_BY_ID.get(id);
}

/** Reason codes for the decision. */
export const TRIAL_PAYMENT_REASON_CODES = [
  {
    id: "reason.TP-100",
    label: "TP-100 — Standard IRB schedule payment approved",
    synthetic: true
  },
  {
    id: "reason.TP-200",
    label: "TP-200 — Missed visit — pend for coordinator review",
    synthetic: true
  },
  {
    id: "reason.TP-201",
    label: "TP-201 — Travel out of schedule range — pend for coordinator review",
    synthetic: true
  },
  {
    id: "reason.TP-202",
    label: "TP-202 — Extra procedure comp — pend for coordinator review",
    synthetic: true
  },
  {
    id: "reason.TP-300",
    label: "TP-300 — No research-payment consent on file — blocked",
    synthetic: true
  }
] as const;

const REASON_BY_ID = new Map<string, (typeof TRIAL_PAYMENT_REASON_CODES)[number]>(
  TRIAL_PAYMENT_REASON_CODES.map((r) => [r.id, r])
);

/** Is `id` a defined trial-payment reason code? */
export function isTrialPaymentReasonCode(id: unknown): boolean {
  return typeof id === "string" && REASON_BY_ID.has(id);
}

/** The visit outcome. */
export type VisitOutcome = "completed" | "missed" | "partial";

/** Structured input the payment engine reads. */
export type TrialPaymentRequest = {
  requestRef: string;
  participantRef: string;
  trialId: string;
  visitTypeId: string;
  visitOutcome: VisitOutcome;
  /** ISO asOfDate accepted as data. */
  asOfDate: string;
  /** Round-trip travel miles (0 for a telehealth visit). */
  travelMilesRoundTrip: number;
  /** Whether research-payment informed consent is on file for this participant. */
  hasResearchPaymentConsent: boolean;
  /**
   * Whether the request includes an extra-procedure compensation ask
   * outside the IRB schedule.
   */
  requestsExtraProcedureCompensation?: boolean;
};

/** A single applied rule. */
export type AppliedPaymentRule = {
  ruleId: string;
  ruleLabel: string;
  reasonCode: string;
  reasonLabel: string;
  detail: string;
};

/** The decision tier. */
export type TrialPaymentDecisionTier =
  | "schedule-approved"
  | "pend-coordinator-review"
  | "blocked-no-consent";

export type TrialPaymentRoute =
  | "schedule-auto-pay"
  | "study-coordinator-review"
  | "blocked-hold";

/** The full decision. */
export type TrialPaymentDecision = {
  requestRef: string;
  participantRef: string;
  trialId: string;
  trialLabel: string;
  visitTypeId: string;
  visitTypeLabel: string;
  asOfDate: string;
  decision: TrialPaymentDecisionTier;
  stipendAmountCents: number;
  travelReimbursementCents: number;
  appliedRules: readonly AppliedPaymentRule[];
  primaryReasonCode: string;
  primaryReasonLabel: string;
  routedTo: TrialPaymentRoute;
  requiresCoordinatorCosign: boolean;
  /** Always false — the agent NEVER autonomously cosigns a deviation. */
  cosigned: false;
  /** Always true — the catalog + refs are illustrative synthetics. */
  synthetic: true;
  note: string;
};

/** Decision severity for precedence — blocked > pend > approved. */
const DECISION_RANK: Record<TrialPaymentDecisionTier, number> = {
  "schedule-approved": 0,
  "pend-coordinator-review": 1,
  "blocked-no-consent": 2
};

/**
 * Deterministically evaluate rules for a payment request. Sorted by
 * rule-id ascending.
 */
export function evaluateTrialPaymentRules(
  req: TrialPaymentRequest
): readonly AppliedPaymentRule[] {
  const rules: AppliedPaymentRule[] = [];

  // Consent-missing is highest priority.
  if (req.hasResearchPaymentConsent !== true) {
    rules.push({
      ruleId: "rule.consent-missing",
      ruleLabel: getTrialPaymentRule("rule.consent-missing")!.label,
      reasonCode: "reason.TP-300",
      reasonLabel: REASON_BY_ID.get("reason.TP-300")!.label,
      detail: "participant has no research-payment consent on file"
    });
  }

  const schedule = getTrialSchedule(req.trialId);
  if (!schedule) return rules; // catalog check enforced separately

  // Missed visit.
  if (req.visitOutcome === "missed" || req.visitOutcome === "partial") {
    rules.push({
      ruleId: "rule.missed-visit-partial-comp",
      ruleLabel: getTrialPaymentRule("rule.missed-visit-partial-comp")!.label,
      reasonCode: "reason.TP-200",
      reasonLabel: REASON_BY_ID.get("reason.TP-200")!.label,
      detail: `visit outcome ${req.visitOutcome} — pend for coordinator to determine partial compensation`
    });
  }

  // Travel out of range.
  if (req.travelMilesRoundTrip > schedule.maxReimbursableMiles) {
    rules.push({
      ruleId: "rule.travel-out-of-range",
      ruleLabel: getTrialPaymentRule("rule.travel-out-of-range")!.label,
      reasonCode: "reason.TP-201",
      reasonLabel: REASON_BY_ID.get("reason.TP-201")!.label,
      detail: `travel ${req.travelMilesRoundTrip} miles > IRB max ${schedule.maxReimbursableMiles}`
    });
  }

  // Extra procedure requested.
  if (req.requestsExtraProcedureCompensation === true) {
    rules.push({
      ruleId: "rule.extra-procedure-comp",
      ruleLabel: getTrialPaymentRule("rule.extra-procedure-comp")!.label,
      reasonCode: "reason.TP-202",
      reasonLabel: REASON_BY_ID.get("reason.TP-202")!.label,
      detail: "participant requested compensation for a procedure outside the IRB schedule"
    });
  }

  // If nothing else fired and the visit is completed with catalog visit type
  // and consent is present, mark a standard-visit rule.
  const consentOk = req.hasResearchPaymentConsent === true;
  const visit = getTrialVisitType(req.visitTypeId);
  if (
    rules.length === 0 &&
    consentOk &&
    visit &&
    req.visitOutcome === "completed"
  ) {
    rules.push({
      ruleId: "rule.standard-visit-completed",
      ruleLabel: getTrialPaymentRule("rule.standard-visit-completed")!.label,
      reasonCode: "reason.TP-100",
      reasonLabel: REASON_BY_ID.get("reason.TP-100")!.label,
      detail: `standard ${visit.label} completed — IRB schedule applies`
    });
  }

  return [...rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/** Summarize into a decision tier. */
export function summarizeTrialPaymentDecision(
  rules: readonly AppliedPaymentRule[]
): { decision: TrialPaymentDecisionTier; primaryReasonCode: string; primaryReasonLabel: string; routedTo: TrialPaymentRoute } {
  if (rules.length === 0) {
    return {
      decision: "schedule-approved",
      primaryReasonCode: "reason.TP-100",
      primaryReasonLabel: REASON_BY_ID.get("reason.TP-100")!.label,
      routedTo: "schedule-auto-pay"
    };
  }
  let bestDecision: TrialPaymentDecisionTier = "schedule-approved";
  let bestReasonCode: string = "reason.TP-100";
  let bestReasonLabel: string = REASON_BY_ID.get("reason.TP-100")!.label;
  for (const r of rules) {
    const rule = getTrialPaymentRule(r.ruleId)!;
    if (DECISION_RANK[rule.fires] > DECISION_RANK[bestDecision]) {
      bestDecision = rule.fires;
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    } else if (bestDecision === "schedule-approved" && rule.fires === "schedule-approved") {
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    }
  }
  const routedTo: TrialPaymentRoute =
    bestDecision === "blocked-no-consent"
      ? "blocked-hold"
      : bestDecision === "pend-coordinator-review"
      ? "study-coordinator-review"
      : "schedule-auto-pay";
  return {
    decision: bestDecision,
    primaryReasonCode: bestReasonCode,
    primaryReasonLabel: bestReasonLabel,
    routedTo
  };
}

/** Compute the IRB-approved stipend + travel reimbursement for a request. */
export function computePayment(
  req: TrialPaymentRequest
): { stipendAmountCents: number; travelReimbursementCents: number } {
  const schedule = getTrialSchedule(req.trialId);
  const visit = getTrialVisitType(req.visitTypeId);
  if (!schedule || !visit) {
    return { stipendAmountCents: 0, travelReimbursementCents: 0 };
  }
  // No payment when consent is missing or outcome is missed.
  const consentOk = req.hasResearchPaymentConsent === true;
  const completed = req.visitOutcome === "completed";
  if (!consentOk || !completed) {
    return { stipendAmountCents: 0, travelReimbursementCents: 0 };
  }
  const override = schedule.visitStipendOverridesCents?.[visit.id];
  const stipendAmountCents = override ?? visit.standardStipendCents;
  const eligibleMiles = Math.min(
    Math.max(0, req.travelMilesRoundTrip),
    schedule.maxReimbursableMiles
  );
  const travelReimbursementCents =
    Math.round(eligibleMiles * schedule.travelReimbursementCentsPerMile);
  return { stipendAmountCents, travelReimbursementCents };
}

/** Deterministically produce the payment decision. */
export function evaluatePayment(req: TrialPaymentRequest): TrialPaymentDecision {
  const schedule = getTrialSchedule(req.trialId);
  const visit = getTrialVisitType(req.visitTypeId);
  const rules = evaluateTrialPaymentRules(req);
  const { decision, primaryReasonCode, primaryReasonLabel, routedTo } =
    summarizeTrialPaymentDecision(rules);
  const requiresCoordinatorCosign = decision !== "schedule-approved";

  // Compute amounts — only auto-pay if schedule-approved, else 0 (coord
  // decides the exact amount).
  const { stipendAmountCents, travelReimbursementCents } =
    decision === "schedule-approved" ? computePayment(req) : { stipendAmountCents: 0, travelReimbursementCents: 0 };

  const note =
    decision === "schedule-approved"
      ? `Schedule-approved: ${visit?.label ?? req.visitTypeId} for ${schedule?.trialLabel ?? req.trialId} — auto-pay per IRB schedule.`
      : `${decision} for ${visit?.label ?? req.visitTypeId} on ${schedule?.trialLabel ?? req.trialId}: ${rules.length} rule${rules.length === 1 ? "" : "s"} fired, primary reason ${primaryReasonCode}. Routed to ${routedTo}. ` +
        (decision === "blocked-no-consent"
          ? "BLOCKED — no research-payment consent on file (45 CFR 46)."
          : "DRAFTED for study-coordinator cosign — the agent NEVER autonomously deviates from the IRB-approved schedule.");

  return {
    requestRef: req.requestRef,
    participantRef: req.participantRef,
    trialId: req.trialId,
    trialLabel: schedule?.trialLabel ?? "(off-catalog)",
    visitTypeId: req.visitTypeId,
    visitTypeLabel: visit?.label ?? "(off-catalog)",
    asOfDate: req.asOfDate,
    decision,
    stipendAmountCents,
    travelReimbursementCents,
    appliedRules: rules,
    primaryReasonCode,
    primaryReasonLabel,
    routedTo,
    requiresCoordinatorCosign,
    cosigned: false,
    synthetic: true,
    note
  };
}

/** Schedule-catalog check. True when trial + visit type + rule ids are all catalog-sourced. */
export function paymentsTraceToCatalog(
  input:
    | {
        trialId?: string;
        visitTypeId?: string;
        appliedRules?: ReadonlyArray<{ ruleId?: string; reasonCode?: string }>;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  if (!isTrialSchedule(input.trialId)) return false;
  if (!isTrialVisitType(input.visitTypeId)) return false;
  const rules = input.appliedRules ?? [];
  if (!Array.isArray(rules)) return false;
  return rules.every(
    (r) => isTrialPaymentRule(r.ruleId) && isTrialPaymentReasonCode(r.reasonCode)
  );
}

/** Coordinator-cosign check. True when non-approved decision is properly gated. */
export function deviationRequiresCoordinatorCosign(
  decision:
    | {
        decision?: string;
        requiresCoordinatorCosign?: boolean;
        cosigned?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.decision === "schedule-approved") return true;
  if (decision.requiresCoordinatorCosign !== true) return false;
  if (decision.cosigned === true) return false;
  return true;
}

/** Consent check. True when consent is on file OR the decision is blocked-no-consent (safe path). */
export function paymentHasParticipantConsent(
  input:
    | {
        decision?: string;
        hasResearchPaymentConsent?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  // A blocked-no-consent decision is the SAFE ANSWER when consent is missing,
  // so it satisfies the invariant (the agent refused to pay).
  if (input.decision === "blocked-no-consent") return true;
  // Otherwise consent must be present.
  return input.hasResearchPaymentConsent === true;
}

// Illustrative demo requests.

export const DEMO_STANDARD_PAYMENT: TrialPaymentRequest = {
  requestRef: "tp-req-2026-07-001",
  participantRef: "participant-001",
  trialId: "trial.mn-vasomotor-fezolinetant-p3",
  visitTypeId: "visit.treatment",
  visitOutcome: "completed",
  asOfDate: "2026-07-05",
  travelMilesRoundTrip: 40,
  hasResearchPaymentConsent: true
};

export const DEMO_MISSED_VISIT: TrialPaymentRequest = {
  requestRef: "tp-req-2026-07-002",
  participantRef: "participant-002",
  trialId: "trial.mn-vasomotor-fezolinetant-p3",
  visitTypeId: "visit.follow-up",
  visitOutcome: "missed",
  asOfDate: "2026-07-05",
  travelMilesRoundTrip: 0,
  hasResearchPaymentConsent: true
};

export const DEMO_TRAVEL_OUT_OF_RANGE: TrialPaymentRequest = {
  requestRef: "tp-req-2026-07-003",
  participantRef: "participant-003",
  trialId: "trial.mn-hrt-transdermal-p4",
  visitTypeId: "visit.treatment",
  visitOutcome: "completed",
  asOfDate: "2026-07-05",
  travelMilesRoundTrip: 90, // > 60 max for this trial
  hasResearchPaymentConsent: true
};

export const DEMO_EXTRA_PROCEDURE: TrialPaymentRequest = {
  requestRef: "tp-req-2026-07-004",
  participantRef: "participant-004",
  trialId: "trial.mn-bone-density-p3",
  visitTypeId: "visit.safety-labs",
  visitOutcome: "completed",
  asOfDate: "2026-07-05",
  travelMilesRoundTrip: 30,
  hasResearchPaymentConsent: true,
  requestsExtraProcedureCompensation: true
};

export const DEMO_NO_CONSENT: TrialPaymentRequest = {
  requestRef: "tp-req-2026-07-005",
  participantRef: "participant-005",
  trialId: "trial.mn-vasomotor-fezolinetant-p3",
  visitTypeId: "visit.treatment",
  visitOutcome: "completed",
  asOfDate: "2026-07-05",
  travelMilesRoundTrip: 40,
  hasResearchPaymentConsent: false
};
