/**
 * Clinical Code Taxonomy / Longest-Prefix Classification — the deterministic, transparent data-substrate
 * layer that, given a BATCH of clinical codes (ICD-10 diagnosis codes, HCPCS / CPT procedure codes) and a
 * TAXONOMY of category PREFIXES (a code-group value-set: each prefix maps a family of codes to a category),
 * classifies each code to its MOST-SPECIFIC (longest) matching category prefix — or leaves it UNCLASSIFIED
 * when no prefix matches — without ever re-coding a claim, submitting the codes, or overwriting the coded
 * record. A coder confirms.
 *
 * Deterministic, dependency-free domain core the Code Taxonomy agent (app/api/agents/code-taxonomy) wraps — a
 * terminology / value-set service on the platform & data-substrate plane of Pause's Agent Fabric. UNLIKE the
 * Source Consensus agent's BOYER–MOORE MAJORITY VOTE, the Care Routing agent's DIJKSTRA'S WEIGHTED SHORTEST
 * PATH, the KPI Trend agent's LEAST-SQUARES LINEAR REGRESSION, the Outreach Prioritization agent's 0/1
 * KNAPSACK DYNAMIC PROGRAMMING, the Quality Shift agent's CUSUM CHANGE-POINT DETECTION, the Timeline Merge
 * agent's K-WAY MERGE OF SORTED STREAMS, the Reportable Condition agent's RECURSIVE BOOLEAN EXPRESSION-TREE
 * EVALUATION, the PCP Matching agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's
 * GEOSPATIAL GREAT-CIRCLE DISTANCE, the Household Composition agent's UNION-FIND CONNECTED COMPONENTS, the
 * Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR Rebate agent's LARGEST-REMAINDER
 * APPORTIONMENT, the Schedule Conflict agent's GREEDY INTERVAL SELECTION, the Enrollment Reconciliation
 * agent's KEYED SET-DIFFERENCE, the Audit Log Integrity agent's HASH CHAIN, or the Claim Lifecycle agent's
 * BFS REACHABILITY — and, CRUCIALLY, UNLIKE the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM
 * (which validates one identifier's Luhn check digit, character math on a single string), the Medication Name
 * Safety agent's STRING EDIT DISTANCE (which measures how far apart two drug NAMES are), and the HCC Risk
 * Adjustment agent's HIERARCHY + COEFFICIENT SUM (which rolls confirmed conditions up a clinical hierarchy
 * and sums RAF coefficients) — the heart of this service is a TRIE (PREFIX TREE) LONGEST-PREFIX MATCH: the
 * taxonomy prefixes are inserted into a trie, and each code is walked character-by-character down the trie,
 * remembering the DEEPEST terminal node reached — the longest taxonomy prefix that is a prefix of the code,
 * i.e. the most specific category. A shallow substring match (E28 when E28.3 also applies) mis-buckets a code
 * into a less specific group; the longest-prefix rule picks the most specific category the taxonomy defines.
 * So this classifies DETERMINISTICALLY and hands the categorized batch to a human.
 *
 *   Inbound:  a CodeTaxonomyRequest { catalogRef, taxonomy[], codes[] }
 *   Outbound: a CodeTaxonomyDetermination { classifications[], classifiedCount, unclassifiedCount, total,
 *             disposition, requiresCoderReview:true, autoApplied:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the classifications are sourced and complete.
 * ─────────────────────────────────────────────────────────────────────
 *  A classification batch is trustworthy only if it corresponds EXACTLY to the submitted codes: exactly one
 *  classification per submitted code, in the same order (no FABRICATED code, none dropped, none duplicated),
 *  every matched prefix must be a SUBMITTED taxonomy prefix (no invented category), each classification must
 *  be self-consistent (a category iff a matched prefix), the reported counts must add up (classified +
 *  unclassified = total = codes), and the disposition must follow. A fabricated code or invented category
 *  corrupts the value-set mapping. classificationsSourced() verifies it; the Agent Fabric enforces it via
 *  policy.code.classifications-sourced. It does NOT recompute the longest-prefix match — that is the
 *  consistency gate's job — so the two are isolable. (The sourced + completeness gate — mirrors the
 *  Identifier Validation Agent's identifiers-sourced and the Enrollment Reconciliation Agent's
 *  reconciliation-complete.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the classification recomputes.
 * ─────────────────────────────────────────────────────────────────────
 *  Rebuilding the trie from the taxonomy and re-running the longest-prefix match over each submitted code
 *  must reproduce the reported category + matched prefix. A wrong bucket mis-maps a code; a missed match
 *  drops it from a value set it belongs to. classificationConsistent() recomputes it end-to-end, INDEPENDENT
 *  of the reported classifications (it filters them to the ones that correspond to a real submitted code
 *  before checking their category + prefix, and recomputes the match from the taxonomy, not the reported
 *  rows), so a fabricated-code classification that still reports a correct match fails sourced only, and a
 *  real-code but wrong-bucket classification fails consistent only — the two gates are isolable. The Agent
 *  Fabric enforces it via policy.code.classification-consistent. (The load-bearing correctness gate — mirrors
 *  the Identifier Validation Agent's checksum-consistent and the Source Consensus Agent's consensus-consistent.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous re-coding.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent CLASSIFIES on paper — it never re-codes a claim, submits the codes, or overwrites the coded
 *  record on its own (each is a consequential coding action that must be authorized); every classification is
 *  a RECOMMENDATION requiring a coder to confirm. noAutonomousRecode() reports the honest signal the Agent
 *  Fabric enforces via policy.code.no-autonomous-recode. (Mirrors the Identifier Validation Agent's
 *  no-autonomous-reject and the Enrollment Reconciliation Agent's no-autonomous-change — the harmful action
 *  is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A batch — all-classified or unclassified-present — is a SAFE, honest OUTPUT: the task COMPLETES (it
 *  carries requiresCoderReview:true, autoApplied:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (a fabricated / dropped code, a wrong-bucket / invented-category classification,
 *  or an autonomous re-code) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified terminology / code-set engine.
 * ─────────────────────────────────────────────────────────────────────
 *  Real terminology services resolve full code systems (ICD-10-CM, SNOMED CT, LOINC, RxNorm) with versioned
 *  value sets, inclusion/exclusion logic, and semantic relationships — not a bare longest-prefix match over a
 *  handful of prefixes. This classifies the supplied illustrative taxonomy only. TIME IS DATA: the
 *  classification is a pure function of the taxonomy + codes (no clock, no randomness), so the same request
 *  always yields the same determination, which is what lets the demo, the seeded trace, and the tests agree.
 *  The taxonomy + codes are clearly-labeled ILLUSTRATIVE synthetics; DELIBERATELY NOT PHI-bearing — a code is
 *  a terminology token, classified against a value-set taxonomy, not patient health information.
 */

/** One taxonomy entry: a code PREFIX mapped to a category. */
export type TaxonomyEntry = {
  prefix: string;
  category: string;
  label?: string;
};

/** One code to classify. */
export type CodeInput = {
  code: string;
  label?: string;
};

/** A classification request: a taxonomy + a batch of codes. */
export type CodeTaxonomyRequest = {
  catalogRef: string;
  taxonomy: TaxonomyEntry[];
  codes: CodeInput[];
};

/** One code's classification: its most-specific matching category, or null if unclassified. */
export type CodeClassification = {
  code: string;
  category: string | null;
  matchedPrefix: string | null;
};

export type CodeTaxonomyDisposition = "all-classified" | "unclassified-present";

/** The deterministic finding the agent returns. */
export type CodeTaxonomyDetermination = {
  catalogRef: string;
  /** The submitted taxonomy, echoed so the guards can recompute. */
  taxonomy: TaxonomyEntry[];
  /** The submitted codes, echoed so the guards can recompute. */
  codes: CodeInput[];
  /** One classification per submitted code, in the same order. */
  classifications: CodeClassification[];
  classifiedCount: number;
  unclassifiedCount: number;
  total: number;
  disposition: CodeTaxonomyDisposition;
  /** Always true — a coder confirms every classification. */
  requiresCoderReview: true;
  /** Always false — the agent never autonomously re-codes. */
  autoApplied: false;
  reason: string;
  synthetic: true;
  note: string;
};

/** A trie (prefix-tree) node; a terminal node carries the taxonomy category + the prefix that reached it. */
type TrieNode = {
  children: Map<string, TrieNode>;
  category?: string;
  prefix?: string;
};

/** Build a trie from the taxonomy prefixes. Later duplicate prefixes overwrite earlier ones (deterministic). */
export function buildTrie(taxonomy: TaxonomyEntry[]): TrieNode {
  const root: TrieNode = { children: new Map() };
  for (const entry of taxonomy) {
    let node = root;
    for (const ch of entry.prefix) {
      let next = node.children.get(ch);
      if (!next) {
        next = { children: new Map() };
        node.children.set(ch, next);
      }
      node = next;
    }
    node.category = entry.category;
    node.prefix = entry.prefix;
  }
  return root;
}

/**
 * TRIE LONGEST-PREFIX MATCH — the heart of the service. Walk the code character-by-character down the trie,
 * remembering the DEEPEST terminal node reached — the longest taxonomy prefix that is a prefix of the code
 * (the most specific category). Returns the matched category + prefix, or null when no taxonomy prefix
 * matches. Deterministic.
 */
export function longestPrefixMatch(
  root: TrieNode,
  code: string
): { category: string; prefix: string } | null {
  let node = root;
  let best: { category: string; prefix: string } | null =
    node.category !== undefined && node.prefix !== undefined
      ? { category: node.category, prefix: node.prefix }
      : null;
  for (const ch of code) {
    const next = node.children.get(ch);
    if (!next) break;
    node = next;
    if (node.category !== undefined && node.prefix !== undefined) {
      best = { category: node.category, prefix: node.prefix };
    }
  }
  return best;
}

/**
 * The deterministic classification function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own taxonomy + codes (no randomness, no clock). It builds the trie once and classifies each code
 * by longest-prefix match. Nothing is re-coded — the batch is handed to a coder.
 */
export function evaluateCodeTaxonomy(request: CodeTaxonomyRequest): CodeTaxonomyDetermination {
  const taxonomy = Array.isArray(request.taxonomy) ? request.taxonomy : [];
  const codes = Array.isArray(request.codes) ? request.codes : [];
  const root = buildTrie(taxonomy);

  const classifications: CodeClassification[] = codes.map((c) => {
    const match = longestPrefixMatch(root, c.code);
    return {
      code: c.code,
      category: match ? match.category : null,
      matchedPrefix: match ? match.prefix : null
    };
  });

  const classifiedCount = classifications.filter((c) => c.category !== null).length;
  const unclassifiedCount = classifications.length - classifiedCount;
  const total = codes.length;
  const disposition: CodeTaxonomyDisposition =
    unclassifiedCount > 0 ? "unclassified-present" : "all-classified";

  const reason =
    unclassifiedCount > 0
      ? `Classified ${classifiedCount} of ${total} code(s) against ${catalogSummary(taxonomy)}; ${unclassifiedCount} unclassified (no matching taxonomy prefix).`
      : `Classified all ${total} code(s) against ${catalogSummary(taxonomy)} by longest-prefix match.`;

  return {
    catalogRef: request.catalogRef,
    taxonomy,
    codes,
    classifications,
    classifiedCount,
    unclassifiedCount,
    total,
    disposition,
    requiresCoderReview: true,
    autoApplied: false,
    reason,
    synthetic: true,
    note:
      `Code-taxonomy classification ${request.catalogRef}: ${disposition.toUpperCase()} \u2014 ` +
      `${classifiedCount}/${total} code(s) classified to their most-specific category via a TRIE (PREFIX TREE) LONGEST-PREFIX MATCH` +
      (unclassifiedCount > 0 ? `, ${unclassifiedCount} unclassified.` : ".") +
      " Real terminology services resolve full code systems (ICD-10-CM, SNOMED CT, LOINC, RxNorm) with versioned value sets, inclusion/exclusion logic, and semantic relationships \u2014 not a bare longest-prefix match over a handful of prefixes. Synthetic/illustrative taxonomy + codes \u2014 NOT a certified terminology / code-set engine; DELIBERATELY NOT PHI-bearing. The agent never re-codes a claim, submits the codes, or overwrites the coded record on its own \u2014 a coder confirms every classification."
  };
}

function catalogSummary(taxonomy: TaxonomyEntry[]): string {
  return `a ${taxonomy.length}-prefix taxonomy`;
}

/** The set of taxonomy prefixes, for membership checks. */
function prefixSet(taxonomy: TaxonomyEntry[]): Set<string> {
  return new Set(taxonomy.map((e) => e.prefix));
}

/**
 * Sourced + completeness check: does the reported classification batch correspond EXACTLY to the submitted
 * codes? Exactly one classification per submitted code, in the same order (no fabricated code, none dropped,
 * none duplicated); every matched prefix is a SUBMITTED taxonomy prefix (or null); each classification is
 * self-consistent (a category iff a matched prefix); the reported counts add up (classified + unclassified =
 * total = codes); and the disposition follows. Catches a fabricated code or an invented category. Does NOT
 * recompute the longest-prefix match (that is the consistency gate's job), so it is independent of it.
 * Anything evaluateCodeTaxonomy() produces satisfies it. This is the honest signal the batch reports to
 * policy.code.classifications-sourced. A non-object / malformed input is a violation.
 */
export function classificationsSourced(
  decision:
    | {
        taxonomy?: unknown;
        codes?: unknown;
        classifications?: unknown;
        classifiedCount?: unknown;
        unclassifiedCount?: unknown;
        total?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const taxonomy = Array.isArray(decision.taxonomy) ? (decision.taxonomy as TaxonomyEntry[]) : null;
  const codes = Array.isArray(decision.codes) ? (decision.codes as CodeInput[]) : null;
  const classifications = Array.isArray(decision.classifications)
    ? (decision.classifications as CodeClassification[])
    : null;
  if (!taxonomy || !codes || !classifications) return false;
  if (classifications.length !== codes.length) return false;

  const prefixes = prefixSet(taxonomy);
  let classified = 0;
  for (let i = 0; i < classifications.length; i++) {
    const c = classifications[i];
    if (typeof c.code !== "string") return false;
    if (c.code !== codes[i].code) return false; // fabricated / dropped / reordered code
    // Self-consistency: a category iff a matched prefix.
    const hasCategory = c.category !== null && c.category !== undefined;
    const hasPrefix = c.matchedPrefix !== null && c.matchedPrefix !== undefined;
    if (hasCategory !== hasPrefix) return false;
    if (hasPrefix) {
      if (!prefixes.has(c.matchedPrefix as string)) return false; // invented category
      classified += 1;
    }
  }

  if (typeof decision.total !== "number" || decision.total !== codes.length) return false;
  if (decision.classifiedCount !== classified) return false;
  if (decision.unclassifiedCount !== codes.length - classified) return false;
  const expectedDisposition: CodeTaxonomyDisposition =
    codes.length - classified > 0 ? "unclassified-present" : "all-classified";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }
  return true;
}

/**
 * Consistency check: rebuilding the trie from the taxonomy and re-running the longest-prefix match over each
 * submitted code must reproduce the reported category + matched prefix. True only when the recompute agrees.
 * Catches a wrong bucket or a missed match. The load-bearing correctness gate — it recomputes the match from
 * the taxonomy INDEPENDENT of the reported classifications (it filters them to the ones whose code is a real
 * submitted code before checking their category + prefix), so a fabricated-code classification that still
 * reports a correct match fails sourced while recomputing here, and a real-code but wrong-bucket
 * classification fails here while passing sourced — the two gates are isolable. Anything
 * evaluateCodeTaxonomy() produces satisfies it. A non-object input is a violation.
 */
export function classificationConsistent(
  decision:
    | { taxonomy?: unknown; codes?: unknown; classifications?: unknown }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const taxonomy = Array.isArray(decision.taxonomy) ? (decision.taxonomy as TaxonomyEntry[]) : null;
  const codes = Array.isArray(decision.codes) ? (decision.codes as CodeInput[]) : null;
  const classifications = Array.isArray(decision.classifications)
    ? (decision.classifications as CodeClassification[])
    : null;
  if (!taxonomy || !codes || !classifications) return false;

  const root = buildTrie(taxonomy);
  const submitted = new Set(codes.map((c) => c.code));

  for (const c of classifications) {
    if (!submitted.has(c.code)) continue; // fabricated code — isolated to the sourced gate
    const match = longestPrefixMatch(root, c.code);
    const expectedCategory = match ? match.category : null;
    const expectedPrefix = match ? match.prefix : null;
    if ((c.category ?? null) !== expectedCategory) return false;
    if ((c.matchedPrefix ?? null) !== expectedPrefix) return false;
  }
  return true;
}

/**
 * No-autonomous-recode check: did the agent avoid re-coding on its own? True unless the determination reports
 * it auto-applied (autoApplied:true) or does not require coder review (requiresCoderReview:false). Anything
 * evaluateCodeTaxonomy() produces satisfies it. This is the honest signal the batch reports to
 * policy.code.no-autonomous-recode. A non-object input is a violation.
 */
export function noAutonomousRecode(
  decision: { autoApplied?: boolean; requiresCoderReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoApplied === true) return false;
  if (decision.requiresCoderReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a classification batch. */
export function codeTaxonomySummary(decision: CodeTaxonomyDetermination): {
  catalogRef: string;
  disposition: CodeTaxonomyDisposition;
  codeCount: number;
  prefixCount: number;
  classifiedCount: number;
  unclassifiedCount: number;
  total: number;
  requiresCoderReview: boolean;
  synthetic: boolean;
} {
  return {
    catalogRef: decision.catalogRef,
    disposition: decision.disposition,
    codeCount: decision.codes.length,
    prefixCount: decision.taxonomy.length,
    classifiedCount: decision.classifiedCount,
    unclassifiedCount: decision.unclassifiedCount,
    total: decision.total,
    requiresCoderReview: decision.requiresCoderReview,
    synthetic: decision.synthetic
  };
}

/** An illustrative synthetic menopause / endocrine ICD-10 code-group taxonomy. */
const DEMO_TAXONOMY: TaxonomyEntry[] = [
  { prefix: "E28", category: "Ovarian dysfunction", label: "E28.x" },
  { prefix: "E28.3", category: "Primary ovarian failure (menopause-related)", label: "E28.3x" },
  { prefix: "N95", category: "Menopausal & perimenopausal disorders", label: "N95.x" },
  { prefix: "E11", category: "Type 2 diabetes mellitus", label: "E11.x" }
];

/**
 * A representative demo request whose batch mixes classified codes (including a longest-prefix specificity
 * case, E28.310 -> E28.3 not E28) and one unclassified code (Z00.00). Synthetic terminology.
 */
export const DEMO_CODE_TAXONOMY_REQUEST: CodeTaxonomyRequest = {
  catalogRef: "code-catalog-001",
  taxonomy: DEMO_TAXONOMY,
  codes: [
    { code: "E28.310", label: "Symptomatic premature menopause" },
    { code: "E28.9", label: "Ovarian dysfunction, unspecified" },
    { code: "N95.1", label: "Menopausal & female climacteric states" },
    { code: "E11.9", label: "Type 2 diabetes without complications" },
    { code: "Z00.00", label: "General adult medical exam" }
  ]
};

/** A representative demo request whose codes all classify (all-classified). Synthetic. */
export const DEMO_CODE_TAXONOMY_ALL_REQUEST: CodeTaxonomyRequest = {
  catalogRef: "code-catalog-002",
  taxonomy: DEMO_TAXONOMY,
  codes: [
    { code: "N95.0", label: "Postmenopausal bleeding" },
    { code: "E28.2", label: "Polycystic ovarian syndrome" },
    { code: "E11.65", label: "Type 2 diabetes with hyperglycemia" }
  ]
};

/**
 * A representative demo request highlighting longest-prefix specificity: E28.319 matches E28.3 (not the
 * shallower E28), while E28.1 falls back to E28. Synthetic.
 */
export const DEMO_CODE_TAXONOMY_SPECIFIC_REQUEST: CodeTaxonomyRequest = {
  catalogRef: "code-catalog-003",
  taxonomy: DEMO_TAXONOMY,
  codes: [
    { code: "E28.319", label: "Premature menopause, unspecified" },
    { code: "E28.1", label: "Androgen excess" }
  ]
};
