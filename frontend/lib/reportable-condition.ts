/**
 * Reportable / Notifiable Condition Case Classification — the deterministic, transparent clinical /
 * public-health-compliance layer that takes a patient CASE's structured facts plus a public-health CASE
 * DEFINITION (an ordered list of classifications — confirmed / probable / suspect — each expressed as a
 * nested boolean CRITERIA TREE of all-of / any-of / not over leaf predicates) and DETERMINISTICALLY
 * classifies the case by evaluating each classification's tree and taking the highest-precedence one that
 * holds; never autonomously REPORTING the case to a public-health authority — an epidemiologist confirms.
 *
 * Deterministic, dependency-free domain core the Reportable Condition agent (app/api/agents/reportable-
 * condition) wraps — a clinical / compliance service on the patient-care plane of Pause's Agent Fabric.
 * UNLIKE the PCP Matching agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's
 * GEOSPATIAL GREAT-CIRCLE DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, the
 * Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's
 * PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Claim Lifecycle
 * agent's FSM TRANSITION VALIDATION, the Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule
 * Conflict agent's GREEDY INTERVAL SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access
 * Anomaly agent's SLIDING-WINDOW COUNTING, the Coverage Continuity agent's INTERVAL MERGING, the Care
 * Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED SET-DIFFERENCE, or the
 * Audit Log Integrity agent's HASH CHAIN — the heart of this service is RECURSIVE BOOLEAN EXPRESSION-TREE
 * EVALUATION: the recursive walk of a nested all-of (AND) / any-of (OR) / not (NOT) tree whose leaves are
 * predicates over the case's facts, the exact shape a public-health case definition takes
 * ("confirmed = lab-positive OR (clinically-compatible AND epi-linked)"). A mis-evaluated criteria tree
 * over- or under-reports a notifiable condition — a public-health and a patient-care failure — so this
 * service evaluates the tree deterministically and hands the classification to a human.
 *
 *   Inbound:  a ReportableCaseRequest { caseRef, facts[], definition }
 *   Outbound: a ReportableCaseDetermination { classification, reportable, classificationResults[],
 *             referencedFacts[], facts[], definition, requiresEpiReview:true, autoReported:false, reason,
 *             synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other compliance / clinical agents: distinct from the
 * Adverse-Event Reporting agent (which DRAFTS a MedWatch / VAERS report for a drug / vaccine event), the
 * Utilization Review agent (medical-necessity criteria for a service), and the Lab Result agent (a single
 * analyte vs a reference range): this classifies a case against a nested public-health CASE DEFINITION.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every criterion is sourced and the definition is complete.
 * ─────────────────────────────────────────────────────────────────────
 *  A classification is trustworthy only if it evaluates the submitted definition against the submitted
 *  facts: every leaf predicate must reference a SUBMITTED fact (no fabricated criterion referencing an
 *  undefined fact), the reported classification results must be exactly the definition's classifications in
 *  order, the referenced-fact set must match the definition's actual leaves, and the reported classification
 *  must be a defined one (or not-a-case). A fabricated criterion invents a requirement the definition never
 *  stated. factsSourced() verifies it; the Agent Fabric enforces it via policy.reportable.facts-sourced.
 *  (The sourced + completeness gate — mirrors the PCP Matching Agent's matching-sourced and the Network
 *  Adequacy Agent's providers-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the classification recomputes.
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing the recursive boolean evaluation of each classification's criteria tree from the facts must
 *  reproduce each classification's met flag, the selected classification (the highest-precedence tree that
 *  holds, else not-a-case), and the reportable flag. A mis-evaluated tree over-reports (a false alarm to
 *  public health) or under-reports (a missed notifiable case) the condition. The whole point is the boolean
 *  logic. classificationConsistent() recomputes it end-to-end; the Agent Fabric enforces it via
 *  policy.reportable.classification-consistent. (The load-bearing correctness gate — mirrors the PCP
 *  Matching Agent's matching-stable and the Care Pathway Agent's sequence-valid.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the case is never autonomously reported.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent CLASSIFIES — it never REPORTS the case to a public-health authority on its own (a consequential
 *  legal action that must be authorized); every classification is a RECOMMENDATION requiring an
 *  epidemiologist / infection-preventionist to confirm. noAutonomousReport() reports the honest signal the
 *  Agent Fabric enforces via policy.reportable.no-autonomous-report. (Mirrors the Adverse-Event Reporting
 *  Agent's human-review posture and the HEDIS Agent's no-autonomous-submission — the harmful action is
 *  enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A classification — confirmed / probable / suspect / not-a-case — is a SAFE, honest OUTPUT: the task
 *  COMPLETES (it carries requiresEpiReview:true, autoReported:false). A GOVERNANCE BLOCK is when a caller
 *  PRESENTS an offending DETERMINATION (a fabricated criterion, a mis-evaluated tree, or an autonomous
 *  report) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified surveillance / case-reporting system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real notifiable-condition reporting uses the jurisdiction's official CSTE / CDC case definitions, eCR /
 *  eICR electronic case reporting, and an epidemiologist's judgment. This evaluates the supplied case
 *  definition tree only. It IS PHI-bearing — the case is a patient's clinical data — so it is on the
 *  HIPAA-audit policy. TIME IS DATA: the classification is a pure function of the facts + definition (no
 *  clock, no randomness), so the same case always yields the same classification, which is what lets the
 *  demo, the seeded trace, and the tests agree. The condition, facts, and definition are clearly-labeled
 *  ILLUSTRATIVE synthetics.
 */

/** A declared fact about the case (a named boolean). */
export type CaseFact = {
  key: string;
  value: boolean;
  label?: string;
};

/** A node in a boolean criteria tree. */
export type RuleNode =
  | { type: "leaf"; fact: string }
  | { type: "not"; child: RuleNode }
  | { type: "all-of"; children: RuleNode[] }
  | { type: "any-of"; children: RuleNode[] };

/** A named classification with its criteria tree. */
export type ClassificationRule = {
  classification: string;
  criteria: RuleNode;
};

/** A case definition: an ordered (highest-precedence first) list of classifications. */
export type CaseDefinition = {
  condition: string;
  classifications: ClassificationRule[];
};

/** A reportable-condition classification request. */
export type ReportableCaseRequest = {
  caseRef: string;
  facts: CaseFact[];
  definition: CaseDefinition;
};

/** The recomputed met flag for one classification. */
export type ClassificationResult = {
  classification: string;
  met: boolean;
};

/** The sentinel classification when no definition tree holds. */
export const NOT_A_CASE = "not-a-case";

/** The deterministic finding the agent returns. */
export type ReportableCaseDetermination = {
  caseRef: string;
  condition: string;
  /** The submitted facts, echoed so the guards can recompute. */
  facts: CaseFact[];
  /** The submitted definition, echoed so the guards can recompute. */
  definition: CaseDefinition;
  /** The met flag per definition classification, in precedence order. */
  classificationResults: ClassificationResult[];
  /** The selected classification (highest-precedence met tree, else not-a-case). */
  classification: string;
  /** True when the case is a reportable classification (not not-a-case). */
  reportable: boolean;
  /** Every fact key referenced by a leaf anywhere in the definition (sorted, de-duped). */
  referencedFacts: string[];
  /** Always true — an epidemiologist confirms every classification. */
  requiresEpiReview: true;
  /** Always false — the agent never autonomously reports the case. */
  autoReported: false;
  reason: string;
  synthetic: true;
  note: string;
};

/** Build a fact-key → value map from the submitted facts. */
function factMapOf(facts: CaseFact[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const f of facts) if (f && typeof f.key === "string") m.set(f.key, f.value === true);
  return m;
}

/**
 * Recursively evaluate a boolean criteria tree against the case facts — the heart of the service. A leaf is
 * the fact's value (a missing fact is treated as false, deterministically); not negates; all-of is AND
 * (empty ⇒ true); any-of is OR (empty ⇒ false). Pure + deterministic.
 */
export function evaluateNode(node: RuleNode, facts: Map<string, boolean>): boolean {
  switch (node.type) {
    case "leaf":
      return facts.get(node.fact) === true;
    case "not":
      return !evaluateNode(node.child, facts);
    case "all-of":
      return node.children.every((c) => evaluateNode(c, facts));
    case "any-of":
      return node.children.some((c) => evaluateNode(c, facts));
    default:
      return false;
  }
}

/** Collect every leaf fact key referenced anywhere in a criteria tree. */
function collectLeafFacts(node: RuleNode, acc: Set<string>): void {
  switch (node.type) {
    case "leaf":
      acc.add(node.fact);
      return;
    case "not":
      collectLeafFacts(node.child, acc);
      return;
    case "all-of":
    case "any-of":
      for (const c of node.children) collectLeafFacts(c, acc);
      return;
    default:
      return;
  }
}

/** Every fact key referenced by the whole definition, sorted + de-duped. */
export function referencedFactsOf(definition: CaseDefinition): string[] {
  const acc = new Set<string>();
  for (const c of definition.classifications) collectLeafFacts(c.criteria, acc);
  return [...acc].sort();
}

/** Select the highest-precedence classification whose tree holds, else not-a-case. */
function selectClassification(results: ClassificationResult[]): string {
  const hit = results.find((r) => r.met);
  return hit ? hit.classification : NOT_A_CASE;
}

/**
 * The deterministic classification function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own facts + definition (no randomness, no clock). It recursively evaluates each
 * classification's criteria tree, selects the highest-precedence one that holds (else not-a-case), and marks
 * the case reportable when a definition classification holds. Nothing is reported — the classification is
 * handed to an epidemiologist.
 */
export function evaluateReportableCase(request: ReportableCaseRequest): ReportableCaseDetermination {
  const facts = Array.isArray(request.facts) ? request.facts : [];
  const definition: CaseDefinition = request.definition ?? { condition: "", classifications: [] };
  const factMap = factMapOf(facts);

  const classificationResults: ClassificationResult[] = definition.classifications.map((c) => ({
    classification: c.classification,
    met: evaluateNode(c.criteria, factMap)
  }));
  const classification = selectClassification(classificationResults);
  const reportable = classification !== NOT_A_CASE;
  const referencedFacts = referencedFactsOf(definition);

  const reason = reportable
    ? `Case meets the ${definition.condition} definition at the ${classification.toUpperCase()} level.`
    : `Case does not meet any ${definition.condition} classification — not a reportable case.`;

  return {
    caseRef: request.caseRef,
    condition: definition.condition,
    facts,
    definition,
    classificationResults,
    classification,
    reportable,
    referencedFacts,
    requiresEpiReview: true,
    autoReported: false,
    reason,
    synthetic: true,
    note:
      `Reportable-condition classification ${request.caseRef}: ${classification.toUpperCase()} for ${definition.condition} — evaluated via RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION (nested all-of / any-of / not over the case's facts) across ${definition.classifications.length} classification(s), with a documented precedence (highest-precedence met tree wins).` +
      " Real notifiable-condition reporting uses the jurisdiction's official CSTE / CDC case definitions, eCR / eICR electronic case reporting, and an epidemiologist's judgment. PHI-bearing — the case is a patient's clinical data. Synthetic/illustrative condition + definition — NOT a certified surveillance / case-reporting system. The agent never reports the case to a public-health authority on its own — an epidemiologist confirms every classification."
  };
}

/**
 * Sourced + completeness check: does the classification evaluate the submitted definition against the
 * submitted facts? True only when every leaf predicate references a submitted fact (no fabricated criterion
 * referencing an undefined fact), the reported classification results are exactly the definition's
 * classifications in order, the reported referenced-fact set matches the definition's actual leaves, and the
 * reported classification is a defined one (or not-a-case). Catches a fabricated criterion or a
 * mis-enumerated definition. Does NOT recompute the boolean recursion (that is the consistency check's job),
 * so it is independent of it. Anything evaluateReportableCase() produces satisfies it. This is the honest
 * signal the route reports to policy.reportable.facts-sourced. A non-object / malformed input is a
 * violation.
 */
export function factsSourced(
  decision:
    | {
        facts?: unknown;
        definition?: unknown;
        classificationResults?: unknown;
        classification?: unknown;
        referencedFacts?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const facts = Array.isArray(decision.facts) ? (decision.facts as CaseFact[]) : null;
  const definition = decision.definition as CaseDefinition | undefined;
  const classificationResults = Array.isArray(decision.classificationResults)
    ? (decision.classificationResults as ClassificationResult[])
    : null;
  if (!facts || !definition || !Array.isArray(definition.classifications) || !classificationResults) {
    return false;
  }

  const submittedFactKeys = new Set(facts.map((f) => f.key));
  const referenced = referencedFactsOf(definition);

  // Every referenced leaf fact must be a submitted fact (no fabricated criterion).
  for (const key of referenced) {
    if (!submittedFactKeys.has(key)) return false;
  }

  // Reported referencedFacts must match the definition's actual leaves.
  if (decision.referencedFacts !== undefined) {
    const reported = Array.isArray(decision.referencedFacts)
      ? [...(decision.referencedFacts as string[])].sort()
      : null;
    if (!reported) return false;
    if (reported.length !== referenced.length) return false;
    for (let i = 0; i < referenced.length; i++) {
      if (reported[i] !== referenced[i]) return false;
    }
  }

  // Reported classification results must be exactly the definition's classifications in order.
  if (classificationResults.length !== definition.classifications.length) return false;
  for (let i = 0; i < definition.classifications.length; i++) {
    if (classificationResults[i]?.classification !== definition.classifications[i].classification) {
      return false;
    }
  }

  // Reported classification must be a defined one or not-a-case.
  const validNames = new Set(definition.classifications.map((c) => c.classification));
  validNames.add(NOT_A_CASE);
  if (typeof decision.classification !== "string" || !validNames.has(decision.classification)) {
    return false;
  }
  return true;
}

/**
 * Consistency check: recomputing the recursive boolean evaluation of each classification's criteria tree
 * from the facts must reproduce each reported met flag, the selected classification (highest-precedence met
 * tree, else not-a-case), and the reportable flag. True only when they all match. Catches a mis-evaluated
 * tree (an over- or under-reported condition). The load-bearing correctness gate — it recomputes the boolean
 * recursion from the definition + facts and does NOT check the submitted-fact correspondence (that is the
 * sourced check's job), so it is independent of it (a reported result for a classification not in the
 * definition is ignored here). Anything evaluateReportableCase() produces satisfies it. A non-object input
 * is a violation.
 */
export function classificationConsistent(
  decision:
    | {
        facts?: unknown;
        definition?: unknown;
        classificationResults?: unknown;
        classification?: unknown;
        reportable?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const facts = Array.isArray(decision.facts) ? (decision.facts as CaseFact[]) : null;
  const definition = decision.definition as CaseDefinition | undefined;
  const classificationResults = Array.isArray(decision.classificationResults)
    ? (decision.classificationResults as ClassificationResult[])
    : null;
  if (!facts || !definition || !Array.isArray(definition.classifications) || !classificationResults) {
    return false;
  }

  const factMap = factMapOf(facts);
  const reportedByName = new Map<string, boolean>();
  for (const r of classificationResults) {
    if (r && typeof r.classification === "string") reportedByName.set(r.classification, r.met === true);
  }

  const recomputed: ClassificationResult[] = definition.classifications.map((c) => ({
    classification: c.classification,
    met: evaluateNode(c.criteria, factMap)
  }));

  // Each definition classification's reported met must match the recompute.
  for (const rc of recomputed) {
    if (!reportedByName.has(rc.classification)) return false;
    if (reportedByName.get(rc.classification) !== rc.met) return false;
  }

  const selected = selectClassification(recomputed);
  if (decision.classification !== selected) return false;
  if (decision.reportable !== (selected !== NOT_A_CASE)) return false;
  return true;
}

/**
 * No-autonomous-report check: did the agent avoid autonomously reporting the case? True unless the
 * determination reports it auto-reported (autoReported:true) or does not require epi review
 * (requiresEpiReview:false). Anything evaluateReportableCase() produces satisfies it. This is the honest
 * signal the route reports to policy.reportable.no-autonomous-report. A non-object input is a violation.
 */
export function noAutonomousReport(
  decision:
    | { autoReported?: boolean; requiresEpiReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoReported === true) return false;
  if (decision.requiresEpiReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a classification. */
export function reportableCaseSummary(decision: ReportableCaseDetermination): {
  caseRef: string;
  condition: string;
  classification: string;
  reportable: boolean;
  classificationCount: number;
  requiresEpiReview: boolean;
  synthetic: boolean;
} {
  return {
    caseRef: decision.caseRef,
    condition: decision.condition,
    classification: decision.classification,
    reportable: decision.reportable,
    classificationCount: decision.classificationResults.length,
    requiresEpiReview: decision.requiresEpiReview,
    synthetic: decision.synthetic
  };
}

/**
 * An illustrative synthetic case definition for a notifiable acute viral hepatitis — a nested boolean case
 * definition with genuine AND / OR / NOT structure. NOT a certified CSTE / CDC case definition.
 */
export const DEMO_CASE_DEFINITION: CaseDefinition = {
  condition: "acute-viral-hepatitis (illustrative)",
  classifications: [
    {
      classification: "confirmed",
      // (lab-positive-nat OR lab-positive-antigen) AND NOT chronic-history
      criteria: {
        type: "all-of",
        children: [
          {
            type: "any-of",
            children: [
              { type: "leaf", fact: "lab-positive-nat" },
              { type: "leaf", fact: "lab-positive-antigen" }
            ]
          },
          { type: "not", child: { type: "leaf", fact: "chronic-history" } }
        ]
      }
    },
    {
      classification: "probable",
      // clinically-compatible AND (epi-linked OR elevated-alt)
      criteria: {
        type: "all-of",
        children: [
          { type: "leaf", fact: "clinically-compatible" },
          {
            type: "any-of",
            children: [
              { type: "leaf", fact: "epi-linked" },
              { type: "leaf", fact: "elevated-alt" }
            ]
          }
        ]
      }
    },
    {
      classification: "suspect",
      // clinically-compatible OR jaundice
      criteria: {
        type: "any-of",
        children: [
          { type: "leaf", fact: "clinically-compatible" },
          { type: "leaf", fact: "jaundice" }
        ]
      }
    }
  ]
};

/** A representative demo request that classifies as confirmed (lab-positive, not chronic). Synthetic. */
export const DEMO_REPORTABLE_CASE_REQUEST: ReportableCaseRequest = {
  caseRef: "rc-case-001",
  facts: [
    { key: "lab-positive-nat", value: true, label: "NAT positive" },
    { key: "lab-positive-antigen", value: false, label: "Antigen positive" },
    { key: "chronic-history", value: false, label: "Chronic-hepatitis history" },
    { key: "clinically-compatible", value: true, label: "Clinically compatible illness" },
    { key: "epi-linked", value: false, label: "Epidemiologically linked" },
    { key: "elevated-alt", value: true, label: "Elevated ALT" },
    { key: "jaundice", value: true, label: "Jaundice" }
  ],
  definition: DEMO_CASE_DEFINITION
};

/** A representative demo request that classifies as probable (clinical + epi-linked, no lab). Synthetic. */
export const DEMO_REPORTABLE_CASE_PROBABLE_REQUEST: ReportableCaseRequest = {
  caseRef: "rc-case-002",
  facts: [
    { key: "lab-positive-nat", value: false, label: "NAT positive" },
    { key: "lab-positive-antigen", value: false, label: "Antigen positive" },
    { key: "chronic-history", value: false, label: "Chronic-hepatitis history" },
    { key: "clinically-compatible", value: true, label: "Clinically compatible illness" },
    { key: "epi-linked", value: true, label: "Epidemiologically linked" },
    { key: "elevated-alt", value: false, label: "Elevated ALT" },
    { key: "jaundice", value: false, label: "Jaundice" }
  ],
  definition: DEMO_CASE_DEFINITION
};

/** A representative demo request that classifies as not-a-case (nothing holds). Synthetic. */
export const DEMO_REPORTABLE_CASE_NEGATIVE_REQUEST: ReportableCaseRequest = {
  caseRef: "rc-case-003",
  facts: [
    { key: "lab-positive-nat", value: false, label: "NAT positive" },
    { key: "lab-positive-antigen", value: false, label: "Antigen positive" },
    { key: "chronic-history", value: false, label: "Chronic-hepatitis history" },
    { key: "clinically-compatible", value: false, label: "Clinically compatible illness" },
    { key: "epi-linked", value: false, label: "Epidemiologically linked" },
    { key: "elevated-alt", value: false, label: "Elevated ALT" },
    { key: "jaundice", value: false, label: "Jaundice" }
  ],
  definition: DEMO_CASE_DEFINITION
};
