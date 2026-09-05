/**
 * Controlled Substance / PDMP Safety Check — the deterministic, transparent clinical-decision
 * layer that screens a proposed controlled-substance prescription against the patient's PDMP
 * (Prescription Drug Monitoring Program) history: it deterministically SUMS the total opioid
 * dose in MME/day (morphine milligram equivalents), detects a concurrent opioid + benzodiazepine
 * combination and multiple-prescriber / multiple-pharmacy patterns, compares the total against
 * recorded CDC guideline thresholds, and hands back an honest risk finding — never autonomously
 * approving, denying, or writing the prescription.
 *
 * Deterministic, dependency-free domain core the Controlled Substance Agent
 * (app/api/agents/controlled-substance) wraps — a clinical-decision service on the patient &
 * clinical plane of Pause's Agent Fabric. Given a proposed controlled-substance prescription (a
 * drug, its class, its dose in MME/day, days supply, prescriber, pharmacy) and the patient's
 * active PDMP history (each prescription with its class, MME/day, prescriber, and pharmacy), it
 * DETERMINISTICALLY computes the total opioid MME/day (proposed + concurrent), flags a concurrent
 * opioid+benzodiazepine combination and multi-prescriber / multi-pharmacy patterns, compares the
 * total against the cited guideline's caution (50 MME/day) and high-risk (90 MME/day) thresholds,
 * and classifies the risk (low / elevated / high).
 *
 *   Inbound:  a ControlledSubstanceRequest { requestRef, guidelineId, proposed, pdmpHistory[] }
 *   Outbound: a ControlledSubstanceDetermination { totalMmePerDay, concurrentOpioidBenzo,
 *             distinctPrescribers, distinctPharmacies, riskLevel, riskFactors[], disposition,
 *             requiresPrescriberReview, autoDecision:false, reason, synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other clinical / medication agents: distinct from
 * the Formulary & DUR Review agent (plan-level coverage, step therapy, and drug-utilization-review
 * alerts), the Medication Adherence agent (whether the patient is taking an already-prescribed
 * drug), the Prior Authorization agent (assembling a payer PA package), and the Immunization
 * Forecasting agent (vaccine schedule): this screens one narrow, safety-critical question — is the
 * TOTAL controlled-substance burden across ALL prescribers safe, per the PDMP.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every risk threshold cites a recorded guideline.
 * ─────────────────────────────────────────────────────────────────────
 *  A risk finding must cite a recorded controlled-substance guideline from the catalog (the
 *  CDC-2022-style MME thresholds) — an ad-hoc / un-sourced threshold (a missing or off-catalog
 *  guideline id) is not a real clinical standard. controlledSubstanceGuidelineSourced() reports
 *  the honest signal the Agent Fabric enforces via policy.controlledsubstance.guideline-sourced.
 *  (Mirrors the Immunization Agent's schedule-sourced and the Lab Result Agent's
 *  reference-range-sourced posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the total MME/day is computed, never guessed.
 * ─────────────────────────────────────────────────────────────────────
 *  The total opioid MME/day must equal the proposed opioid contribution + the concurrent opioid
 *  MME/day — a determination whose stated total does not match the recomputed sum is guessing (or
 *  hiding) the dose, which is how an over-threshold prescription is wrongly called safe.
 *  controlledSubstanceMmeComputed() recomputes the total from the determination's own fields and
 *  reports the honest signal the Agent Fabric enforces via policy.controlledsubstance.mme-computed.
 *  (This is the load-bearing correctness gate — mirrors the Timely Filing Agent's deadline-computed
 *  and the Good Faith Estimate Agent's math-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the agent never makes an autonomous prescribing decision.
 * ─────────────────────────────────────────────────────────────────────
 *  A controlled-substance risk finding is a RECOMMENDATION requiring prescriber review — the
 *  agent NEVER autonomously approves, denies, dispenses, or writes the prescription. A
 *  determination that auto-decides (autoDecision:true), or that reports an elevated / high-risk
 *  finding without requiring prescriber review, is dishonest and dangerous.
 *  controlledSubstanceNoAutonomousDecision() reports the honest signal the Agent Fabric enforces
 *  via policy.controlledsubstance.no-autonomous-prescribing-decision. (Mirrors the Immunization
 *  Agent's no-autonomous-administration and the Lab Result Agent's no-autonomous-clinical-action
 *  posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE DETERMINATION vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A determination — low OR high risk — is a SAFE, honest OUTPUT: the task COMPLETES (an elevated
 *  / high-risk finding carries requiresPrescriberReview:true). A GOVERNANCE BLOCK is when a caller
 *  PRESENTS an offending DETERMINATION (an un-sourced guideline, a guessed MME total that does not
 *  match the computed sum, or an auto-decided / unreviewed high-risk finding) — which the Agent
 *  Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified PDMP / clinical decision support system.
 * ─────────────────────────────────────────────────────────────────────
 *  The guideline thresholds, MME/day figures, and drug classes below are clearly-labeled
 *  ILLUSTRATIVE synthetics chosen to model the SHAPE of controlled-substance safety screening
 *  deterministically in the demo — they are NOT a certified PDMP, NOT the actual MME conversion
 *  factors, and NOT clinical advice. Real controlled-substance monitoring uses the state PDMP, the
 *  CDC MME conversion factors, the CDC 2022 Clinical Practice Guideline for Prescribing Opioids,
 *  and the prescriber's full clinical judgment. There is NO randomness and NO clock anywhere here:
 *  the risk finding is a pure function of the request's own data (no Date.now()), so the same
 *  request always yields the same total / risk / disposition — which is what lets the demo, the
 *  seeded trace, and the tests agree.
 */

/** A controlled-substance drug class (illustrative). */
export type DrugClass = "opioid" | "benzodiazepine" | "stimulant" | "other";

/** A controlled-substance risk level. */
export type ControlledSubstanceRiskLevel = "low" | "elevated" | "high";

/** The disposition for a proposed prescription after the risk screen. */
export type ControlledSubstanceDisposition = "proceed-low-risk" | "prescriber-review";

/** A recorded controlled-substance guideline (MME thresholds). */
export type ControlledSubstanceGuideline = {
  /** Stable guideline id. */
  id: string;
  /** The caution threshold in MME/day (reassess / caution at or above this). */
  cautionMme: number;
  /** The high-risk threshold in MME/day (avoid / justify at or above this). */
  highRiskMme: number;
  /** Human-readable description. */
  description: string;
};

/**
 * ILLUSTRATIVE, synthetic guideline catalog — clearly labeled, NOT the actual CDC guideline. The
 * 50 / 90 MME/day thresholds model the shape of the CDC 2022 opioid-prescribing guidance.
 */
export const CONTROLLED_SUBSTANCE_GUIDELINES: ControlledSubstanceGuideline[] = [
  {
    id: "guideline.cdc-2022-mme",
    cautionMme: 50,
    highRiskMme: 90,
    description:
      "CDC-2022-style opioid MME thresholds (illustrative): reassess at ≥50 MME/day, avoid / carefully justify at ≥90 MME/day."
  }
];

/** Look up a guideline by id (undefined when off-catalog). */
export function getControlledSubstanceGuideline(
  id: string
): ControlledSubstanceGuideline | undefined {
  return CONTROLLED_SUBSTANCE_GUIDELINES.find((g) => g.id === id);
}

/** A PDMP-history prescription (already active for the patient). */
export type PdmpPrescription = {
  /** Drug name. */
  drug: string;
  /** Drug class. */
  drugClass: DrugClass;
  /** Opioid dose in MME/day (0 for non-opioids). */
  mmePerDay: number;
  /** Prescriber id / name. */
  prescriber: string;
  /** Dispensing pharmacy id / name. */
  pharmacy: string;
};

/** A proposed controlled-substance prescription being screened. */
export type ProposedPrescription = {
  /** Drug name. */
  drug: string;
  /** Drug class. */
  drugClass: DrugClass;
  /** Opioid dose in MME/day (0 for non-opioids). */
  mmePerDay: number;
  /** Days supply. */
  daysSupply: number;
  /** Prescriber id / name. */
  prescriber: string;
  /** Dispensing pharmacy id / name. */
  pharmacy: string;
};

/** A controlled-substance screening request. */
export type ControlledSubstanceRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** The cited guideline id. */
  guidelineId: string;
  /** The proposed prescription. */
  proposed: ProposedPrescription;
  /** The patient's active PDMP history. */
  pdmpHistory: PdmpPrescription[];
};

/** The deterministic controlled-substance determination the agent returns. */
export type ControlledSubstanceDetermination = {
  /** Synthetic request reference. */
  requestRef: string;
  /** The cited guideline id. */
  guidelineId: string;
  /** The caution threshold in MME/day (from the cited guideline; 0 when off-catalog). */
  cautionMme: number;
  /** The high-risk threshold in MME/day (from the cited guideline; 0 when off-catalog). */
  highRiskMme: number;
  /** The proposed prescription's opioid contribution in MME/day (0 when not an opioid). */
  proposedOpioidMmePerDay: number;
  /** The sum of the concurrent active opioids' MME/day. */
  concurrentOpioidMmePerDay: number;
  /** The total opioid MME/day (proposed + concurrent). */
  totalMmePerDay: number;
  /** Whether an opioid and a benzodiazepine are concurrently present. */
  concurrentOpioidBenzo: boolean;
  /** The number of distinct prescribers across the proposed + active history. */
  distinctPrescribers: number;
  /** The number of distinct pharmacies across the proposed + active history. */
  distinctPharmacies: number;
  /** Whether the total meets / exceeds the caution threshold. */
  exceedsCaution: boolean;
  /** Whether the total meets / exceeds the high-risk threshold. */
  exceedsHighRisk: boolean;
  /** The classified risk level. */
  riskLevel: ControlledSubstanceRiskLevel;
  /** Human-readable risk factors. */
  riskFactors: string[];
  /** The disposition. */
  disposition: ControlledSubstanceDisposition;
  /** Whether the determination requires prescriber review (any elevated / high finding). */
  requiresPrescriberReview: boolean;
  /** Always false — the agent never makes an autonomous prescribing decision. */
  autoDecision: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the thresholds / MME figures are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

function distinctCount(values: string[]): number {
  return new Set(values.filter((v) => typeof v === "string" && v.length > 0)).size;
}

/**
 * The deterministic controlled-substance function — the heart of the service. DETERMINISTIC: a
 * pure function of the request's data + the cited guideline (no randomness, no clock). It sums the
 * total opioid MME/day (proposed opioid contribution + concurrent active opioids), flags a
 * concurrent opioid+benzodiazepine combination and multi-prescriber / multi-pharmacy patterns,
 * compares the total against the guideline thresholds, and classifies the risk. Nothing is
 * approved or denied here — an elevated / high finding is a recommendation requiring prescriber
 * review.
 */
export function evaluateControlledSubstance(
  request: ControlledSubstanceRequest
): ControlledSubstanceDetermination {
  const guideline = getControlledSubstanceGuideline(request.guidelineId);
  const cautionMme = guideline?.cautionMme ?? 0;
  const highRiskMme = guideline?.highRiskMme ?? 0;

  const history = Array.isArray(request.pdmpHistory) ? request.pdmpHistory : [];
  const proposed = request.proposed;

  const proposedIsOpioid = proposed.drugClass === "opioid";
  const proposedOpioidMmePerDay = proposedIsOpioid ? proposed.mmePerDay : 0;

  const concurrentOpioids = history.filter((h) => h.drugClass === "opioid");
  const concurrentOpioidMmePerDay = concurrentOpioids.reduce((sum, h) => sum + h.mmePerDay, 0);
  const totalMmePerDay = proposedOpioidMmePerDay + concurrentOpioidMmePerDay;

  const opioidPresent = proposedIsOpioid || concurrentOpioids.length > 0;
  const benzoPresent =
    proposed.drugClass === "benzodiazepine" ||
    history.some((h) => h.drugClass === "benzodiazepine");
  const concurrentOpioidBenzo = opioidPresent && benzoPresent;

  const distinctPrescribers = distinctCount([
    proposed.prescriber,
    ...history.map((h) => h.prescriber)
  ]);
  const distinctPharmacies = distinctCount([
    proposed.pharmacy,
    ...history.map((h) => h.pharmacy)
  ]);

  const exceedsCaution = cautionMme > 0 && totalMmePerDay >= cautionMme;
  const exceedsHighRisk = highRiskMme > 0 && totalMmePerDay >= highRiskMme;

  const riskFactors: string[] = [];
  if (exceedsHighRisk) {
    riskFactors.push(`total ${totalMmePerDay} MME/day ≥ high-risk threshold (${highRiskMme})`);
  } else if (exceedsCaution) {
    riskFactors.push(`total ${totalMmePerDay} MME/day ≥ caution threshold (${cautionMme})`);
  }
  if (concurrentOpioidBenzo) {
    riskFactors.push("concurrent opioid + benzodiazepine (respiratory-depression risk)");
  }
  if (distinctPrescribers >= 3) {
    riskFactors.push(`${distinctPrescribers} distinct prescribers (multiple-provider pattern)`);
  }
  if (distinctPharmacies >= 3) {
    riskFactors.push(`${distinctPharmacies} distinct pharmacies (multiple-pharmacy pattern)`);
  }

  const isHigh =
    exceedsHighRisk ||
    concurrentOpioidBenzo ||
    distinctPrescribers >= 3 ||
    distinctPharmacies >= 3;
  const isElevated = exceedsCaution || distinctPrescribers >= 2 || distinctPharmacies >= 2;
  const riskLevel: ControlledSubstanceRiskLevel = isHigh
    ? "high"
    : isElevated
      ? "elevated"
      : "low";

  if (riskLevel !== "low" && riskFactors.length === 0) {
    // An elevated finding from a multi-prescriber/pharmacy pattern below 3.
    if (distinctPrescribers >= 2) {
      riskFactors.push(`${distinctPrescribers} distinct prescribers`);
    }
    if (distinctPharmacies >= 2) {
      riskFactors.push(`${distinctPharmacies} distinct pharmacies`);
    }
  }

  const disposition: ControlledSubstanceDisposition =
    riskLevel === "low" ? "proceed-low-risk" : "prescriber-review";
  const requiresPrescriberReview = riskLevel !== "low";

  const reason = !guideline
    ? `Request ${request.requestRef}: guideline '${request.guidelineId}' is not in the catalog — cannot establish thresholds; prescriber review required`
    : riskLevel === "low"
      ? `Request ${request.requestRef}: LOW risk — total ${totalMmePerDay} MME/day below the ${cautionMme} caution threshold, no concurrent opioid+benzo, single-prescriber pattern; informational (no autonomous approval)`
      : `Request ${request.requestRef}: ${riskLevel.toUpperCase()} risk — ${riskFactors.join("; ")} → prescriber review required (NOT auto-approved or auto-denied)`;

  return {
    requestRef: request.requestRef,
    guidelineId: request.guidelineId,
    cautionMme,
    highRiskMme,
    proposedOpioidMmePerDay,
    concurrentOpioidMmePerDay,
    totalMmePerDay,
    concurrentOpioidBenzo,
    distinctPrescribers,
    distinctPharmacies,
    exceedsCaution,
    exceedsHighRisk,
    riskLevel,
    riskFactors,
    disposition,
    requiresPrescriberReview,
    autoDecision: false,
    reason,
    synthetic: true,
    note:
      `Controlled-substance PDMP screen for ${request.requestRef}: total ${totalMmePerDay} MME/day (proposed ${proposedOpioidMmePerDay} + concurrent ${concurrentOpioidMmePerDay}), opioid+benzo=${concurrentOpioidBenzo}, ${distinctPrescribers} prescriber(s) / ${distinctPharmacies} pharmacy(ies), risk=${riskLevel}, disposition ${disposition}. ` +
      "Synthetic/illustrative MME thresholds + figures — NOT a certified PDMP or clinical decision support; real monitoring uses the state PDMP, the CDC MME conversion factors, the CDC 2022 opioid-prescribing guideline, and the prescriber's clinical judgment."
  };
}

/**
 * Guideline-sourced check: does the determination cite a recorded guideline? True only when the
 * cited guideline id resolves in the catalog; the guard that catches an ad-hoc / un-sourced
 * threshold. Anything evaluateControlledSubstance() produces from a cataloged guideline satisfies
 * it. This is the honest signal the route reports to policy.controlledsubstance.guideline-sourced.
 * A non-object input is a violation.
 */
export function controlledSubstanceGuidelineSourced(
  determination: Pick<ControlledSubstanceDetermination, "guidelineId"> | null | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  return getControlledSubstanceGuideline(determination.guidelineId) !== undefined;
}

/**
 * MME-computed check: does the determination's stated total match the recomputed sum? True only
 * when totalMmePerDay === proposedOpioidMmePerDay + concurrentOpioidMmePerDay (recomputed from the
 * determination's own fields); the guard that catches a guessed / hidden dose. Anything
 * evaluateControlledSubstance() produces satisfies it. This is the honest signal the route reports
 * to policy.controlledsubstance.mme-computed. A non-object / malformed input is a violation.
 */
export function controlledSubstanceMmeComputed(
  determination:
    | Pick<
        ControlledSubstanceDetermination,
        "proposedOpioidMmePerDay" | "concurrentOpioidMmePerDay" | "totalMmePerDay"
      >
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (
    typeof determination.proposedOpioidMmePerDay !== "number" ||
    typeof determination.concurrentOpioidMmePerDay !== "number" ||
    typeof determination.totalMmePerDay !== "number"
  ) {
    return false;
  }
  return (
    determination.proposedOpioidMmePerDay + determination.concurrentOpioidMmePerDay ===
    determination.totalMmePerDay
  );
}

/**
 * No-autonomous-prescribing-decision check: did the agent avoid an autonomous prescribing
 * decision? True unless the determination auto-decides (autoDecision:true), or reports an elevated
 * / high-risk finding without requiring prescriber review; the guard that catches an autonomous /
 * unreviewed prescribing decision. Anything evaluateControlledSubstance() produces satisfies it
 * (autoDecision is always false; an elevated / high finding requires review). This is the honest
 * signal the route reports to policy.controlledsubstance.no-autonomous-prescribing-decision. A
 * non-object input is a violation.
 */
export function controlledSubstanceNoAutonomousDecision(
  determination:
    | { autoDecision?: boolean; riskLevel?: ControlledSubstanceRiskLevel; requiresPrescriberReview?: boolean }
    | null
    | undefined
): boolean {
  if (!determination || typeof determination !== "object") return false;
  if (determination.autoDecision === true) return false;
  if (
    (determination.riskLevel === "elevated" || determination.riskLevel === "high") &&
    determination.requiresPrescriberReview === false
  ) {
    return false;
  }
  return true;
}

/**
 * A compact, trace-safe summary of a determination — the shape stamped onto the Agent Fabric
 * trace + the response `meta`.
 */
export function controlledSubstanceSummary(determination: ControlledSubstanceDetermination): {
  requestRef: string;
  guidelineId: string;
  totalMmePerDay: number;
  concurrentOpioidBenzo: boolean;
  distinctPrescribers: number;
  distinctPharmacies: number;
  riskLevel: ControlledSubstanceRiskLevel;
  disposition: ControlledSubstanceDisposition;
  requiresPrescriberReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: determination.requestRef,
    guidelineId: determination.guidelineId,
    totalMmePerDay: determination.totalMmePerDay,
    concurrentOpioidBenzo: determination.concurrentOpioidBenzo,
    distinctPrescribers: determination.distinctPrescribers,
    distinctPharmacies: determination.distinctPharmacies,
    riskLevel: determination.riskLevel,
    disposition: determination.disposition,
    requiresPrescriberReview: determination.requiresPrescriberReview,
    synthetic: determination.synthetic
  };
}

/**
 * A representative demo request: a modest opioid with no concurrent controlled substances →
 * low risk / proceed (informational). Synthetic.
 */
export const DEMO_CONTROLLED_SUBSTANCE_REQUEST: ControlledSubstanceRequest = {
  requestRef: "cs-request-001",
  guidelineId: "guideline.cdc-2022-mme",
  proposed: {
    drug: "hydrocodone/acetaminophen 5-325",
    drugClass: "opioid",
    mmePerDay: 30,
    daysSupply: 5,
    prescriber: "dr-alpha",
    pharmacy: "pharmacy-main"
  },
  pdmpHistory: []
};

/**
 * A representative demo request: a proposed opioid on top of a concurrent opioid pushing the total
 * over the 90 MME/day high-risk threshold → high risk / prescriber review. Synthetic.
 */
export const DEMO_CONTROLLED_SUBSTANCE_HIGH_MME_REQUEST: ControlledSubstanceRequest = {
  requestRef: "cs-request-002",
  guidelineId: "guideline.cdc-2022-mme",
  proposed: {
    drug: "oxycodone 15",
    drugClass: "opioid",
    mmePerDay: 60,
    daysSupply: 30,
    prescriber: "dr-alpha",
    pharmacy: "pharmacy-main"
  },
  pdmpHistory: [
    {
      drug: "morphine ER 30",
      drugClass: "opioid",
      mmePerDay: 40,
      prescriber: "dr-alpha",
      pharmacy: "pharmacy-main"
    }
  ]
};

/**
 * A representative demo request: a proposed opioid with a concurrent benzodiazepine → high risk
 * (respiratory-depression combination) / prescriber review. Synthetic.
 */
export const DEMO_CONTROLLED_SUBSTANCE_OPIOID_BENZO_REQUEST: ControlledSubstanceRequest = {
  requestRef: "cs-request-003",
  guidelineId: "guideline.cdc-2022-mme",
  proposed: {
    drug: "hydrocodone 10",
    drugClass: "opioid",
    mmePerDay: 30,
    daysSupply: 30,
    prescriber: "dr-alpha",
    pharmacy: "pharmacy-main"
  },
  pdmpHistory: [
    {
      drug: "alprazolam 1",
      drugClass: "benzodiazepine",
      mmePerDay: 0,
      prescriber: "dr-beta",
      pharmacy: "pharmacy-main"
    }
  ]
};
