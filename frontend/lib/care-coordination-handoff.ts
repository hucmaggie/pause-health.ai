/**
 * Care Coordination Handoff (Cross-Setting) — deterministic assembly of a
 * SBAR-style handoff for any cross-setting patient transition (hospital →
 * SNF, SNF → home, home → hospice, ED → PCP, PCP → specialist, and back),
 * with receiving-clinician credentialing verification and patient-consent
 * confirmation.
 *
 * Deterministic, dependency-free domain core the Care Coordination Handoff
 * Agent (app/api/agents/care-coordination-handoff) wraps — the Salesforce
 * "Agentforce for Health" / Health Cloud cross-setting care-coordination
 * analog on Pause's Agent Fabric. Distinct from the Discharge & Transitions
 * of Care agent (which is POST-DISCHARGE hospital→home only, and owns the
 * medication reconciliation) and the Referral Management agent (which
 * drafts an outbound specialist referral): this is any CROSS-SETTING
 * handoff — the SBAR (situation / background / assessment / recommendation)
 * assembly that a receiving clinician needs to accept the patient.
 *
 *   Inbound:  HandoffRequest (a synthetic patientRef + sendingSettingId +
 *             receivingSettingId + receivingClinicianRef + sbar (structured
 *             fields, not free text) + consent flag + credentialing status +
 *             ISO asOfDate accepted as data)
 *   Outbound: HandoffDecision { requestRef, decision: 'handoff-accepted' |
 *             'pend-sbar-incomplete' | 'blocked-clinician-not-credentialed' |
 *             'blocked-no-consent', appliedRules[], missingSbarSections[],
 *             primaryReasonCode, routedTo, requiresReceivingClinicianCosign,
 *             cosigned:false, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: SBAR completeness.
 * ─────────────────────────────────────────────────────────────────────
 *  A handoff without a complete SBAR (situation, background, assessment,
 *  recommendation — the four load-bearing sections) is a well-documented
 *  patient-safety failure. The Joint Commission's National Patient Safety
 *  Goal 2 requires standardized handoff communication. sbarIsComplete()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.handoff.sbar-completeness.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: receiving clinician must be credentialed.
 * ─────────────────────────────────────────────────────────────────────
 *  The receiving clinician must exist in the provider directory with a
 *  current, unsanctioned credentialing status. Handing a patient off to
 *  an expired / incomplete / sanctioned clinician is a variant of the
 *  ghost-network problem and a Section 1557 / due-process failure.
 *  Mirrors the Provider Credentialing Agent's no-referral-to-expired-or-
 *  sanctioned posture. receivingClinicianIsCredentialed() reports the
 *  honest signal the Agent Fabric enforces via
 *  policy.handoff.receiving-clinician-credentialed.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: patient consent for transfer must be on file.
 * ─────────────────────────────────────────────────────────────────────
 *  Cross-setting handoffs (especially to hospice, behavioral health, SNF,
 *  or between health systems) require the patient's consent to share
 *  clinical information with the receiving setting. A handoff without
 *  transfer consent is a HIPAA disclosure failure. handoffHasConsent()
 *  reports the honest signal the Agent Fabric enforces via
 *  policy.handoff.consent-on-file. Mirrors the Consent & Preferences
 *  Management Agent's consent-scope posture.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified handoff engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The care-setting catalog, transition-type catalog, SBAR rule set,
 *  and reason codes below are ILLUSTRATIVE synthetic/demo values that
 *  model the SHAPE of a cross-setting handoff workflow — they are NOT
 *  Epic Care Everywhere, Cerner CareAware, an actual health system's
 *  handoff protocol, or a certified Joint Commission / ONC-approved
 *  handoff module. The patientRefs, clinicianRefs, and setting ids are
 *  synthetic / de-identified. There is NO randomness and NO clock
 *  anywhere here: the handoff decision is a pure function of the
 *  request + catalog + caller-provided asOfDate.
 */

/** A single care setting in the illustrative catalog. */
export type CareSetting = {
  id: string;
  label: string;
  synthetic: true;
};

export const CARE_SETTINGS: CareSetting[] = [
  { id: "setting.hospital-inpatient", label: "Hospital (inpatient)", synthetic: true },
  { id: "setting.ed", label: "Emergency Department", synthetic: true },
  { id: "setting.snf", label: "Skilled Nursing Facility (SNF)", synthetic: true },
  { id: "setting.home-health", label: "Home health", synthetic: true },
  { id: "setting.hospice", label: "Hospice", synthetic: true },
  { id: "setting.pcp-clinic", label: "PCP clinic", synthetic: true },
  { id: "setting.specialist-clinic", label: "Specialist clinic", synthetic: true },
  { id: "setting.behavioral-health-clinic", label: "Behavioral health clinic", synthetic: true }
];

const SETTING_BY_ID = new Map<string, CareSetting>(CARE_SETTINGS.map((s) => [s.id, s]));

export function isCareSetting(id: unknown): boolean {
  return typeof id === "string" && SETTING_BY_ID.has(id);
}

export function getCareSetting(id: string): CareSetting | undefined {
  return SETTING_BY_ID.get(id);
}

/** A cross-setting transition type. */
export type TransitionType = {
  id: string;
  label: string;
  sendingSettingId: string;
  receivingSettingId: string;
  /** Whether this transition typically requires a documented transfer consent. */
  requiresTransferConsent: boolean;
  synthetic: true;
};

export const TRANSITION_TYPES: TransitionType[] = [
  {
    id: "transition.hospital-to-snf",
    label: "Hospital → SNF",
    sendingSettingId: "setting.hospital-inpatient",
    receivingSettingId: "setting.snf",
    requiresTransferConsent: true,
    synthetic: true
  },
  {
    id: "transition.snf-to-home",
    label: "SNF → Home health",
    sendingSettingId: "setting.snf",
    receivingSettingId: "setting.home-health",
    requiresTransferConsent: true,
    synthetic: true
  },
  {
    id: "transition.home-to-hospice",
    label: "Home → Hospice",
    sendingSettingId: "setting.home-health",
    receivingSettingId: "setting.hospice",
    requiresTransferConsent: true,
    synthetic: true
  },
  {
    id: "transition.ed-to-pcp",
    label: "ED → PCP follow-up",
    sendingSettingId: "setting.ed",
    receivingSettingId: "setting.pcp-clinic",
    requiresTransferConsent: false,
    synthetic: true
  },
  {
    id: "transition.pcp-to-specialist",
    label: "PCP → Specialist clinic",
    sendingSettingId: "setting.pcp-clinic",
    receivingSettingId: "setting.specialist-clinic",
    requiresTransferConsent: false,
    synthetic: true
  },
  {
    id: "transition.pcp-to-behavioral-health",
    label: "PCP → Behavioral health clinic",
    sendingSettingId: "setting.pcp-clinic",
    receivingSettingId: "setting.behavioral-health-clinic",
    requiresTransferConsent: true,
    synthetic: true
  }
];

const TRANSITION_BY_ID = new Map<string, TransitionType>(
  TRANSITION_TYPES.map((t) => [t.id, t])
);

export function isTransitionType(id: unknown): boolean {
  return typeof id === "string" && TRANSITION_BY_ID.has(id);
}

export function getTransitionType(id: string): TransitionType | undefined {
  return TRANSITION_BY_ID.get(id);
}

/** The four load-bearing SBAR sections. */
export const SBAR_SECTIONS = ["situation", "background", "assessment", "recommendation"] as const;
export type SbarSection = (typeof SBAR_SECTIONS)[number];

/** A structured SBAR — every section is a short label, not free-text PHI. */
export type Sbar = {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
};

/** A handoff rule the engine can apply. */
export type HandoffRule = {
  id: string;
  label: string;
  fires:
    | "handoff-accepted"
    | "pend-sbar-incomplete"
    | "blocked-clinician-not-credentialed"
    | "blocked-no-consent";
  rationale: string;
  synthetic: true;
};

export const HANDOFF_RULES: HandoffRule[] = [
  {
    id: "rule.sbar-complete",
    label: "SBAR complete — accept the handoff",
    fires: "handoff-accepted",
    rationale:
      "All four SBAR sections (situation, background, assessment, recommendation) are populated — the receiving clinician has the standardized handoff communication required by the Joint Commission National Patient Safety Goal 2.",
    synthetic: true
  },
  {
    id: "rule.sbar-incomplete",
    label: "SBAR incomplete — pend and request completion",
    fires: "pend-sbar-incomplete",
    rationale:
      "One or more SBAR sections are missing — pend for the sending clinician to complete the handoff; a handoff without complete SBAR is a Joint Commission NPSG-2 patient-safety failure.",
    synthetic: true
  },
  {
    id: "rule.clinician-not-credentialed",
    label: "Receiving clinician is not credentialed — blocked",
    fires: "blocked-clinician-not-credentialed",
    rationale:
      "The receiving clinician's credentialing status is expired, incomplete, or sanctioned — blocked; handing a patient off to an uncredentialed clinician is a ghost-network / Section 1557 / due-process failure. Route to Provider Credentialing for remediation.",
    synthetic: true
  },
  {
    id: "rule.transfer-consent-missing",
    label: "Transfer consent missing — blocked",
    fires: "blocked-no-consent",
    rationale:
      "This transition type requires documented patient consent to share clinical information with the receiving setting, and none is on file — blocked; a handoff without transfer consent is a HIPAA disclosure failure. Route to Consent & Preferences Management to capture the missing consent.",
    synthetic: true
  }
];

const RULE_BY_ID = new Map<string, HandoffRule>(HANDOFF_RULES.map((r) => [r.id, r]));

export function isHandoffRule(id: unknown): boolean {
  return typeof id === "string" && RULE_BY_ID.has(id);
}

export function getHandoffRule(id: string): HandoffRule | undefined {
  return RULE_BY_ID.get(id);
}

/** Reason codes for the decision. */
export const HANDOFF_REASON_CODES = [
  { id: "reason.HO-100", label: "HO-100 — SBAR complete, handoff accepted", synthetic: true },
  {
    id: "reason.HO-200",
    label: "HO-200 — SBAR incomplete — pend for completion",
    synthetic: true
  },
  {
    id: "reason.HO-300",
    label: "HO-300 — Receiving clinician not credentialed — blocked",
    synthetic: true
  },
  {
    id: "reason.HO-400",
    label: "HO-400 — Transfer consent missing — blocked",
    synthetic: true
  }
] as const;

const REASON_BY_ID = new Map<string, (typeof HANDOFF_REASON_CODES)[number]>(
  HANDOFF_REASON_CODES.map((r) => [r.id, r])
);

export function isHandoffReasonCode(id: unknown): boolean {
  return typeof id === "string" && REASON_BY_ID.has(id);
}

/** Credentialing status of the receiving clinician (illustrative). */
export type CredentialingStatus =
  | "current-unsanctioned"
  | "expired"
  | "incomplete"
  | "sanctioned";

export function isCredentialingStatus(id: unknown): id is CredentialingStatus {
  return (
    id === "current-unsanctioned" ||
    id === "expired" ||
    id === "incomplete" ||
    id === "sanctioned"
  );
}

/** Structured input the handoff engine reads. */
export type HandoffRequest = {
  requestRef: string;
  patientRef: string;
  transitionTypeId: string;
  receivingClinicianRef: string;
  /** Credentialing status of the receiving clinician. */
  receivingClinicianCredentialing: CredentialingStatus;
  /** Whether transfer consent is on file (per the Consent agent). */
  transferConsentOnFile: boolean;
  /** SBAR — each section is a short structured label, NOT free-text PHI. */
  sbar: Partial<Sbar>;
  /** ISO asOfDate accepted as data. */
  asOfDate: string;
};

/** A single applied rule. */
export type AppliedHandoffRule = {
  ruleId: string;
  ruleLabel: string;
  reasonCode: string;
  reasonLabel: string;
  detail: string;
};

export type HandoffDecisionTier =
  | "handoff-accepted"
  | "pend-sbar-incomplete"
  | "blocked-clinician-not-credentialed"
  | "blocked-no-consent";

export type HandoffRoute =
  | "receiving-clinician-inbox"
  | "sending-clinician-completion"
  | "credentialing-remediation"
  | "consent-capture";

export type HandoffDecision = {
  requestRef: string;
  patientRef: string;
  transitionTypeId: string;
  transitionTypeLabel: string;
  receivingClinicianRef: string;
  receivingClinicianCredentialing: CredentialingStatus;
  /** Copy of the request flag on the decision so consent-integrity can be verified from the decision alone. */
  transferConsentOnFile: boolean;
  asOfDate: string;
  decision: HandoffDecisionTier;
  appliedRules: readonly AppliedHandoffRule[];
  missingSbarSections: readonly SbarSection[];
  primaryReasonCode: string;
  primaryReasonLabel: string;
  routedTo: HandoffRoute;
  requiresReceivingClinicianCosign: boolean;
  /** Always false — the agent NEVER autonomously accepts on behalf of the receiving clinician. */
  cosigned: false;
  synthetic: true;
  note: string;
};

/** Decision severity for precedence — consent > credentialing > sbar > accept. */
const DECISION_RANK: Record<HandoffDecisionTier, number> = {
  "handoff-accepted": 0,
  "pend-sbar-incomplete": 1,
  "blocked-clinician-not-credentialed": 2,
  "blocked-no-consent": 3
};

/** List the SBAR sections not populated in the request. */
export function missingSbarSections(sbar: Partial<Sbar>): readonly SbarSection[] {
  return SBAR_SECTIONS.filter((k) => {
    const v = sbar[k];
    return typeof v !== "string" || v.trim().length === 0;
  });
}

/**
 * Deterministically evaluate rules for a handoff request. Sorted by
 * rule-id ascending.
 */
export function evaluateHandoffRules(req: HandoffRequest): readonly AppliedHandoffRule[] {
  const rules: AppliedHandoffRule[] = [];
  const transition = getTransitionType(req.transitionTypeId);

  // Consent-missing (highest priority when the transition requires it).
  if (transition && transition.requiresTransferConsent && req.transferConsentOnFile !== true) {
    rules.push({
      ruleId: "rule.transfer-consent-missing",
      ruleLabel: getHandoffRule("rule.transfer-consent-missing")!.label,
      reasonCode: "reason.HO-400",
      reasonLabel: REASON_BY_ID.get("reason.HO-400")!.label,
      detail: `transition ${transition.label} requires transfer consent; none on file`
    });
  }

  // Credentialing block.
  if (req.receivingClinicianCredentialing !== "current-unsanctioned") {
    rules.push({
      ruleId: "rule.clinician-not-credentialed",
      ruleLabel: getHandoffRule("rule.clinician-not-credentialed")!.label,
      reasonCode: "reason.HO-300",
      reasonLabel: REASON_BY_ID.get("reason.HO-300")!.label,
      detail: `receiving clinician ${req.receivingClinicianRef} credentialing = ${req.receivingClinicianCredentialing}`
    });
  }

  // SBAR-completeness.
  const missing = missingSbarSections(req.sbar);
  if (missing.length > 0) {
    rules.push({
      ruleId: "rule.sbar-incomplete",
      ruleLabel: getHandoffRule("rule.sbar-incomplete")!.label,
      reasonCode: "reason.HO-200",
      reasonLabel: REASON_BY_ID.get("reason.HO-200")!.label,
      detail: `SBAR missing ${missing.length} of 4 sections: ${missing.join(", ")}`
    });
  }

  // Clean path — accept the handoff.
  if (rules.length === 0) {
    rules.push({
      ruleId: "rule.sbar-complete",
      ruleLabel: getHandoffRule("rule.sbar-complete")!.label,
      reasonCode: "reason.HO-100",
      reasonLabel: REASON_BY_ID.get("reason.HO-100")!.label,
      detail: `all four SBAR sections populated for ${transition?.label ?? req.transitionTypeId}`
    });
  }

  return [...rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/** Summarize applied rules into a decision tier. */
export function summarizeHandoffDecision(rules: readonly AppliedHandoffRule[]): {
  decision: HandoffDecisionTier;
  primaryReasonCode: string;
  primaryReasonLabel: string;
  routedTo: HandoffRoute;
} {
  if (rules.length === 0) {
    return {
      decision: "handoff-accepted",
      primaryReasonCode: "reason.HO-100",
      primaryReasonLabel: REASON_BY_ID.get("reason.HO-100")!.label,
      routedTo: "receiving-clinician-inbox"
    };
  }
  let bestDecision: HandoffDecisionTier = "handoff-accepted";
  let bestReasonCode: string = "reason.HO-100";
  let bestReasonLabel: string = REASON_BY_ID.get("reason.HO-100")!.label;
  for (const r of rules) {
    const rule = getHandoffRule(r.ruleId);
    if (!rule) continue;
    if (DECISION_RANK[rule.fires] > DECISION_RANK[bestDecision]) {
      bestDecision = rule.fires;
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    } else if (
      bestDecision === "handoff-accepted" &&
      rule.fires === "handoff-accepted"
    ) {
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    }
  }
  const routedTo: HandoffRoute =
    bestDecision === "blocked-no-consent"
      ? "consent-capture"
      : bestDecision === "blocked-clinician-not-credentialed"
      ? "credentialing-remediation"
      : bestDecision === "pend-sbar-incomplete"
      ? "sending-clinician-completion"
      : "receiving-clinician-inbox";
  return {
    decision: bestDecision,
    primaryReasonCode: bestReasonCode,
    primaryReasonLabel: bestReasonLabel,
    routedTo
  };
}

/** Deterministically produce the handoff decision. */
export function evaluateHandoff(req: HandoffRequest): HandoffDecision {
  const transition = getTransitionType(req.transitionTypeId);
  const rules = evaluateHandoffRules(req);
  const { decision, primaryReasonCode, primaryReasonLabel, routedTo } =
    summarizeHandoffDecision(rules);
  const missing = missingSbarSections(req.sbar);

  const requiresReceivingClinicianCosign = decision === "handoff-accepted";

  const note =
    decision === "handoff-accepted"
      ? `Handoff accepted for ${transition?.label ?? req.transitionTypeId} — SBAR complete, receiving clinician credentialed, consent on file (if required). Routed to receiving-clinician-inbox for cosign.`
      : `${decision} for ${transition?.label ?? req.transitionTypeId}: ${rules.length} rule${rules.length === 1 ? "" : "s"} fired, primary reason ${primaryReasonCode}. Routed to ${routedTo}. ` +
        (decision === "blocked-no-consent"
          ? "BLOCKED — transfer consent missing (HIPAA)."
          : decision === "blocked-clinician-not-credentialed"
          ? "BLOCKED — receiving clinician not credentialed (Section 1557 / ghost-network guard)."
          : "PENDING — SBAR completion required (Joint Commission NPSG-2).");

  return {
    requestRef: req.requestRef,
    patientRef: req.patientRef,
    transitionTypeId: req.transitionTypeId,
    transitionTypeLabel: transition?.label ?? "(off-catalog)",
    receivingClinicianRef: req.receivingClinicianRef,
    receivingClinicianCredentialing: req.receivingClinicianCredentialing,
    transferConsentOnFile: req.transferConsentOnFile,
    asOfDate: req.asOfDate,
    decision,
    appliedRules: rules,
    missingSbarSections: missing,
    primaryReasonCode,
    primaryReasonLabel,
    routedTo,
    requiresReceivingClinicianCosign,
    cosigned: false,
    synthetic: true,
    note
  };
}

/** SBAR-completeness check. True when the handoff has all 4 SBAR sections OR is safely pended for completion. */
export function sbarIsComplete(
  input:
    | {
        decision?: string;
        missingSbarSections?: readonly string[];
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  const missing = input.missingSbarSections ?? [];
  if (!Array.isArray(missing)) return false;
  // Safe path: decision is pend-sbar-incomplete — the agent surfaced the gap.
  if (input.decision === "pend-sbar-incomplete") return true;
  // Otherwise SBAR must be fully populated.
  return missing.length === 0;
}

/** Credentialing check. True when the receiving clinician is credentialed OR the handoff is safely blocked. */
export function receivingClinicianIsCredentialed(
  input:
    | {
        decision?: string;
        receivingClinicianCredentialing?: string;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  if (input.decision === "blocked-clinician-not-credentialed") return true; // safe path
  return input.receivingClinicianCredentialing === "current-unsanctioned";
}

/** Consent check. True when transfer consent is on file (for transitions that require it) OR the handoff is safely blocked. */
export function handoffHasConsent(
  input:
    | {
        decision?: string;
        transitionTypeId?: string;
        transferConsentOnFile?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  // Safe path — the agent already refused the disclosure.
  if (input.decision === "blocked-no-consent") return true;
  const transition = getTransitionType(input.transitionTypeId ?? "");
  // Non-catalog transitions default to conservative: consent must be present.
  if (!transition) return input.transferConsentOnFile === true;
  // If the transition doesn't require consent, we're fine.
  if (!transition.requiresTransferConsent) return true;
  // Otherwise consent must be present.
  return input.transferConsentOnFile === true;
}

// Illustrative demo requests.

const COMPLETE_SBAR: Sbar = {
  situation: "postmenopausal patient with new-onset dyspnea post-hospital discharge",
  background: "history of osteoporosis + hypertension + chronic anxiety",
  assessment: "stable vitals, ambulating with rollator, requires DME + PT follow-up",
  recommendation: "SNF admission for PT / OT bridging, target 7-day discharge home"
};

export const DEMO_HANDOFF_ACCEPTED: HandoffRequest = {
  requestRef: "ho-req-2026-07-001",
  patientRef: "patient-001",
  transitionTypeId: "transition.hospital-to-snf",
  receivingClinicianRef: "clinician-snf-attending-001",
  receivingClinicianCredentialing: "current-unsanctioned",
  transferConsentOnFile: true,
  sbar: COMPLETE_SBAR,
  asOfDate: "2026-07-05"
};

export const DEMO_HANDOFF_SBAR_INCOMPLETE: HandoffRequest = {
  requestRef: "ho-req-2026-07-002",
  patientRef: "patient-002",
  transitionTypeId: "transition.snf-to-home",
  receivingClinicianRef: "clinician-home-health-002",
  receivingClinicianCredentialing: "current-unsanctioned",
  transferConsentOnFile: true,
  sbar: {
    situation: "postmenopausal patient completing SNF stay",
    background: "post-hip-fracture recovery",
    // assessment + recommendation missing
    assessment: "",
    recommendation: ""
  },
  asOfDate: "2026-07-05"
};

export const DEMO_HANDOFF_UNCREDENTIALED: HandoffRequest = {
  requestRef: "ho-req-2026-07-003",
  patientRef: "patient-003",
  transitionTypeId: "transition.ed-to-pcp",
  receivingClinicianRef: "clinician-pcp-expired-003",
  receivingClinicianCredentialing: "expired",
  transferConsentOnFile: true,
  sbar: COMPLETE_SBAR,
  asOfDate: "2026-07-05"
};

export const DEMO_HANDOFF_NO_CONSENT: HandoffRequest = {
  requestRef: "ho-req-2026-07-004",
  patientRef: "patient-004",
  transitionTypeId: "transition.home-to-hospice",
  receivingClinicianRef: "clinician-hospice-004",
  receivingClinicianCredentialing: "current-unsanctioned",
  transferConsentOnFile: false,
  sbar: COMPLETE_SBAR,
  asOfDate: "2026-07-05"
};

export const DEMO_HANDOFF_ED_TO_PCP: HandoffRequest = {
  requestRef: "ho-req-2026-07-005",
  patientRef: "patient-005",
  transitionTypeId: "transition.ed-to-pcp",
  receivingClinicianRef: "clinician-pcp-005",
  receivingClinicianCredentialing: "current-unsanctioned",
  transferConsentOnFile: false, // ED→PCP does NOT require transfer consent
  sbar: COMPLETE_SBAR,
  asOfDate: "2026-07-05"
};
