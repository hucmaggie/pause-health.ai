/**
 * Provider Contracting & Value-Based-Care Terms — deterministic classification
 * of provider-network contracts, computation of the VBC quality-gate +
 * spend-benchmark for a reporting period, and account-owner cosign for any
 * contract-term change.
 *
 * Deterministic, dependency-free domain core the Provider Contracting Agent
 * (app/api/agents/provider-contracting) wraps — the Salesforce "Agentforce
 * for Health" / Health Cloud contracting analog on Pause's Agent Fabric.
 * Sits alongside the Quality-Measure Attribution agent (which decides whose
 * panel a patient counts on) and the HEDIS & Quality Reporting agent (which
 * scores measures against a contract's methodology) — this one handles the
 * CONTRACT ITSELF: classifying the payment model, computing the quality
 * gate + spend benchmark for the reporting period, and drafting term-change
 * proposals that a human account owner must sign off on.
 *
 *   Inbound:  ProviderContractRequest (a synthetic providerRef + contractRef,
 *             contractType, payment model, methodology id, reporting-period
 *             ISO dates, aggregate quality-gate + spend inputs, requested
 *             term-change flag)
 *   Outbound: ProviderContractDecision { requestRef, decision:
 *             'in-good-standing' | 'benchmark-drift-review' | 'draft-term-change' |
 *             'blocked-non-catalog-contract', appliedRules[],
 *             qualityGateMet, spendBenchmarkCents, actualSpendCents,
 *             primaryReasonCode, routedTo, requiresAccountOwnerCosign,
 *             cosigned:false, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: contract types + methodologies trace to catalog.
 * ─────────────────────────────────────────────────────────────────────
 *  Every classified contract must cite a contractType from the defined
 *  CONTRACT_TYPES catalog (fee-for-service, capitation, shared-savings,
 *  bundled-payment, MA-value-based, commercial-VBC), a methodology from
 *  BENCHMARK_METHODOLOGIES, and applied rules from CONTRACTING_RULES.
 *  An ad-hoc "we-made-up-a-payment-model" contract fails.
 *  contractsTraceToCatalog() reports the honest signal the Agent Fabric
 *  enforces via policy.contracting.contract-type-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: no autonomous contract-term change.
 * ─────────────────────────────────────────────────────────────────────
 *  A contract-term change (rate change, quality-gate threshold, benchmark
 *  formula, network status) is legally consequential (state insurance code,
 *  provider-contract law, CMS Medicare Advantage) and requires a human
 *  account owner's sign-off. Every draft-term-change decision is
 *  requiresAccountOwnerCosign:true / cosigned:false; a caller-asserted
 *  plan that claims cosigned:true or bypasses the cosign gate is a
 *  violation. Mirrors the Claims Adjudication Agent's no-autonomous-
 *  denial, the Formulary Agent's no-autonomous-override, the FWA Agent's
 *  no-autonomous-denial, the Trial Payments Agent's no-autonomous-irb-
 *  deviation, the Utilization Review Agent's no-autonomous-denial, and
 *  the Account Management Agent's human-owner-before-contract-change
 *  posture. contractChangeRequiresOwnerCosign() reports the honest signal
 *  the Agent Fabric enforces via policy.contracting.no-autonomous-term-change.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: benchmark computation traces to methodology.
 * ─────────────────────────────────────────────────────────────────────
 *  The quality-gate threshold and spend-benchmark on a VBC contract must
 *  come from the defined BENCHMARK_METHODOLOGIES catalog + the contract's
 *  reporting period — a bespoke / off-catalog / opaque "we-picked-a-number"
 *  benchmark polluts every downstream shared-savings / bonus / clawback
 *  calculation. benchmarksTraceToMethodology() reports the honest signal
 *  the Agent Fabric enforces via policy.contracting.benchmark-methodology-catalog-sourced.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified contracting engine.
 * ─────────────────────────────────────────────────────────────────────
 *  The contract-type catalog, payment-model shapes, benchmark methodologies,
 *  and reporting-period rules below are ILLUSTRATIVE synthetic/demo values
 *  that model the SHAPE of a provider-contracting workflow — they are NOT
 *  Salesforce Health Cloud Provider Network Management, Optum Contract
 *  Manager, an actual payer's contract-lifecycle system, or a certified
 *  VBC benchmarking engine. The providerRefs, contractRefs, and dollar
 *  amounts are synthetic / de-identified. There is NO randomness and NO
 *  clock anywhere here: contracting is a pure function of the request +
 *  catalog + caller-provided reporting-period.
 */

/** A single contract type in the illustrative catalog. */
export type ContractType = {
  id: string;
  label: string;
  /** Whether this type has a VBC quality-gate + spend-benchmark shape. */
  isValueBased: boolean;
  synthetic: true;
};

export const CONTRACT_TYPES: ContractType[] = [
  {
    id: "contract-type.fee-for-service",
    label: "Fee-for-service (FFS)",
    isValueBased: false,
    synthetic: true
  },
  {
    id: "contract-type.capitation",
    label: "Capitation (per-member per-month)",
    isValueBased: false,
    synthetic: true
  },
  {
    id: "contract-type.shared-savings",
    label: "Shared savings (upside-only)",
    isValueBased: true,
    synthetic: true
  },
  {
    id: "contract-type.bundled-payment",
    label: "Bundled payment (episode-based)",
    isValueBased: true,
    synthetic: true
  },
  {
    id: "contract-type.medicare-advantage-vbc",
    label: "Medicare Advantage VBC (upside + downside)",
    isValueBased: true,
    synthetic: true
  },
  {
    id: "contract-type.commercial-vbc",
    label: "Commercial VBC (quality + spend)",
    isValueBased: true,
    synthetic: true
  }
];

const CONTRACT_TYPE_BY_ID = new Map<string, ContractType>(
  CONTRACT_TYPES.map((c) => [c.id, c])
);

export function isContractType(id: unknown): boolean {
  return typeof id === "string" && CONTRACT_TYPE_BY_ID.has(id);
}

export function getContractType(id: string): ContractType | undefined {
  return CONTRACT_TYPE_BY_ID.get(id);
}

/** A benchmark methodology in the illustrative catalog. */
export type BenchmarkMethodology = {
  id: string;
  label: string;
  /** Quality-gate threshold (0-1 fraction of measures met). */
  qualityGateThreshold: number;
  /** Spend-benchmark drift tolerance (0-1 fraction over/under benchmark). */
  spendDriftTolerance: number;
  synthetic: true;
};

export const BENCHMARK_METHODOLOGIES: BenchmarkMethodology[] = [
  {
    id: "methodology.mssp-shared-savings-my2026",
    label: "Medicare MSSP Shared Savings MY2026 (illustrative)",
    qualityGateThreshold: 0.7,
    spendDriftTolerance: 0.05,
    synthetic: true
  },
  {
    id: "methodology.ma-star-vbc-my2026",
    label: "Medicare Advantage Star VBC MY2026 (illustrative)",
    qualityGateThreshold: 0.75,
    spendDriftTolerance: 0.03,
    synthetic: true
  },
  {
    id: "methodology.commercial-vbc-my2026",
    label: "Commercial VBC MY2026 (illustrative)",
    qualityGateThreshold: 0.65,
    spendDriftTolerance: 0.05,
    synthetic: true
  },
  {
    id: "methodology.bundled-episode-flat-benchmark",
    label: "Bundled-episode flat-benchmark (illustrative)",
    qualityGateThreshold: 0.6,
    spendDriftTolerance: 0.1,
    synthetic: true
  }
];

const METHODOLOGY_BY_ID = new Map<string, BenchmarkMethodology>(
  BENCHMARK_METHODOLOGIES.map((m) => [m.id, m])
);

export function isBenchmarkMethodology(id: unknown): boolean {
  return typeof id === "string" && METHODOLOGY_BY_ID.has(id);
}

export function getBenchmarkMethodology(id: string): BenchmarkMethodology | undefined {
  return METHODOLOGY_BY_ID.get(id);
}

/** A contracting rule the engine can apply. */
export type ContractingRule = {
  id: string;
  label: string;
  fires:
    | "in-good-standing"
    | "benchmark-drift-review"
    | "draft-term-change"
    | "blocked-non-catalog-contract";
  rationale: string;
  synthetic: true;
};

export const CONTRACTING_RULES: ContractingRule[] = [
  {
    id: "rule.quality-and-spend-in-band",
    label: "Quality gate met AND spend within benchmark drift tolerance",
    fires: "in-good-standing",
    rationale:
      "The contract's quality-gate threshold is met AND actual spend is within the benchmark drift tolerance for the reporting period — the contract is in good standing at first-pass review.",
    synthetic: true
  },
  {
    id: "rule.quality-gate-missed",
    label: "Quality gate not met — route to benchmark drift review",
    fires: "benchmark-drift-review",
    rationale:
      "The contract's quality-gate threshold was not met for the reporting period — route to account-management for a benchmark-drift review; the contract may be at risk of shared-savings clawback or bonus loss.",
    synthetic: true
  },
  {
    id: "rule.spend-drift-exceeded",
    label: "Spend drift exceeded tolerance — route to benchmark drift review",
    fires: "benchmark-drift-review",
    rationale:
      "Actual spend for the reporting period drifted beyond the benchmark tolerance — route to account-management for a benchmark-drift review.",
    synthetic: true
  },
  {
    id: "rule.term-change-requested",
    label: "Contract-term change requested — draft for account-owner cosign",
    fires: "draft-term-change",
    rationale:
      "The caller requested a contract-term change (rate, quality-gate threshold, benchmark formula, network status) — DRAFT the proposal for a human account owner to review and sign off; the agent NEVER autonomously commits a contract-term change.",
    synthetic: true
  },
  {
    id: "rule.non-catalog-contract",
    label: "Non-catalog contract type — blocked at first pass",
    fires: "blocked-non-catalog-contract",
    rationale:
      "The contract cites a payment model outside the CONTRACT_TYPES catalog — blocked at first pass; a bespoke off-catalog payment model would pollute every downstream benchmarking calculation.",
    synthetic: true
  }
];

const RULE_BY_ID = new Map<string, ContractingRule>(CONTRACTING_RULES.map((r) => [r.id, r]));

export function isContractingRule(id: unknown): boolean {
  return typeof id === "string" && RULE_BY_ID.has(id);
}

export function getContractingRule(id: string): ContractingRule | undefined {
  return RULE_BY_ID.get(id);
}

/** Reason codes for the decision. */
export const CONTRACTING_REASON_CODES = [
  {
    id: "reason.PC-100",
    label: "PC-100 — Contract in good standing (quality + spend in band)",
    synthetic: true
  },
  {
    id: "reason.PC-200",
    label: "PC-200 — Quality gate missed — benchmark-drift review",
    synthetic: true
  },
  {
    id: "reason.PC-201",
    label: "PC-201 — Spend drift exceeded tolerance — benchmark-drift review",
    synthetic: true
  },
  {
    id: "reason.PC-300",
    label: "PC-300 — Term change drafted for account-owner cosign",
    synthetic: true
  },
  {
    id: "reason.PC-400",
    label: "PC-400 — Non-catalog contract type — blocked at first pass",
    synthetic: true
  }
] as const;

const REASON_BY_ID = new Map<string, (typeof CONTRACTING_REASON_CODES)[number]>(
  CONTRACTING_REASON_CODES.map((r) => [r.id, r])
);

export function isContractingReasonCode(id: unknown): boolean {
  return typeof id === "string" && REASON_BY_ID.has(id);
}

/** Structured input the contracting engine reads. */
export type ProviderContractRequest = {
  requestRef: string;
  providerRef: string;
  contractRef: string;
  contractTypeId: string;
  methodologyId: string;
  /** ISO reporting-period start. */
  reportingPeriodStart: string;
  /** ISO reporting-period end. */
  reportingPeriodEnd: string;
  /** Fraction of quality measures met (0-1). */
  qualityMeasuresMetFraction: number;
  /** Benchmark spend for the reporting period, in cents. */
  benchmarkSpendCents: number;
  /** Actual spend for the reporting period, in cents. */
  actualSpendCents: number;
  /**
   * When true, the request is a term-change proposal (rate / gate /
   * benchmark / network status) that must be drafted for cosign.
   */
  requestsTermChange?: boolean;
  /**
   * Optional term-change description (illustrative — real term-changes
   * carry a structured diff).
   */
  termChangeSummary?: string;
};

/** A single applied rule. */
export type AppliedContractingRule = {
  ruleId: string;
  ruleLabel: string;
  reasonCode: string;
  reasonLabel: string;
  detail: string;
};

/** Decision tier. */
export type ContractingDecisionTier =
  | "in-good-standing"
  | "benchmark-drift-review"
  | "draft-term-change"
  | "blocked-non-catalog-contract";

export type ContractingRoute =
  | "auto-continue"
  | "account-manager-drift-review"
  | "account-owner-cosign"
  | "blocked-hold";

export type ProviderContractDecision = {
  requestRef: string;
  providerRef: string;
  contractRef: string;
  contractTypeId: string;
  contractTypeLabel: string;
  methodologyId: string;
  methodologyLabel: string;
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  decision: ContractingDecisionTier;
  appliedRules: readonly AppliedContractingRule[];
  qualityGateMet: boolean;
  qualityMeasuresMetFraction: number;
  qualityGateThreshold: number;
  spendDriftFraction: number;
  spendDriftTolerance: number;
  benchmarkSpendCents: number;
  actualSpendCents: number;
  primaryReasonCode: string;
  primaryReasonLabel: string;
  routedTo: ContractingRoute;
  requiresAccountOwnerCosign: boolean;
  /** Always false — the agent NEVER autonomously cosigns a contract-term change. */
  cosigned: false;
  synthetic: true;
  note: string;
};

const DECISION_RANK: Record<ContractingDecisionTier, number> = {
  "in-good-standing": 0,
  "benchmark-drift-review": 1,
  "draft-term-change": 2,
  "blocked-non-catalog-contract": 3
};

/** Compute the fractional drift of actual vs benchmark spend. */
export function computeSpendDrift(
  benchmarkSpendCents: number,
  actualSpendCents: number
): number {
  if (benchmarkSpendCents <= 0) return 0;
  const drift = (actualSpendCents - benchmarkSpendCents) / benchmarkSpendCents;
  return drift;
}

/**
 * Deterministically evaluate rules for a contracting request. Sorted by
 * rule-id ascending.
 */
export function evaluateContractingRules(
  req: ProviderContractRequest
): readonly AppliedContractingRule[] {
  const rules: AppliedContractingRule[] = [];

  // Non-catalog contract short-circuits.
  if (!isContractType(req.contractTypeId)) {
    rules.push({
      ruleId: "rule.non-catalog-contract",
      ruleLabel: getContractingRule("rule.non-catalog-contract")!.label,
      reasonCode: "reason.PC-400",
      reasonLabel: REASON_BY_ID.get("reason.PC-400")!.label,
      detail: `contractTypeId ${req.contractTypeId} is not on CONTRACT_TYPES`
    });
    return [...rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  }

  const methodology = getBenchmarkMethodology(req.methodologyId);
  const contractType = getContractType(req.contractTypeId)!;

  // Term-change request — draft for cosign.
  if (req.requestsTermChange === true) {
    rules.push({
      ruleId: "rule.term-change-requested",
      ruleLabel: getContractingRule("rule.term-change-requested")!.label,
      reasonCode: "reason.PC-300",
      reasonLabel: REASON_BY_ID.get("reason.PC-300")!.label,
      detail: req.termChangeSummary ?? "term change requested by caller"
    });
  }

  if (methodology && contractType.isValueBased) {
    const qualityGateMet =
      req.qualityMeasuresMetFraction >= methodology.qualityGateThreshold;
    const drift = computeSpendDrift(req.benchmarkSpendCents, req.actualSpendCents);
    const spendDriftExceeded = Math.abs(drift) > methodology.spendDriftTolerance;

    if (!qualityGateMet) {
      rules.push({
        ruleId: "rule.quality-gate-missed",
        ruleLabel: getContractingRule("rule.quality-gate-missed")!.label,
        reasonCode: "reason.PC-200",
        reasonLabel: REASON_BY_ID.get("reason.PC-200")!.label,
        detail: `quality ${req.qualityMeasuresMetFraction.toFixed(2)} < gate ${methodology.qualityGateThreshold.toFixed(2)}`
      });
    }
    if (spendDriftExceeded) {
      rules.push({
        ruleId: "rule.spend-drift-exceeded",
        ruleLabel: getContractingRule("rule.spend-drift-exceeded")!.label,
        reasonCode: "reason.PC-201",
        reasonLabel: REASON_BY_ID.get("reason.PC-201")!.label,
        detail: `spend drift ${(drift * 100).toFixed(1)}% > tolerance ${(methodology.spendDriftTolerance * 100).toFixed(1)}%`
      });
    }

    // If no problem rules fired AND no term-change requested, mark good-standing.
    if (
      qualityGateMet &&
      !spendDriftExceeded &&
      req.requestsTermChange !== true
    ) {
      rules.push({
        ruleId: "rule.quality-and-spend-in-band",
        ruleLabel: getContractingRule("rule.quality-and-spend-in-band")!.label,
        reasonCode: "reason.PC-100",
        reasonLabel: REASON_BY_ID.get("reason.PC-100")!.label,
        detail: `quality ${req.qualityMeasuresMetFraction.toFixed(2)} ≥ gate, spend drift ${(drift * 100).toFixed(1)}% ≤ tolerance`
      });
    }
  } else if (!contractType.isValueBased && req.requestsTermChange !== true) {
    // FFS / capitation with no term change — good standing.
    rules.push({
      ruleId: "rule.quality-and-spend-in-band",
      ruleLabel: getContractingRule("rule.quality-and-spend-in-band")!.label,
      reasonCode: "reason.PC-100",
      reasonLabel: REASON_BY_ID.get("reason.PC-100")!.label,
      detail: `non-VBC ${contractType.label} — no quality gate applies`
    });
  }

  return [...rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/** Summarize applied rules into a decision tier. */
export function summarizeContractingDecision(
  rules: readonly AppliedContractingRule[]
): {
  decision: ContractingDecisionTier;
  primaryReasonCode: string;
  primaryReasonLabel: string;
  routedTo: ContractingRoute;
} {
  if (rules.length === 0) {
    return {
      decision: "in-good-standing",
      primaryReasonCode: "reason.PC-100",
      primaryReasonLabel: REASON_BY_ID.get("reason.PC-100")!.label,
      routedTo: "auto-continue"
    };
  }
  let bestDecision: ContractingDecisionTier = "in-good-standing";
  let bestReasonCode: string = "reason.PC-100";
  let bestReasonLabel: string = REASON_BY_ID.get("reason.PC-100")!.label;
  for (const r of rules) {
    const rule = getContractingRule(r.ruleId);
    if (!rule) continue;
    if (DECISION_RANK[rule.fires] > DECISION_RANK[bestDecision]) {
      bestDecision = rule.fires;
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    } else if (
      bestDecision === "in-good-standing" &&
      rule.fires === "in-good-standing"
    ) {
      bestReasonCode = r.reasonCode;
      bestReasonLabel = r.reasonLabel;
    }
  }
  const routedTo: ContractingRoute =
    bestDecision === "blocked-non-catalog-contract"
      ? "blocked-hold"
      : bestDecision === "draft-term-change"
      ? "account-owner-cosign"
      : bestDecision === "benchmark-drift-review"
      ? "account-manager-drift-review"
      : "auto-continue";
  return {
    decision: bestDecision,
    primaryReasonCode: bestReasonCode,
    primaryReasonLabel: bestReasonLabel,
    routedTo
  };
}

/** Deterministically produce the contracting decision. */
export function evaluateContract(
  req: ProviderContractRequest
): ProviderContractDecision {
  const contractType = getContractType(req.contractTypeId);
  const methodology = getBenchmarkMethodology(req.methodologyId);
  const rules = evaluateContractingRules(req);
  const { decision, primaryReasonCode, primaryReasonLabel, routedTo } =
    summarizeContractingDecision(rules);

  const qualityGateThreshold = methodology?.qualityGateThreshold ?? 0;
  const spendDriftTolerance = methodology?.spendDriftTolerance ?? 0;
  const qualityGateMet =
    (contractType?.isValueBased ?? false)
      ? req.qualityMeasuresMetFraction >= qualityGateThreshold
      : true;
  const spendDriftFraction = computeSpendDrift(
    req.benchmarkSpendCents,
    req.actualSpendCents
  );

  const requiresAccountOwnerCosign = decision === "draft-term-change";

  const note =
    decision === "in-good-standing"
      ? `In good standing: ${contractType?.label ?? req.contractTypeId} for reporting period ${req.reportingPeriodStart}..${req.reportingPeriodEnd}.`
      : `${decision} for ${contractType?.label ?? req.contractTypeId}: ${rules.length} rule${rules.length === 1 ? "" : "s"} fired, primary reason ${primaryReasonCode}. Routed to ${routedTo}. ` +
        (decision === "blocked-non-catalog-contract"
          ? "BLOCKED — non-catalog contract type; a bespoke payment model would pollute downstream benchmarking."
          : decision === "draft-term-change"
          ? "DRAFTED for account-owner cosign — the agent NEVER autonomously commits a contract-term change; state insurance code + provider-contract law + Medicare Advantage require a human owner sign-off."
          : "ROUTED to account manager for benchmark-drift review — quality gate / spend drift out of band.");

  return {
    requestRef: req.requestRef,
    providerRef: req.providerRef,
    contractRef: req.contractRef,
    contractTypeId: req.contractTypeId,
    contractTypeLabel: contractType?.label ?? "(off-catalog)",
    methodologyId: req.methodologyId,
    methodologyLabel: methodology?.label ?? "(off-catalog)",
    reportingPeriodStart: req.reportingPeriodStart,
    reportingPeriodEnd: req.reportingPeriodEnd,
    decision,
    appliedRules: rules,
    qualityGateMet,
    qualityMeasuresMetFraction: req.qualityMeasuresMetFraction,
    qualityGateThreshold,
    spendDriftFraction,
    spendDriftTolerance,
    benchmarkSpendCents: req.benchmarkSpendCents,
    actualSpendCents: req.actualSpendCents,
    primaryReasonCode,
    primaryReasonLabel,
    routedTo,
    requiresAccountOwnerCosign,
    cosigned: false,
    synthetic: true,
    note
  };
}

/** Contract-catalog check. True when contract type + methodology + rule + reason ids are all catalog-sourced. */
export function contractsTraceToCatalog(
  input:
    | {
        contractTypeId?: string;
        methodologyId?: string;
        appliedRules?: ReadonlyArray<{ ruleId?: string; reasonCode?: string }>;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  if (!isContractType(input.contractTypeId)) return false;
  const rules = input.appliedRules ?? [];
  if (!Array.isArray(rules)) return false;
  // Methodology may be off-catalog only if the contract type is non-VBC AND
  // methodologyId happens to be undefined-checked separately — but for the
  // fabric guard we require it to be catalog-sourced.
  if (!isBenchmarkMethodology(input.methodologyId)) return false;
  return rules.every(
    (r) => isContractingRule(r.ruleId) && isContractingReasonCode(r.reasonCode)
  );
}

/** Account-owner-cosign check. True when a term-change decision is properly gated. */
export function contractChangeRequiresOwnerCosign(
  decision:
    | {
        decision?: string;
        requiresAccountOwnerCosign?: boolean;
        cosigned?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.decision !== "draft-term-change") return true;
  if (decision.requiresAccountOwnerCosign !== true) return false;
  if (decision.cosigned === true) return false;
  return true;
}

/** Benchmark-methodology check. True when quality-gate + spend-drift trace to catalog. */
export function benchmarksTraceToMethodology(
  input:
    | {
        methodologyId?: string;
        qualityGateThreshold?: number;
        spendDriftTolerance?: number;
      }
    | null
    | undefined
): boolean {
  if (!input || typeof input !== "object") return false;
  const methodology = getBenchmarkMethodology(input.methodologyId ?? "");
  if (!methodology) return false;
  if (input.qualityGateThreshold !== methodology.qualityGateThreshold) return false;
  if (input.spendDriftTolerance !== methodology.spendDriftTolerance) return false;
  return true;
}

// Illustrative demo requests.

export const DEMO_CONTRACT_GOOD_STANDING: ProviderContractRequest = {
  requestRef: "pc-req-2026-07-001",
  providerRef: "provider-001",
  contractRef: "contract-001",
  contractTypeId: "contract-type.medicare-advantage-vbc",
  methodologyId: "methodology.ma-star-vbc-my2026",
  reportingPeriodStart: "2026-01-01",
  reportingPeriodEnd: "2026-06-30",
  qualityMeasuresMetFraction: 0.82,
  benchmarkSpendCents: 100_000_00,
  actualSpendCents: 100_500_00 // +0.5% drift < 3% tolerance
};

export const DEMO_CONTRACT_QUALITY_MISS: ProviderContractRequest = {
  requestRef: "pc-req-2026-07-002",
  providerRef: "provider-002",
  contractRef: "contract-002",
  contractTypeId: "contract-type.shared-savings",
  methodologyId: "methodology.mssp-shared-savings-my2026",
  reportingPeriodStart: "2026-01-01",
  reportingPeriodEnd: "2026-06-30",
  qualityMeasuresMetFraction: 0.55, // < 0.7 gate
  benchmarkSpendCents: 200_000_00,
  actualSpendCents: 201_000_00 // +0.5% drift ok
};

export const DEMO_CONTRACT_SPEND_DRIFT: ProviderContractRequest = {
  requestRef: "pc-req-2026-07-003",
  providerRef: "provider-003",
  contractRef: "contract-003",
  contractTypeId: "contract-type.commercial-vbc",
  methodologyId: "methodology.commercial-vbc-my2026",
  reportingPeriodStart: "2026-01-01",
  reportingPeriodEnd: "2026-06-30",
  qualityMeasuresMetFraction: 0.7,
  benchmarkSpendCents: 150_000_00,
  actualSpendCents: 160_500_00 // +7% drift > 5% tolerance
};

export const DEMO_CONTRACT_TERM_CHANGE: ProviderContractRequest = {
  requestRef: "pc-req-2026-07-004",
  providerRef: "provider-004",
  contractRef: "contract-004",
  contractTypeId: "contract-type.medicare-advantage-vbc",
  methodologyId: "methodology.ma-star-vbc-my2026",
  reportingPeriodStart: "2026-01-01",
  reportingPeriodEnd: "2026-06-30",
  qualityMeasuresMetFraction: 0.8,
  benchmarkSpendCents: 100_000_00,
  actualSpendCents: 99_000_00,
  requestsTermChange: true,
  termChangeSummary: "lower quality-gate threshold from 0.75 to 0.70 due to attributed panel shift"
};

export const DEMO_CONTRACT_FFS: ProviderContractRequest = {
  requestRef: "pc-req-2026-07-005",
  providerRef: "provider-005",
  contractRef: "contract-005",
  contractTypeId: "contract-type.fee-for-service",
  methodologyId: "methodology.commercial-vbc-my2026", // methodology on file, but non-VBC
  reportingPeriodStart: "2026-01-01",
  reportingPeriodEnd: "2026-06-30",
  qualityMeasuresMetFraction: 0,
  benchmarkSpendCents: 0,
  actualSpendCents: 0
};
