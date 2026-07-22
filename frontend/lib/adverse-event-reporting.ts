/**
 * Adverse Event Reporting (FDA MedWatch / VAERS analog) — deterministic
 * classification of adverse drug events, vaccine reactions, and device
 * malfunctions, with reporter-identity verification and regulatory-team
 * cosign for any FDA submission.
 *
 * Deterministic, dependency-free domain core the Adverse Event Reporting
 * Agent (app/api/agents/adverse-event-reporting) wraps — the Salesforce
 * "Agentforce for Health" / Health Cloud pharmacovigilance / device-
 * safety-reporting analog on Pause's Agent Fabric. For each reported
 * event it classifies the event type (drug ADR, vaccine reaction, device
 * malfunction), assigns a seriousness tier (non-serious / serious /
 * life-threatening / death) from the FDA-analog criteria, verifies the
 * reporter identity (clinician / patient / manufacturer / consumer),
 * and drafts a MedWatch (3500 / 3500A) or VAERS submission. The agent
 * NEVER autonomously files to the FDA — every submission is DRAFTED for
 * a regulatory-team cosign.
 *
 *   Inbound:  AdverseEventRequest (a synthetic patientRef + eventType +
 *             seriousness input flags + reporterType + reporter identity
 *             attested flag + ISO onsetDate / reportedDate)
 *   Outbound: AdverseEventDecision { requestRef, decision: 'draft-medwatch' |
 *             'draft-vaers' | 'blocked-non-catalog-event' |
 *             'blocked-reporter-unverified', appliedRules[], seriousnessTier,
 *             primaryReasonCode, routedTo, requiresRegulatoryTeamCosign,
 *             cosigned:false, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: event types + seriousness trace to catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every classified event must cite an event type from the defined
 *  ADVERSE_EVENT_TYPES catalog (drug ADR, vaccine reaction, device
 *  malfunction) AND a seriousness tier from the defined SERIOUSNESS_TIERS
 *  catalog (non-serious / serious / life-threatening / death, matching
 *  the FDA 21 CFR 314.80 seriousness criteria) — an ad-hoc / off-catalog
 *  event or a made-up severity level fails. eventsTraceToCatalog()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.adverse-event.event-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no autonomous FDA submission.
 * ─────────────────────────────────────────────────────────────────────
 *  An FDA submission (MedWatch 3500 / 3500A, VAERS) is legally
 *  consequential under 21 CFR 314.80 (mandatory reporting) and
 *  associated with sponsor / manufacturer / clinician liability. Every
 *  draft-medwatch or draft-vaers decision is requiresRegulatoryTeamCosign
 *  :true / cosigned:false; a caller-asserted plan that claims cosigned:
 *  true or bypasses the cosign gate is a violation. Mirrors the Claims
 *  Adjudication Agent's no-autonomous-denial, the UR Agent's no-
 *  autonomous-denial, the Trial Payments Agent's no-autonomous-irb-
 *  deviation, and the HEDIS Agent's no-autonomous-submission posture.
 *  submissionRequiresRegulatoryTeamCosign() reports the honest signal
 *  the Agent Fabric enforces via policy.adverse-event.no-autonomous-submission.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: reporter identity must be verified.
 * ─────────────────────────────────────────────────────────────────────
 *  MedWatch / VAERS submissions require an attested, identifiable
 *  reporter (name / credentials / contact). An anonymous or unverified
 *  reporter is not admissible under FDA reporting requirements and can
 *  poison the surveillance signal. reporterIdentityVerified() reports
 *  the honest signal the Agent Fabric enforces via
 *  policy.adverse-event.reporter-verified.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified pharmacovigilance engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The event-type catalog, seriousness tiers, and rule set below are
 *  ILLUSTRATIVE synthetic/demo values that model the SHAPE of an
 *  adverse-event reporting workflow — they are NOT FDA MedWatch, VAERS,
 *  EudraVigilance, an actual sponsor's pharmacovigilance database, or a
 *  certified 21 CFR 314.80 submission pipeline. The patientRefs,
 *  reporterRefs, and eventRefs are synthetic / de-identified. There is
 *  NO randomness and NO clock anywhere here: classification is a pure
 *  function of the request + catalog + caller-provided asOfDate.
 */

/** A single adverse-event type in the illustrative catalog. */
export type AdverseEventType = {
  id: string;
  label: string;
  /** Which FDA channel this event routes to: MedWatch (3500/3500A) or VAERS. */
  targetChannel: "medwatch" | "vaers";
  synthetic: true;
};

export const ADVERSE_EVENT_TYPES: AdverseEventType[] = [
  {
    id: "event.drug-adr",
    label: "Drug adverse reaction (ADR)",
    targetChannel: "medwatch",
    synthetic: true
  },
  {
    id: "event.vaccine-reaction",
    label: "Vaccine adverse reaction",
    targetChannel: "vaers",
    synthetic: true
  },
  {
    id: "event.device-malfunction",
    label: "Medical device malfunction",
    targetChannel: "medwatch",
    synthetic: true
  },
  {
    id: "event.medication-error",
    label: "Medication error (near-miss or actual)",
    targetChannel: "medwatch",
    synthetic: true
  },
  {
    id: "event.therapeutic-failure",
    label: "Therapeutic failure / lack of effect",
    targetChannel: "medwatch",
    synthetic: true
  }
];

const EVENT_TYPE_BY_ID = new Map<string, AdverseEventType>(
  ADVERSE_EVENT_TYPES.map((e) => [e.id, e])
);

export function isAdverseEventType(id: unknown): boolean {
  return typeof id === "string" && EVENT_TYPE_BY_ID.has(id);
}

export function getAdverseEventType(id: string): AdverseEventType | undefined {
  return EVENT_TYPE_BY_ID.get(id);
}

/** Seriousness tiers, aligned with 21 CFR 314.80 criteria (illustrative). */
export type SeriousnessTier = {
  id: string;
  label: string;
  /** Rank for precedence (higher = more serious). */
  rank: number;
  synthetic: true;
};

export const SERIOUSNESS_TIERS: SeriousnessTier[] = [
  { id: "seriousness.non-serious", label: "Non-serious", rank: 0, synthetic: true },
  {
    id: "seriousness.serious",
    label: "Serious (hospitalization / disability / birth defect / medically important)",
    rank: 1,
    synthetic: true
  },
  {
    id: "seriousness.life-threatening",
    label: "Life-threatening",
    rank: 2,
    synthetic: true
  },
  { id: "seriousness.death", label: "Death", rank: 3, synthetic: true }
];

const SERIOUSNESS_BY_ID = new Map<string, SeriousnessTier>(
  SERIOUSNESS_TIERS.map((s) => [s.id, s])
);

export function isSeriousnessTier(id: unknown): boolean {
  return typeof id === "string" && SERIOUSNESS_BY_ID.has(id);
}

export function getSeriousnessTier(id: string): SeriousnessTier | undefined {
  return SERIOUSNESS_BY_ID.get(id);
}

/**
 * Deterministically compute the seriousness tier from caller-provided
 * outcome flags (21 CFR 314.80 analog).
 */
export function computeSeriousnessTier(input: {
  resultedInDeath?: boolean;
  isLifeThreatening?: boolean;
  requiredHospitalization?: boolean;
  causedDisability?: boolean;
  causedBirthDefect?: boolean;
  medicallyImportant?: boolean;
}): string {
  if (input.resultedInDeath === true) return "seriousness.death";
  if (input.isLifeThreatening === true) return "seriousness.life-threatening";
  if (
    input.requiredHospitalization === true ||
    input.causedDisability === true ||
    input.causedBirthDefect === true ||
    input.medicallyImportant === true
  ) {
    return "seriousness.serious";
  }
  return "seriousness.non-serious";
}

/** Reporter identity types. */
export type ReporterType =
  | "clinician"
  | "patient"
  | "consumer"
  | "manufacturer"
  | "other-health-professional";

export function isReporterType(id: unknown): id is ReporterType {
  return (
    id === "clinician" ||
    id === "patient" ||
    id === "consumer" ||
    id === "manufacturer" ||
    id === "other-health-professional"
  );
}

/** An adverse-event rule. */
export type AdverseEventRule = {
  id: string;
  label: string;
  fires:
    | "draft-medwatch"
    | "draft-vaers"
    | "blocked-non-catalog-event"
    | "blocked-reporter-unverified";
  rationale: string;
  synthetic: true;
};

export const ADVERSE_EVENT_RULES: AdverseEventRule[] = [
  {
    id: "rule.medwatch-eligible",
    label: "Event is MedWatch-channel — draft 3500 / 3500A",
    fires: "draft-medwatch",
    rationale:
      "The event type routes to the FDA MedWatch channel (drug ADR, device malfunction, medication error, therapeutic failure) — draft a 3500 (voluntary) or 3500A (mandatory) form for regulatory-team cosign.",
    synthetic: true
  },
  {
    id: "rule.vaers-eligible",
    label: "Event is VAERS-channel — draft VAERS report",
    fires: "draft-vaers",
    rationale:
      "The event type is a vaccine adverse reaction — draft a VAERS report for regulatory-team cosign.",
    synthetic: true
  },
  {
    id: "rule.non-catalog-event",
    label: "Non-catalog event type — blocked",
    fires: "blocked-non-catalog-event",
    rationale:
      "The event cites a type outside ADVERSE_EVENT_TYPES — blocked; a bespoke event type would poison pharmacovigilance signal and doesn't map to an FDA channel.",
    synthetic: true
  },
  {
    id: "rule.reporter-unverified",
    label: "Reporter identity unverified — blocked",
    fires: "blocked-reporter-unverified",
    rationale:
      "The reporter identity has not been attested (name / credentials / contact) — blocked; an anonymous or unverified reporter is not admissible under FDA reporting requirements and poisons the surveillance signal.",
    synthetic: true
  }
];

const RULE_BY_ID = new Map<string, AdverseEventRule>(
  ADVERSE_EVENT_RULES.map((r) => [r.id, r])
);

export function isAdverseEventRule(id: unknown): boolean {
  return typeof id === "string" && RULE_BY_ID.has(id);
}

export function getAdverseEventRule(id: string): AdverseEventRule | undefined {
  return RULE_BY_ID.get(id);
}

/** Reason codes for the decision. */
export const ADVERSE_EVENT_REASON_CODES = [
  {
    id: "reason.AE-100",
    label: "AE-100 — MedWatch draft ready for regulatory-team cosign",
    synthetic: true
  },
  {
    id: "reason.AE-101",
    label: "AE-101 — VAERS draft ready for regulatory-team cosign",
    synthetic: true
  },
  {
    id: "reason.AE-300",
    label: "AE-300 — Non-catalog event type — blocked",
    synthetic: true
  },
  {
    id: "reason.AE-400",
    label: "AE-400 — Reporter identity unverified — blocked",
    synthetic: true
  }
] as const;

const REASON_BY_ID = new Map<string, (typeof ADVERSE_EVENT_REASON_CODES)[number]>(
  ADVERSE_EVENT_REASON_CODES.map((r) => [r.id, r])
);

export function isAdverseEventReasonCode(id: unknown): boolean {
  return typeof id === "string" && REASON_BY_ID.has(id);
}

export type AdverseEventRequest = {
  requestRef: string;
  patientRef: string;
  eventTypeId: string;
  /** ISO onset date. */
  onsetDate: string;
  /** ISO reported date. */
  reportedDate: string;
  /** ISO asOfDate accepted as data. */
  asOfDate: string;
  reporterType: ReporterType;
  /** Whether the reporter identity is attested (name / credentials / contact). */
  reporterIdentityVerified: boolean;
  /** Outcome flags for seriousness computation. */
  resultedInDeath?: boolean;
  isLifeThreatening?: boolean;
  requiredHospitalization?: boolean;
  causedDisability?: boolean;
  causedBirthDefect?: boolean;
  medicallyImportant?: boolean;
  /** Short structured description (NOT free-text PHI). */
  suspectProduct?: string;
};

export type AppliedAdverseEventRule = {
  ruleId: string;
  ruleLabel: string;
  reasonCode: string;
  reasonLabel: string;
  detail: string;
};

export type AdverseEventDecisionTier =
  | "draft-medwatch"
  | "draft-vaers"
  | "blocked-non-catalog-event"
  | "blocked-reporter-unverified";

export type AdverseEventRoute =
  | "regulatory-team-medwatch-queue"
  | "regulatory-team-vaers-queue"
  | "blocked-hold";

export type AdverseEventDecision = {
  requestRef: string;
  patientRef: string;
  eventTypeId: string;
  eventTypeLabel: string;
  seriousnessTierId: string;
  seriousnessTierLabel: string;
  onsetDate: string;
  reportedDate: string;
  asOfDate: string;
  reporterType: ReporterType;
  /** Copy of the request flag on the decision so reporter-verified can be checked from the decision alone. */
  reporterIdentityVerified: boolean;
  decision: AdverseEventDecisionTier;
  appliedRules: readonly AppliedAdverseEventRule[];
  primaryReasonCode: string;
  primaryReasonLabel: string;
  routedTo: AdverseEventRoute;
  requiresRegulatoryTeamCosign: boolean;
  /** Always false — the agent NEVER autonomously files to the FDA. */
  cosigned: false;
  synthetic: true;
  note: string;
};

const DECISION_RANK: Record<AdverseEventDecisionTier, number> = {
  "draft-medwatch": 0,
  "draft-vaers": 0,
  "blocked-non-catalog-event": 1,
  "blocked-reporter-unverified": 2
};

/**
 * Deterministically evaluate rules for an adverse-event request. Sorted
 * by rule-id ascending.
 */
export function evaluateAdverseEventRules(
  req: AdverseEventRequest
): readonly AppliedAdverseEventRule[] {
  const rules: AppliedAdverseEventRule[] = [];
  const eventType = getAdverseEventType(req.eventTypeId);

  // Reporter unverified (highest priority — cannot submit anything).
  if (req.reporterIdentityVerified !== true) {
    rules.push({
      ruleId: "rule.reporter-unverified",
      ruleLabel: getAdverseEventRule("rule.reporter-unverified")!.label,
      reasonCode: "reason.AE-400",
      reasonLabel: REASON_BY_ID.get("reason.AE-400")!.label,
      detail: `reporterType ${req.reporterType} identity not attested`
    });
  }

  // Non-catalog event.
  if (!eventType) {
    rules.push({
      ruleId: "rule.non-catalog-event",
      ruleLabel: getAdverseEventRule("rule.non-catalog-event")!.label,
      reasonCode: "reason.AE-300",
      reasonLabel: REASON_BY_ID.get("reason.AE-300")!.label,
      detail: `eventTypeId ${req.eventTypeId} is not on ADVERSE_EVENT_TYPES`
    });
    return [...rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  }

  // If not blocked, fire the appropriate channel rule.
  if (rules.length === 0) {
    if (eventType.targetChannel === "vaers") {
      rules.push({
        ruleId: "rule.vaers-eligible",
        ruleLabel: getAdverseEventRule("rule.vaers-eligible")!.label,
        reasonCode: "reason.AE-101",
        reasonLabel: REASON_BY_ID.get("reason.AE-101")!.label,
        detail: `${eventType.label} routes to VAERS`
      });
    } else {
      rules.push({
        ruleId: "rule.medwatch-eligible",
        ruleLabel: getAdverseEventRule("rule.medwatch-eligible")!.label,
        reasonCode: "reason.AE-100",
        reasonLabel: REASON_BY_ID.get("reason.AE-100")!.label,
        detail: `${eventType.label} routes to MedWatch`
      });
    }
  }

  return [...rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/** Summarize applied rules into a decision tier. */
export function summarizeAdverseEventDecision(
  rules: readonly AppliedAdverseEventRule[]
): {
  decision: AdverseEventDecisionTier;
  primaryReasonCode: string;
  primaryReasonLabel: string;
  routedTo: AdverseEventRoute;
} {
  if (rules.length === 0) {
    // No rules is a degenerate case; default to MedWatch draft.
    return {
      decision: "draft-medwatch",
      primaryReasonCode: "reason.AE-100",
      primaryReasonLabel: REASON_BY_ID.get("reason.AE-100")!.label,
      routedTo: "regulatory-team-medwatch-queue"
    };
  }
  let bestDecision: AdverseEventDecisionTier = "draft-medwatch";
  let bestReasonCode: string = "reason.AE-100";
  let bestReasonLabel: string = REASON_BY_ID.get("reason.AE-100")!.label;
  for (const r of rules) {
    const rule = getAdverseEventRule(r.ruleId);
    if (!rule) continue;
    if (DECISION_RANK[rule.fires] > DECISION_RANK[bestDecision]) {
      bestDecision = rule.fires;
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    } else if (
      DECISION_RANK[rule.fires] === DECISION_RANK[bestDecision] &&
      rule.fires !== bestDecision
    ) {
      // Same rank, different channel: prefer the specific channel fired.
      bestDecision = rule.fires;
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    } else if (
      bestDecision === rule.fires &&
      (rule.fires === "draft-medwatch" || rule.fires === "draft-vaers")
    ) {
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    }
  }
  const routedTo: AdverseEventRoute =
    bestDecision === "blocked-non-catalog-event" ||
    bestDecision === "blocked-reporter-unverified"
      ? "blocked-hold"
      : bestDecision === "draft-vaers"
      ? "regulatory-team-vaers-queue"
      : "regulatory-team-medwatch-queue";
  return {
    decision: bestDecision,
    primaryReasonCode: bestReasonCode,
    primaryReasonLabel: bestReasonLabel,
    routedTo
  };
}

/** Deterministically produce the adverse-event decision. */
export function evaluateAdverseEvent(req: AdverseEventRequest): AdverseEventDecision {
  const eventType = getAdverseEventType(req.eventTypeId);
  const rules = evaluateAdverseEventRules(req);
  const { decision, primaryReasonCode, primaryReasonLabel, routedTo } =
    summarizeAdverseEventDecision(rules);
  const seriousnessId = computeSeriousnessTier(req);
  const seriousness = getSeriousnessTier(seriousnessId);

  const requiresRegulatoryTeamCosign =
    decision === "draft-medwatch" || decision === "draft-vaers";

  const note =
    decision === "draft-medwatch"
      ? `Draft MedWatch (3500/3500A) for ${eventType?.label ?? req.eventTypeId} — routed to regulatory-team queue for cosign. Seriousness: ${seriousness?.label ?? "unknown"}. The agent NEVER autonomously files to the FDA.`
      : decision === "draft-vaers"
      ? `Draft VAERS report for ${eventType?.label ?? req.eventTypeId} — routed to regulatory-team queue for cosign. Seriousness: ${seriousness?.label ?? "unknown"}. The agent NEVER autonomously files to the FDA.`
      : decision === "blocked-non-catalog-event"
      ? `Blocked — event type ${req.eventTypeId} is not on the ADVERSE_EVENT_TYPES catalog. ${rules.length} rule${rules.length === 1 ? "" : "s"} fired.`
      : `Blocked — reporter identity unverified. ${rules.length} rule${rules.length === 1 ? "" : "s"} fired. FDA reporting requires an attested, identifiable reporter.`;

  return {
    requestRef: req.requestRef,
    patientRef: req.patientRef,
    eventTypeId: req.eventTypeId,
    eventTypeLabel: eventType?.label ?? "(off-catalog)",
    seriousnessTierId: seriousnessId,
    seriousnessTierLabel: seriousness?.label ?? "(off-catalog)",
    onsetDate: req.onsetDate,
    reportedDate: req.reportedDate,
    asOfDate: req.asOfDate,
    reporterType: req.reporterType,
    reporterIdentityVerified: req.reporterIdentityVerified,
    decision,
    appliedRules: rules,
    primaryReasonCode,
    primaryReasonLabel,
    routedTo,
    requiresRegulatoryTeamCosign,
    cosigned: false,
    synthetic: true,
    note
  };
}

/** Event-catalog check. True when event + seriousness + rule + reason ids are all catalog-sourced. */
export function eventsTraceToCatalog(
  input:
    | {
        eventTypeId?: string;
        seriousnessTierId?: string;
        appliedRules?: ReadonlyArray<{ ruleId?: string; reasonCode?: string }>;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  // For blocked-non-catalog-event, seriousness may be non-catalog too;
  // the block itself is the safe path — so we don't force eventType to be
  // on-catalog when the decision blocked it.
  if (!isAdverseEventType(input.eventTypeId)) return false;
  if (!isSeriousnessTier(input.seriousnessTierId)) return false;
  const rules = input.appliedRules ?? [];
  if (!Array.isArray(rules)) return false;
  return rules.every(
    (r) => isAdverseEventRule(r.ruleId) && isAdverseEventReasonCode(r.reasonCode)
  );
}

/** Cosign check. True when a draft decision is properly gated OR the decision is a block (safe path). */
export function submissionRequiresRegulatoryTeamCosign(
  decision:
    | {
        decision?: string;
        requiresRegulatoryTeamCosign?: boolean;
        cosigned?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (
    decision.decision !== "draft-medwatch" &&
    decision.decision !== "draft-vaers"
  ) {
    return true; // block decisions trivially satisfy — no submission possible
  }
  if (decision.requiresRegulatoryTeamCosign !== true) return false;
  if (decision.cosigned === true) return false;
  return true;
}

/** Reporter-verified check. True when reporter is verified OR the decision is safely blocked. */
export function reporterIdentityVerified(
  input:
    | {
        decision?: string;
        reporterIdentityVerified?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  if (input.decision === "blocked-reporter-unverified") return true; // safe path
  return input.reporterIdentityVerified === true;
}

// Illustrative demo requests.

export const DEMO_AE_MEDWATCH_DRUG: AdverseEventRequest = {
  requestRef: "ae-req-2026-07-001",
  patientRef: "patient-001",
  eventTypeId: "event.drug-adr",
  onsetDate: "2026-07-03",
  reportedDate: "2026-07-05",
  asOfDate: "2026-07-05",
  reporterType: "clinician",
  reporterIdentityVerified: true,
  requiredHospitalization: true,
  suspectProduct: "fezolinetant 45mg oral"
};

export const DEMO_AE_VAERS_VACCINE: AdverseEventRequest = {
  requestRef: "ae-req-2026-07-002",
  patientRef: "patient-002",
  eventTypeId: "event.vaccine-reaction",
  onsetDate: "2026-07-04",
  reportedDate: "2026-07-05",
  asOfDate: "2026-07-05",
  reporterType: "clinician",
  reporterIdentityVerified: true,
  medicallyImportant: true,
  suspectProduct: "seasonal-flu-quadrivalent 2026-2027"
};

export const DEMO_AE_DEATH_LIFE_THREATENING: AdverseEventRequest = {
  requestRef: "ae-req-2026-07-003",
  patientRef: "patient-003",
  eventTypeId: "event.drug-adr",
  onsetDate: "2026-07-04",
  reportedDate: "2026-07-05",
  asOfDate: "2026-07-05",
  reporterType: "clinician",
  reporterIdentityVerified: true,
  isLifeThreatening: true,
  requiredHospitalization: true,
  suspectProduct: "estradiol transdermal patch 0.1mg/day"
};

export const DEMO_AE_UNVERIFIED_REPORTER: AdverseEventRequest = {
  requestRef: "ae-req-2026-07-004",
  patientRef: "patient-004",
  eventTypeId: "event.medication-error",
  onsetDate: "2026-07-04",
  reportedDate: "2026-07-05",
  asOfDate: "2026-07-05",
  reporterType: "consumer",
  reporterIdentityVerified: false,
  suspectProduct: "unknown"
};

export const DEMO_AE_NON_SERIOUS: AdverseEventRequest = {
  requestRef: "ae-req-2026-07-005",
  patientRef: "patient-005",
  eventTypeId: "event.drug-adr",
  onsetDate: "2026-07-04",
  reportedDate: "2026-07-05",
  asOfDate: "2026-07-05",
  reporterType: "patient",
  reporterIdentityVerified: true,
  suspectProduct: "paroxetine 7.5mg oral"
};
