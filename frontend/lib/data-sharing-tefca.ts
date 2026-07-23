/**
 * Data-Sharing / TEFCA Interoperability — deterministic classification of
 * cross-organization data-exchange requests (TEFCA QHIN, Carequality,
 * CommonWell) against a defined exchange-purpose catalog, participant-
 * identity verification, and consent-scope gating for non-TPO purposes.
 *
 * Deterministic, dependency-free domain core the Data-Sharing / TEFCA
 * Interoperability Agent (app/api/agents/data-sharing-tefca) wraps — the
 * Salesforce "Agentforce for Health" / Health Cloud interoperability
 * analog on Pause's Agent Fabric. For each inbound / outbound PHI
 * exchange request, it classifies the exchange purpose (treatment /
 * payment / operations / patient-request / public-health / research),
 * verifies the counterparty is a Trusted Exchange Framework participant,
 * applies the patient's data-sharing preferences from the Consent agent,
 * and classifies as release-authorized / pend-purpose-verification /
 * blocked-non-catalog-purpose / blocked-participant-unverified /
 * blocked-consent-required-non-tpo. The agent NEVER releases PHI for a
 * non-TPO purpose without explicit patient consent (this is the load-
 * bearing HIPAA §164.506 boundary — TPO = treatment/payment/operations
 * doesn't need consent; everything else does).
 *
 *   Inbound:  DataSharingRequest (a synthetic patientRef + requesterRef +
 *             exchange-network id + exchange-purpose id + requester
 *             identity-verified flag + consent-on-file flags per scope +
 *             ISO asOfDate accepted as data)
 *   Outbound: DataSharingDecision { requestRef, decision: 'release-
 *             authorized' | 'pend-purpose-verification' | 'blocked-non-
 *             catalog-purpose' | 'blocked-participant-unverified' |
 *             'blocked-consent-required-non-tpo', appliedRules[],
 *             primaryReasonCode, routedTo, requiresPrivacyOfficerCosign,
 *             cosigned:false, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: exchange purposes trace to catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every classified exchange must cite a purpose from the defined
 *  EXCHANGE_PURPOSES catalog (treatment / payment / operations /
 *  patient-request / public-health / research), a network from the
 *  defined EXCHANGE_NETWORKS catalog (TEFCA-QHIN / Carequality /
 *  CommonWell), and applied rules from DATA_SHARING_RULES. An ad-hoc
 *  "we-just-decided-to-share-because" purpose fails.
 *  purposesTraceToCatalog() reports the honest signal the Agent Fabric
 *  enforces via policy.data-sharing.purpose-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no autonomous PHI release for non-TPO.
 * ─────────────────────────────────────────────────────────────────────
 *  HIPAA §164.506 permits PHI disclosure without patient consent ONLY
 *  for treatment / payment / operations. Every other purpose (research,
 *  public-health, patient-request, and any ad-hoc / off-catalog use)
 *  requires an explicit consent scope on file. A release-authorized
 *  decision for a non-TPO purpose without consent is a HIPAA disclosure
 *  failure and a documented breach pattern (the majority of OCR
 *  enforcement actions cite unauthorized non-TPO disclosures).
 *  releaseHonorsNonTpoConsent() reports the honest signal the Agent
 *  Fabric enforces via policy.data-sharing.no-autonomous-non-tpo-release.
 *  Mirrors the Consent & Preferences Management Agent's no-scope-override
 *  and the Grievance & Appeals Agent's no-phi-in-routing-summary posture.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: TEFCA participant identity must be verified.
 * ─────────────────────────────────────────────────────────────────────
 *  Under 45 CFR 171 (ONC Cures Act) + the TEFCA Common Agreement, a QHIN
 *  / participant / sub-participant must be identity-attested before a
 *  cross-org exchange is authorized. An unverified counterparty is a
 *  federated-identity trust failure that opens the network to spoofing
 *  and unauthorized aggregation. participantIdentityVerified() reports
 *  the honest signal the Agent Fabric enforces via
 *  policy.data-sharing.participant-verified. Mirrors the Provider
 *  Credentialing Agent's source-integrity posture and the Adverse Event
 *  Reporting Agent's reporter-verified posture.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified TEFCA implementation.
 * ─────────────────────────────────────────────────────────────────────
 *  The exchange-network catalog, exchange-purpose catalog, and rule set
 *  below are ILLUSTRATIVE synthetic/demo values that model the SHAPE of
 *  a TEFCA / Carequality / CommonWell workflow — they are NOT an actual
 *  TEFCA QHIN implementation, the Carequality Interoperability Framework,
 *  the CommonWell Health Alliance node stack, an ONC-certified data-
 *  sharing gateway, or a certified 45 CFR 171 information-blocking-safe
 *  release engine. The patientRefs, requesterRefs, and network ids are
 *  synthetic / de-identified. There is NO randomness and NO clock
 *  anywhere here: classification is a pure function of the request +
 *  catalog + caller-provided asOfDate.
 */

/** A single exchange network in the illustrative catalog. */
export type ExchangeNetwork = {
  id: string;
  label: string;
  synthetic: true;
};

export const EXCHANGE_NETWORKS: ExchangeNetwork[] = [
  { id: "network.tefca-qhin", label: "TEFCA QHIN (Qualified Health Info Network)", synthetic: true },
  { id: "network.carequality", label: "Carequality Interoperability Framework", synthetic: true },
  { id: "network.commonwell", label: "CommonWell Health Alliance", synthetic: true },
  { id: "network.direct-secure-messaging", label: "Direct Secure Messaging (S/MIME)", synthetic: true }
];

const NETWORK_BY_ID = new Map<string, ExchangeNetwork>(
  EXCHANGE_NETWORKS.map((n) => [n.id, n])
);

export function isExchangeNetwork(id: unknown): boolean {
  return typeof id === "string" && NETWORK_BY_ID.has(id);
}

export function getExchangeNetwork(id: string): ExchangeNetwork | undefined {
  return NETWORK_BY_ID.get(id);
}

/** An exchange purpose in the illustrative catalog. */
export type ExchangePurpose = {
  id: string;
  label: string;
  /** Whether this purpose is a HIPAA §164.506 TPO exception (no consent required). */
  isTpo: boolean;
  synthetic: true;
};

export const EXCHANGE_PURPOSES: ExchangePurpose[] = [
  { id: "purpose.treatment", label: "Treatment (HIPAA §164.506 TPO)", isTpo: true, synthetic: true },
  { id: "purpose.payment", label: "Payment (HIPAA §164.506 TPO)", isTpo: true, synthetic: true },
  { id: "purpose.operations", label: "Health care operations (HIPAA §164.506 TPO)", isTpo: true, synthetic: true },
  { id: "purpose.patient-request", label: "Patient right of access (HIPAA §164.524)", isTpo: false, synthetic: true },
  { id: "purpose.public-health", label: "Public-health reporting (HIPAA §164.512(b))", isTpo: false, synthetic: true },
  { id: "purpose.research", label: "Research (HIPAA §164.512(i))", isTpo: false, synthetic: true }
];

const PURPOSE_BY_ID = new Map<string, ExchangePurpose>(
  EXCHANGE_PURPOSES.map((p) => [p.id, p])
);

export function isExchangePurpose(id: unknown): boolean {
  return typeof id === "string" && PURPOSE_BY_ID.has(id);
}

export function getExchangePurpose(id: string): ExchangePurpose | undefined {
  return PURPOSE_BY_ID.get(id);
}

/** A data-sharing rule. */
export type DataSharingRule = {
  id: string;
  label: string;
  fires:
    | "release-authorized"
    | "pend-purpose-verification"
    | "blocked-non-catalog-purpose"
    | "blocked-participant-unverified"
    | "blocked-consent-required-non-tpo";
  rationale: string;
  synthetic: true;
};

export const DATA_SHARING_RULES: DataSharingRule[] = [
  {
    id: "rule.tpo-release-authorized",
    label: "TPO purpose — release authorized",
    fires: "release-authorized",
    rationale:
      "Exchange purpose is a HIPAA §164.506 TPO exception (treatment / payment / operations) — consent-not-required; release authorized under HIPAA + the TEFCA Common Agreement.",
    synthetic: true
  },
  {
    id: "rule.non-tpo-consented-release",
    label: "Non-TPO purpose with consent — release authorized",
    fires: "release-authorized",
    rationale:
      "Exchange purpose is non-TPO but the patient has an active consent scope on file for this purpose (patient-request / public-health / research) — release authorized under HIPAA + the recorded consent.",
    synthetic: true
  },
  {
    id: "rule.non-tpo-consent-missing",
    label: "Non-TPO purpose without consent — blocked",
    fires: "blocked-consent-required-non-tpo",
    rationale:
      "Exchange purpose is non-TPO and no consent scope is on file — blocked; releasing PHI for a non-TPO purpose without explicit patient consent is a HIPAA §164.506 violation. Route to Consent & Preferences Management to capture the missing consent.",
    synthetic: true
  },
  {
    id: "rule.non-catalog-purpose",
    label: "Non-catalog exchange purpose — blocked",
    fires: "blocked-non-catalog-purpose",
    rationale:
      "The exchange cites a purpose outside EXCHANGE_PURPOSES — blocked; a bespoke exchange purpose doesn't map to a HIPAA disclosure permission and would open the network to unauthorized aggregation.",
    synthetic: true
  },
  {
    id: "rule.participant-unverified",
    label: "Requester participant identity unverified — blocked",
    fires: "blocked-participant-unverified",
    rationale:
      "The requester is not identity-verified against the TEFCA / Carequality / CommonWell participant registry — blocked; under 45 CFR 171 + the TEFCA Common Agreement a QHIN / participant / sub-participant must be identity-attested before a cross-org exchange is authorized.",
    synthetic: true
  }
];

const RULE_BY_ID = new Map<string, DataSharingRule>(
  DATA_SHARING_RULES.map((r) => [r.id, r])
);

export function isDataSharingRule(id: unknown): boolean {
  return typeof id === "string" && RULE_BY_ID.has(id);
}

export function getDataSharingRule(id: string): DataSharingRule | undefined {
  return RULE_BY_ID.get(id);
}

/** Reason codes for the decision. */
export const DATA_SHARING_REASON_CODES = [
  {
    id: "reason.DS-100",
    label: "DS-100 — TPO release authorized (no consent required)",
    synthetic: true
  },
  {
    id: "reason.DS-101",
    label: "DS-101 — Non-TPO release with consent on file",
    synthetic: true
  },
  {
    id: "reason.DS-200",
    label: "DS-200 — Non-TPO release blocked — no consent on file",
    synthetic: true
  },
  {
    id: "reason.DS-300",
    label: "DS-300 — Non-catalog exchange purpose — blocked",
    synthetic: true
  },
  {
    id: "reason.DS-400",
    label: "DS-400 — Requester participant identity unverified — blocked",
    synthetic: true
  }
] as const;

const REASON_BY_ID = new Map<string, (typeof DATA_SHARING_REASON_CODES)[number]>(
  DATA_SHARING_REASON_CODES.map((r) => [r.id, r])
);

export function isDataSharingReasonCode(id: unknown): boolean {
  return typeof id === "string" && REASON_BY_ID.has(id);
}

export type DataSharingRequest = {
  requestRef: string;
  patientRef: string;
  requesterRef: string;
  networkId: string;
  purposeId: string;
  /** Whether the requester's identity is attested against the participant registry. */
  requesterIdentityVerified: boolean;
  /**
   * The patient's consent scopes on file — a set of purpose ids for which
   * an active consent scope exists (illustrative; production defers to the
   * Consent & Preferences Management agent).
   */
  consentedPurposeIds: readonly string[];
  /** ISO asOfDate accepted as data. */
  asOfDate: string;
};

export type AppliedDataSharingRule = {
  ruleId: string;
  ruleLabel: string;
  reasonCode: string;
  reasonLabel: string;
  detail: string;
};

export type DataSharingDecisionTier =
  | "release-authorized"
  | "pend-purpose-verification"
  | "blocked-non-catalog-purpose"
  | "blocked-participant-unverified"
  | "blocked-consent-required-non-tpo";

export type DataSharingRoute =
  | "auto-release"
  | "privacy-officer-review"
  | "consent-capture"
  | "participant-registry-verification"
  | "blocked-hold";

export type DataSharingDecision = {
  requestRef: string;
  patientRef: string;
  requesterRef: string;
  networkId: string;
  networkLabel: string;
  purposeId: string;
  purposeLabel: string;
  isTpo: boolean;
  asOfDate: string;
  /** Copy of the request flag on the decision so participant-verified can be checked from the decision alone. */
  requesterIdentityVerified: boolean;
  /** Copy of the consent scope list on the decision so the consent-non-tpo guard can be checked from the decision alone. */
  consentedPurposeIds: readonly string[];
  decision: DataSharingDecisionTier;
  appliedRules: readonly AppliedDataSharingRule[];
  primaryReasonCode: string;
  primaryReasonLabel: string;
  routedTo: DataSharingRoute;
  requiresPrivacyOfficerCosign: boolean;
  /** Always false — the agent NEVER autonomously releases PHI for a non-TPO purpose without consent. */
  cosigned: false;
  synthetic: true;
  note: string;
};

const DECISION_RANK: Record<DataSharingDecisionTier, number> = {
  "release-authorized": 0,
  "pend-purpose-verification": 1,
  "blocked-consent-required-non-tpo": 2,
  "blocked-non-catalog-purpose": 3,
  "blocked-participant-unverified": 4
};

/**
 * Deterministically evaluate rules for a data-sharing request. Sorted by
 * rule-id ascending.
 */
export function evaluateDataSharingRules(
  req: DataSharingRequest
): readonly AppliedDataSharingRule[] {
  const rules: AppliedDataSharingRule[] = [];
  const purpose = getExchangePurpose(req.purposeId);

  // Participant identity unverified (highest priority — cannot release anything).
  if (req.requesterIdentityVerified !== true) {
    rules.push({
      ruleId: "rule.participant-unverified",
      ruleLabel: getDataSharingRule("rule.participant-unverified")!.label,
      reasonCode: "reason.DS-400",
      reasonLabel: REASON_BY_ID.get("reason.DS-400")!.label,
      detail: `requesterRef ${req.requesterRef} identity not attested against the participant registry`
    });
  }

  // Non-catalog purpose (short-circuits the purpose-based branches).
  if (!purpose) {
    rules.push({
      ruleId: "rule.non-catalog-purpose",
      ruleLabel: getDataSharingRule("rule.non-catalog-purpose")!.label,
      reasonCode: "reason.DS-300",
      reasonLabel: REASON_BY_ID.get("reason.DS-300")!.label,
      detail: `purposeId ${req.purposeId} is not on EXCHANGE_PURPOSES`
    });
    return [...rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  }

  // Purpose-based branch (only when identity is verified).
  if (rules.length === 0) {
    if (purpose.isTpo) {
      rules.push({
        ruleId: "rule.tpo-release-authorized",
        ruleLabel: getDataSharingRule("rule.tpo-release-authorized")!.label,
        reasonCode: "reason.DS-100",
        reasonLabel: REASON_BY_ID.get("reason.DS-100")!.label,
        detail: `${purpose.label} — TPO exception applies (no consent required)`
      });
    } else {
      const hasConsent = req.consentedPurposeIds.includes(req.purposeId);
      if (hasConsent) {
        rules.push({
          ruleId: "rule.non-tpo-consented-release",
          ruleLabel: getDataSharingRule("rule.non-tpo-consented-release")!.label,
          reasonCode: "reason.DS-101",
          reasonLabel: REASON_BY_ID.get("reason.DS-101")!.label,
          detail: `${purpose.label} — active consent scope on file`
        });
      } else {
        rules.push({
          ruleId: "rule.non-tpo-consent-missing",
          ruleLabel: getDataSharingRule("rule.non-tpo-consent-missing")!.label,
          reasonCode: "reason.DS-200",
          reasonLabel: REASON_BY_ID.get("reason.DS-200")!.label,
          detail: `${purpose.label} — no consent scope on file`
        });
      }
    }
  }

  return [...rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/** Summarize applied rules into a decision tier. */
export function summarizeDataSharingDecision(
  rules: readonly AppliedDataSharingRule[]
): {
  decision: DataSharingDecisionTier;
  primaryReasonCode: string;
  primaryReasonLabel: string;
  routedTo: DataSharingRoute;
} {
  if (rules.length === 0) {
    return {
      decision: "pend-purpose-verification",
      primaryReasonCode: "reason.DS-200",
      primaryReasonLabel: REASON_BY_ID.get("reason.DS-200")!.label,
      routedTo: "privacy-officer-review"
    };
  }
  let bestDecision: DataSharingDecisionTier = "release-authorized";
  let bestReasonCode: string = "reason.DS-100";
  let bestReasonLabel: string = REASON_BY_ID.get("reason.DS-100")!.label;
  for (const r of rules) {
    const rule = getDataSharingRule(r.ruleId);
    if (!rule) continue;
    if (DECISION_RANK[rule.fires] > DECISION_RANK[bestDecision]) {
      bestDecision = rule.fires;
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    } else if (
      bestDecision === "release-authorized" &&
      rule.fires === "release-authorized"
    ) {
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    }
  }
  const routedTo: DataSharingRoute =
    bestDecision === "blocked-participant-unverified"
      ? "participant-registry-verification"
      : bestDecision === "blocked-consent-required-non-tpo"
      ? "consent-capture"
      : bestDecision === "blocked-non-catalog-purpose"
      ? "blocked-hold"
      : bestDecision === "pend-purpose-verification"
      ? "privacy-officer-review"
      : "auto-release";
  return {
    decision: bestDecision,
    primaryReasonCode: bestReasonCode,
    primaryReasonLabel: bestReasonLabel,
    routedTo
  };
}

/** Deterministically produce the data-sharing decision. */
export function evaluateDataSharing(req: DataSharingRequest): DataSharingDecision {
  const network = getExchangeNetwork(req.networkId);
  const purpose = getExchangePurpose(req.purposeId);
  const rules = evaluateDataSharingRules(req);
  const { decision, primaryReasonCode, primaryReasonLabel, routedTo } =
    summarizeDataSharingDecision(rules);
  const requiresPrivacyOfficerCosign = decision !== "release-authorized";
  const isTpo = purpose?.isTpo ?? false;

  const note =
    decision === "release-authorized"
      ? `Release authorized: ${purpose?.label ?? req.purposeId} over ${network?.label ?? req.networkId}. ${isTpo ? "TPO exception — consent not required." : "Non-TPO purpose with active consent scope on file."}`
      : decision === "blocked-consent-required-non-tpo"
      ? `BLOCKED — ${purpose?.label ?? req.purposeId} is non-TPO and no consent scope is on file (HIPAA §164.506 violation). Route to consent-capture.`
      : decision === "blocked-non-catalog-purpose"
      ? `BLOCKED — off-catalog exchange purpose ${req.purposeId}. Route to blocked-hold.`
      : decision === "blocked-participant-unverified"
      ? `BLOCKED — requester ${req.requesterRef} identity not attested against participant registry (45 CFR 171 / TEFCA Common Agreement). Route to participant-registry-verification.`
      : `PENDING — routed to privacy-officer for review. ${rules.length} rule${rules.length === 1 ? "" : "s"} fired.`;

  return {
    requestRef: req.requestRef,
    patientRef: req.patientRef,
    requesterRef: req.requesterRef,
    networkId: req.networkId,
    networkLabel: network?.label ?? "(off-catalog)",
    purposeId: req.purposeId,
    purposeLabel: purpose?.label ?? "(off-catalog)",
    isTpo,
    asOfDate: req.asOfDate,
    requesterIdentityVerified: req.requesterIdentityVerified,
    consentedPurposeIds: req.consentedPurposeIds,
    decision,
    appliedRules: rules,
    primaryReasonCode,
    primaryReasonLabel,
    routedTo,
    requiresPrivacyOfficerCosign,
    cosigned: false,
    synthetic: true,
    note
  };
}

/** Purpose-catalog check. True when purpose + network + rule + reason ids are all catalog-sourced. */
export function purposesTraceToCatalog(
  input:
    | {
        purposeId?: string;
        networkId?: string;
        appliedRules?: ReadonlyArray<{ ruleId?: string; reasonCode?: string }>;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  if (!isExchangePurpose(input.purposeId)) return false;
  if (!isExchangeNetwork(input.networkId)) return false;
  const rules = input.appliedRules ?? [];
  if (!Array.isArray(rules)) return false;
  return rules.every(
    (r) => isDataSharingRule(r.ruleId) && isDataSharingReasonCode(r.reasonCode)
  );
}

/** Non-TPO consent check. True when a non-TPO release has consent OR the decision is safely blocked. */
export function releaseHonorsNonTpoConsent(
  input:
    | {
        decision?: string;
        purposeId?: string;
        isTpo?: boolean;
        consentedPurposeIds?: readonly string[];
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  // Blocked-consent-required-non-tpo is the SAFE ANSWER.
  if (input.decision === "blocked-consent-required-non-tpo") return true;
  // If not a release, the invariant is trivially satisfied (no PHI leaves).
  if (input.decision !== "release-authorized") return true;
  // A TPO release doesn't need consent.
  if (input.isTpo === true) return true;
  // Non-TPO release: consent must be on file for the exact purpose.
  const consented = input.consentedPurposeIds ?? [];
  if (!Array.isArray(consented)) return false;
  return typeof input.purposeId === "string" && consented.includes(input.purposeId);
}

/** Participant-verified check. True when identity is verified OR the decision is safely blocked. */
export function participantIdentityVerified(
  input:
    | {
        decision?: string;
        requesterIdentityVerified?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  if (input.decision === "blocked-participant-unverified") return true; // safe path
  return input.requesterIdentityVerified === true;
}

// Illustrative demo requests.

export const DEMO_DS_TPO_TREATMENT: DataSharingRequest = {
  requestRef: "ds-req-2026-07-001",
  patientRef: "patient-001",
  requesterRef: "provider-hospital-A",
  networkId: "network.tefca-qhin",
  purposeId: "purpose.treatment",
  requesterIdentityVerified: true,
  consentedPurposeIds: [],
  asOfDate: "2026-07-05"
};

export const DEMO_DS_NON_TPO_CONSENTED: DataSharingRequest = {
  requestRef: "ds-req-2026-07-002",
  patientRef: "patient-002",
  requesterRef: "researcher-university-B",
  networkId: "network.carequality",
  purposeId: "purpose.research",
  requesterIdentityVerified: true,
  consentedPurposeIds: ["purpose.research"],
  asOfDate: "2026-07-05"
};

export const DEMO_DS_NON_TPO_NO_CONSENT: DataSharingRequest = {
  requestRef: "ds-req-2026-07-003",
  patientRef: "patient-003",
  requesterRef: "researcher-university-C",
  networkId: "network.carequality",
  purposeId: "purpose.research",
  requesterIdentityVerified: true,
  consentedPurposeIds: [],
  asOfDate: "2026-07-05"
};

export const DEMO_DS_UNVERIFIED_PARTICIPANT: DataSharingRequest = {
  requestRef: "ds-req-2026-07-004",
  patientRef: "patient-004",
  requesterRef: "requester-unknown-D",
  networkId: "network.commonwell",
  purposeId: "purpose.treatment",
  requesterIdentityVerified: false,
  consentedPurposeIds: [],
  asOfDate: "2026-07-05"
};

export const DEMO_DS_PATIENT_ACCESS: DataSharingRequest = {
  requestRef: "ds-req-2026-07-005",
  patientRef: "patient-005",
  requesterRef: "patient-app-E",
  networkId: "network.direct-secure-messaging",
  purposeId: "purpose.patient-request",
  requesterIdentityVerified: true,
  consentedPurposeIds: ["purpose.patient-request"],
  asOfDate: "2026-07-05"
};
