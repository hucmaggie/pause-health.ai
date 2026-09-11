/**
 * Event-Stream Code Assignment / Huffman Optimal Prefix Coding — the deterministic, transparent data-plane
 * layer that, given a set of event / message TYPES flowing across the integration bus — each type with an
 * observed FREQUENCY (its share of the stream volume) — assigns an OPTIMAL PREFIX-FREE binary code that
 * minimizes the total encoded length (the sum over types of frequency × code length), so a high-volume
 * telemetry / event stream (remote-monitoring device events, claim-event codes, sync / ack messages) can be
 * transmitted as compactly as possible — without ever deploying the codec to the live bus or re-encoding the
 * production stream. An integration engineer confirms.
 *
 * Deterministic, dependency-free domain core the Huffman Coding agent (app/api/agents/huffman-coding) wraps — a
 * code-assignment agent on the platform & data-substrate plane of Pause's Agent Fabric. CRUCIALLY, this is NOT
 * the Code Taxonomy agent's TRIE LONGEST-PREFIX MATCH (which walks a code down a prefix tree of taxonomy
 * categories to bucket it — a lookup, not a code construction) and NOT the Identifier Validation agent's
 * MODULAR-ARITHMETIC CHECKSUM. It is also UNLIKE the Source Consensus agent's BOYER–MOORE MAJORITY VOTE, the
 * Timeline Merge agent's K-WAY MERGE, the List Reconciliation agent's LONGEST COMMON SUBSEQUENCE, the SLA
 * Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, the Peak-Window agent's KADANE MAXIMUM-SUBARRAY, the
 * Care Routing agent's DIJKSTRA'S SHORTEST PATH, the Outreach agent's 0/1 KNAPSACK, the PCP Matching agent's
 * GALE–SHAPLEY STABLE MATCHING, the Household Composition agent's UNION-FIND, the Provider Benchmarking
 * agent's PERCENTILE / RANK STATISTICS, or the MLR Rebate agent's LARGEST-REMAINDER APPORTIONMENT. The heart
 * of this service is HUFFMAN CODING: build the optimal prefix-free code by repeatedly merging the two
 * lowest-frequency nodes into a subtree (a greedy priority-queue construction), then read each symbol's code
 * off the root-to-leaf path. Huffman is provably optimal — no prefix-free code assigns a smaller total encoded
 * length — and the total encoded length is the invariant this service reports and defends.
 *
 *   Inbound:  a HuffmanRequest { streamRef, symbols[] }  (each symbol an event type + its frequency)
 *   Outbound: a HuffmanDetermination { codes[], weightedTotal, fixedWidth, fixedTotal, disposition,
 *             requiresEngineerReview:true, autoDeployed:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the code is sourced and self-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  A code assignment is trustworthy only if it is a REAL, self-consistent accounting of the submitted symbols:
 *  the reported codes must cover EXACTLY the submitted symbols (each symbol once — no fabricated symbol, none
 *  dropped or double-coded), each code must be a non-empty binary string whose reported length matches, each
 *  symbol's frequency must be echoed, the code must be PREFIX-FREE (no code is a prefix of another — the
 *  property that makes it uniquely decodable), the reported weightedTotal must equal the sum of frequency ×
 *  length, the fixed-width baseline must be computed honestly, and the disposition must follow. A fabricated
 *  symbol, a non-prefix-free code, or an overstated total corrupts the assignment. codeSourced() verifies it;
 *  the Agent Fabric enforces it via policy.huffcode.code-sourced. It does NOT recompute the Huffman optimum —
 *  that is the optimality gate's job — so the two are isolable. (The sourced + self-consistency gate — mirrors
 *  the List Reconciliation Agent's diff-sourced and the SLA Worklist Agent's schedule-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the code is the optimal (minimal-length).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running the Huffman construction over the submitted frequencies must reproduce the reported
 *  weightedTotal (and disposition). A sub-optimal prefix code (a fixed-width code, or any tree that isn't the
 *  Huffman tree) wastes bandwidth on every message — the whole point of the coding. codeOptimal() recomputes
 *  the minimal total encoded length INDEPENDENT of the reported codes (it recomputes the scalar optimum from
 *  the frequencies, not from the reported code strings — different optimal trees achieve the same optimal
 *  length), so a fabricated code that still reports the optimal length fails sourced only, and a real-but-
 *  sub-optimal code fails optimal only — the two gates are isolable. The Agent Fabric enforces it via
 *  policy.huffcode.code-optimal. (The load-bearing correctness gate — mirrors the List Reconciliation Agent's
 *  lcs-optimal and the Care Routing Agent's route-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous deploy.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent ASSIGNS on paper — it never deploys the codec to the live integration bus or re-encodes the
 *  production stream on its own (each is an infrastructure change that must be authorized); every assignment is
 *  a RECOMMENDATION requiring an integration engineer to confirm. noAutonomousDeploy() reports the honest
 *  signal the Agent Fabric enforces via policy.huffcode.no-autonomous-deploy. (Mirrors the List Reconciliation
 *  Agent's no-autonomous-update and the SLA Worklist Agent's no-autonomous-dispatch — the harmful action is
 *  enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A code assignment — compressible or already-uniform — is a SAFE, honest OUTPUT: the task COMPLETES (it
 *  carries requiresEngineerReview:true, autoDeployed:false). A GOVERNANCE BLOCK is when a caller PRESENTS an
 *  offending DETERMINATION (a fabricated / non-prefix-free code, a sub-optimal code, or an autonomous deploy) —
 *  which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified codec / compression system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real stream compression uses context modeling, arithmetic / range coding, dictionary methods (LZ77 / LZMA),
 *  and adaptive codebooks — not a bare static Huffman over a handful of event types. This assigns codes over
 *  the supplied illustrative frequencies only. TIME IS DATA: the frequencies are plain numbers and the coding
 *  is a pure function of them (no clock, no randomness), so the same request always yields the same
 *  determination, which is what lets the demo, the seeded trace, and the tests agree. The symbols are a
 *  clearly-labeled ILLUSTRATIVE synthetic. It is DELIBERATELY NOT PHI-bearing — an event-type frequency is
 *  aggregate integration telemetry, not patient health information.
 */

/** One event / message type + its observed frequency (share of the stream volume). */
export type HuffmanSymbol = {
  symbol: string;
  /** Observed frequency / volume. Non-negative. */
  frequency: number;
};

/** A request: one stream + its event-type frequencies. */
export type HuffmanRequest = {
  streamRef: string;
  symbols: HuffmanSymbol[];
};

export type HuffmanDisposition = "compressible" | "already-uniform";

/** One symbol's assigned code. */
export type SymbolCode = {
  symbol: string;
  /** The assigned prefix-free binary code (a string of "0"/"1"). */
  code: string;
  length: number;
  frequency: number;
};

/** The deterministic finding the agent returns. */
export type HuffmanDetermination = {
  streamRef: string;
  /** The submitted symbols, echoed so the guards can recompute. */
  symbols: HuffmanSymbol[];
  /** The assigned codes, in submitted order. */
  codes: SymbolCode[];
  /** The total encoded length — sum of frequency × code length (the Huffman optimum). */
  weightedTotal: number;
  /** Bits per symbol under a naive fixed-width code — ceil(log2(n)). */
  fixedWidth: number;
  /** The fixed-width baseline total — fixedWidth × total frequency. */
  fixedTotal: number;
  disposition: HuffmanDisposition;
  /** Always true — an engineer confirms every code assignment. */
  requiresEngineerReview: true;
  /** Always false — the agent never autonomously deploys the codec. */
  autoDeployed: false;
  reason: string;
  synthetic: true;
  note: string;
};

type Node = {
  freq: number;
  order: number;
  symbol?: string;
  left?: Node;
  right?: Node;
};

/** The fixed-width bits-per-symbol baseline: ceil(log2(n)) for n≥2, else 0. */
export function fixedWidthBits(n: number): number {
  if (n <= 1) return 0;
  return Math.ceil(Math.log2(n));
}

/**
 * Build the HUFFMAN TREE deterministically — the heart of the service. Start with one leaf per symbol, then
 * repeatedly merge the two lowest-frequency nodes into a subtree until one root remains. Ties are broken by a
 * stable creation-order counter (earlier node first), so the tree — and thus the codes — are deterministic.
 * A single symbol is wrapped in a parent so it receives a one-bit code.
 */
function buildTree(symbols: HuffmanSymbol[]): Node | null {
  if (symbols.length === 0) return null;
  let order = 0;
  const nodes: Node[] = symbols.map((s) => ({ freq: s.frequency, order: order++, symbol: s.symbol }));
  if (nodes.length === 1) {
    return { freq: nodes[0].freq, order: order++, left: nodes[0] };
  }
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.freq - b.freq || a.order - b.order);
    const a = nodes.shift() as Node;
    const b = nodes.shift() as Node;
    nodes.push({ freq: a.freq + b.freq, order: order++, left: a, right: b });
  }
  return nodes[0];
}

/** Walk the tree assigning "0" to left / "1" to right, collecting each symbol's code. */
function collectCodes(node: Node, prefix: string, out: Map<string, string>): void {
  if (node.symbol !== undefined) {
    out.set(node.symbol, prefix === "" ? "0" : prefix);
    return;
  }
  if (node.left) collectCodes(node.left, prefix + "0", out);
  if (node.right) collectCodes(node.right, prefix + "1", out);
}

/**
 * HUFFMAN CODING — build the optimal prefix-free code and return one code per symbol, in submitted order,
 * echoing each symbol's frequency. Deterministic (stable tie-break). Empty input → [].
 */
export function buildHuffmanCodes(symbols: HuffmanSymbol[]): SymbolCode[] {
  const tree = buildTree(symbols);
  if (!tree) return [];
  const codeMap = new Map<string, string>();
  collectCodes(tree, "", codeMap);
  return symbols.map((s) => {
    const code = codeMap.get(s.symbol) ?? "";
    return { symbol: s.symbol, code, length: code.length, frequency: s.frequency };
  });
}

/**
 * The minimal total encoded length (the scalar optimum) — recomputed by the optimality gate independent of any
 * reported code. Σ frequency × optimal-code-length.
 */
export function huffmanOptimalLength(symbols: HuffmanSymbol[]): number {
  return buildHuffmanCodes(symbols).reduce((acc, c) => acc + c.length * c.frequency, 0);
}

/**
 * The deterministic code-assignment function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own symbols (no randomness, no clock). It builds the Huffman code, sums the weighted total,
 * computes the fixed-width baseline, and derives the disposition. Nothing is deployed — the assignment is
 * handed to an engineer.
 */
export function evaluateHuffman(request: HuffmanRequest): HuffmanDetermination {
  const symbols = Array.isArray(request.symbols) ? request.symbols : [];
  const codes = buildHuffmanCodes(symbols);
  const weightedTotal = codes.reduce((acc, c) => acc + c.length * c.frequency, 0);
  const totalFreq = symbols.reduce((acc, s) => acc + s.frequency, 0);
  const fixedWidth = fixedWidthBits(symbols.length);
  const fixedTotal = fixedWidth * totalFreq;
  const disposition: HuffmanDisposition = weightedTotal < fixedTotal ? "compressible" : "already-uniform";

  const reason =
    disposition === "compressible"
      ? `Assigned an optimal prefix code to ${symbols.length} event type(s) for ${request.streamRef} \u2014 ${weightedTotal} bits vs ${fixedTotal} fixed-width (${fixedTotal - weightedTotal} saved).`
      : `Assigned an optimal prefix code to ${symbols.length} event type(s) for ${request.streamRef} \u2014 no gain over the ${fixedWidth}-bit fixed-width code.`;

  return {
    streamRef: request.streamRef,
    symbols,
    codes,
    weightedTotal,
    fixedWidth,
    fixedTotal,
    disposition,
    requiresEngineerReview: true,
    autoDeployed: false,
    reason,
    synthetic: true,
    note:
      `Huffman coding ${request.streamRef}: ${disposition.toUpperCase()} \u2014 ` +
      `${symbols.length} event type(s) coded to ${weightedTotal} total bits (fixed-width baseline ${fixedTotal}) via HUFFMAN OPTIMAL PREFIX CODING. ` +
      "Real stream compression uses context modeling, arithmetic / range coding, dictionary methods (LZ77 / LZMA), and adaptive codebooks \u2014 not a bare static Huffman over a handful of event types. Synthetic/illustrative frequencies \u2014 NOT a certified codec / compression system. The agent never deploys the codec to the live bus or re-encodes the production stream on its own \u2014 an integration engineer confirms every assignment. NOT PHI-bearing \u2014 an event-type frequency is aggregate integration telemetry."
  };
}

/** Is `a` a prefix of `b`? */
function isPrefix(a: string, b: string): boolean {
  return b.startsWith(a);
}

/**
 * Sourced + self-consistency check: is the reported code a REAL, self-consistent accounting of the submitted
 * symbols? The codes must cover EXACTLY the submitted symbols (each once — no fabricated symbol, none dropped
 * or double-coded), each code a non-empty binary string whose reported length matches, each frequency echoed,
 * the code PREFIX-FREE (no code a prefix of another), the reported weightedTotal equal to Σ frequency × length,
 * the fixed-width baseline computed honestly, and the disposition following. Catches a fabricated symbol, a
 * non-prefix-free code, or an overstated total. Does NOT recompute the Huffman optimum (that is the optimality
 * gate's job), so it is independent of it. Anything evaluateHuffman() produces satisfies it. This is the honest
 * signal the assignment reports to policy.huffcode.code-sourced. A non-object / malformed input is a violation.
 */
export function codeSourced(
  decision:
    | {
        symbols?: unknown;
        codes?: unknown;
        weightedTotal?: unknown;
        fixedWidth?: unknown;
        fixedTotal?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const symbols = Array.isArray(decision.symbols) ? (decision.symbols as HuffmanSymbol[]) : null;
  const codes = Array.isArray(decision.codes) ? (decision.codes as SymbolCode[]) : null;
  if (!symbols || !codes) return false;
  if (codes.length !== symbols.length) return false; // dropped / added

  // Index submitted symbols by name; require unique names.
  const freqBySymbol = new Map<string, number>();
  for (const s of symbols) {
    if (!s || typeof s.symbol !== "string" || typeof s.frequency !== "number") return false;
    if (freqBySymbol.has(s.symbol)) return false; // duplicate submitted symbol
    freqBySymbol.set(s.symbol, s.frequency);
  }

  const seen = new Set<string>();
  let weighted = 0;
  const codeStrings: string[] = [];
  for (const c of codes) {
    if (!c || typeof c !== "object") return false;
    if (typeof c.symbol !== "string") return false;
    if (seen.has(c.symbol)) return false; // double-coded
    const freq = freqBySymbol.get(c.symbol);
    if (freq === undefined) return false; // fabricated symbol
    seen.add(c.symbol);
    // Code must be a non-empty binary string with matching length + echoed frequency.
    if (typeof c.code !== "string" || c.code.length === 0) return false;
    if (!/^[01]+$/.test(c.code)) return false;
    if (c.length !== c.code.length) return false;
    if (c.frequency !== freq) return false;
    weighted += c.code.length * freq;
    codeStrings.push(c.code);
  }

  // Prefix-free: no code may be a prefix of another (also rejects duplicate codes).
  for (let i = 0; i < codeStrings.length; i++) {
    for (let j = 0; j < codeStrings.length; j++) {
      if (i === j) continue;
      if (isPrefix(codeStrings[i], codeStrings[j])) return false;
    }
  }

  if (typeof decision.weightedTotal !== "number" || decision.weightedTotal !== weighted) return false;

  const totalFreq = symbols.reduce((acc, s) => acc + s.frequency, 0);
  const fixedWidth = fixedWidthBits(symbols.length);
  const fixedTotal = fixedWidth * totalFreq;
  if (decision.fixedWidth !== undefined && decision.fixedWidth !== fixedWidth) return false;
  if (decision.fixedTotal !== undefined && decision.fixedTotal !== fixedTotal) return false;

  const expectedDisposition: HuffmanDisposition = weighted < fixedTotal ? "compressible" : "already-uniform";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }
  return true;
}

/**
 * Optimality check: re-running the Huffman construction over the submitted frequencies must reproduce the
 * reported weightedTotal (and disposition). True only when the recompute agrees. Catches a sub-optimal prefix
 * code that wastes bandwidth. The load-bearing correctness gate — it recomputes the minimal total encoded
 * length from the frequencies INDEPENDENT of the reported codes (it compares the scalar optimum, not the code
 * strings), so a fabricated code that still reports the optimal length fails sourced only while a real-but-
 * sub-optimal code fails here — the two gates are isolable. Anything evaluateHuffman() produces satisfies it. A
 * non-object input is a violation.
 */
export function codeOptimal(
  decision: { symbols?: unknown; weightedTotal?: unknown; disposition?: unknown } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const symbols = Array.isArray(decision.symbols) ? (decision.symbols as HuffmanSymbol[]) : null;
  if (!symbols) return false;
  for (const s of symbols) {
    if (!s || typeof s.symbol !== "string" || typeof s.frequency !== "number") return false;
  }

  const optimal = huffmanOptimalLength(symbols);
  if (typeof decision.weightedTotal !== "number" || decision.weightedTotal !== optimal) return false;

  const totalFreq = symbols.reduce((acc, s) => acc + s.frequency, 0);
  const fixedTotal = fixedWidthBits(symbols.length) * totalFreq;
  const expectedDisposition: HuffmanDisposition = optimal < fixedTotal ? "compressible" : "already-uniform";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) {
    return false;
  }
  return true;
}

/**
 * No-autonomous-deploy check: did the agent avoid deploying on its own? True unless the determination reports
 * it auto-deployed the codec (autoDeployed:true) or does not require engineer review
 * (requiresEngineerReview:false). Anything evaluateHuffman() produces satisfies it. This is the honest signal
 * the assignment reports to policy.huffcode.no-autonomous-deploy. A non-object input is a violation.
 */
export function noAutonomousDeploy(
  decision: { autoDeployed?: boolean; requiresEngineerReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoDeployed === true) return false;
  if (decision.requiresEngineerReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a code assignment. */
export function huffmanSummary(decision: HuffmanDetermination): {
  streamRef: string;
  disposition: HuffmanDisposition;
  symbolCount: number;
  weightedTotal: number;
  fixedTotal: number;
  savedBits: number;
  requiresEngineerReview: boolean;
  synthetic: boolean;
} {
  return {
    streamRef: decision.streamRef,
    disposition: decision.disposition,
    symbolCount: decision.symbols.length,
    weightedTotal: decision.weightedTotal,
    fixedTotal: decision.fixedTotal,
    savedBits: decision.fixedTotal - decision.weightedTotal,
    requiresEngineerReview: decision.requiresEngineerReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: five remote-patient-monitoring device event types with skewed volumes. The
 * frequent "heartbeat" gets the shortest code and the rare "sync-error" the longest — 178 total bits vs 300
 * under a 3-bit fixed-width code. Synthetic; NOT PHI-bearing.
 */
export const DEMO_HUFFMAN_REQUEST: HuffmanRequest = {
  streamRef: "rpm-device-events",
  symbols: [
    { symbol: "heartbeat", frequency: 50 },
    { symbol: "reading-normal", frequency: 30 },
    { symbol: "reading-high", frequency: 12 },
    { symbol: "battery-low", frequency: 5 },
    { symbol: "sync-error", frequency: 3 }
  ]
};

/**
 * A representative demo request whose four event types are equally frequent — Huffman matches the 2-bit
 * fixed-width code exactly (already-uniform; no compression gain). Synthetic.
 */
export const DEMO_HUFFMAN_UNIFORM_REQUEST: HuffmanRequest = {
  streamRef: "queue-partitions",
  symbols: [
    { symbol: "queue-a", frequency: 10 },
    { symbol: "queue-b", frequency: 10 },
    { symbol: "queue-c", frequency: 10 },
    { symbol: "queue-d", frequency: 10 }
  ]
};

/**
 * A representative demo request with a heavily-skewed ack/nack stream — a large compression gain (130 bits vs
 * 200 fixed-width). Synthetic.
 */
export const DEMO_HUFFMAN_SKEWED_REQUEST: HuffmanRequest = {
  streamRef: "bus-ack-stream",
  symbols: [
    { symbol: "ack", frequency: 80 },
    { symbol: "nack", frequency: 10 },
    { symbol: "retry", frequency: 6 },
    { symbol: "drop", frequency: 4 }
  ]
};
