/**
 * Status Timeline Compression / Run-Length Encoding (RLE) — the deterministic, transparent data-substrate layer
 * that, given a long per-slot STATUS stream (a device state / bed-occupancy / monitoring status recorded once per
 * time slot), compresses it into a sequence of RUNS — (value, length) pairs, one per maximal block of identical
 * consecutive statuses — reporting the run count, the compression ratio, the longest run, and the dominant
 * status — without ever writing the compressed timeline back to a source of record on its own. A data steward
 * confirms.
 *
 * Deterministic, dependency-free domain core the Status Timeline RLE agent (app/api/agents/status-timeline-rle)
 * wraps — a stream-compression agent on the platform & data-substrate plane of Pause's Agent Fabric. CRUCIALLY,
 * the heart of this service is RUN-LENGTH ENCODING: a single left-to-right pass that coalesces each maximal block
 * of identical consecutive values into one (value, length) run — the canonical, provably-unique RLE of the
 * stream, and losslessly REVERSIBLE (decoding the runs reproduces the exact original). This is a genuinely NEW
 * computation pattern for the fabric: it is NOT the Huffman agent's OPTIMAL PREFIX CODING (a FREQUENCY-based
 * variable-length code over the alphabet — this is CONSECUTIVE-RUN coalescing, order-dependent, no frequency
 * model), NOT the Coverage Heatmap agent's DIFFERENCE-ARRAY RANGE ACCUMULATION, NOT the Rolling Census Peak
 * agent's SLIDING-WINDOW MAXIMUM, NOT the Timeline Merge agent's K-WAY MERGE (which interleaves multiple sorted
 * streams — this compresses ONE stream), and NOT the List Reconciliation agent's LONGEST COMMON SUBSEQUENCE — it
 * is run-length encoding. The exact, reversible run list is the invariant this service reports and defends.
 *
 *   Inbound:  a StatusTimelineRequest { streamRef, statuses[] }
 *   Outbound: a StatusTimelineDetermination { runs[], runCount, originalLength, compressionRatio, longestRun,
 *             dominantStatus, disposition, requiresStewardReview:true, autoWritten:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the encoding is sourced and self-consistent (it decodes back exactly).
 * ─────────────────────────────────────────────────────────────────────
 *  An encoding is trustworthy only if it is a REAL, lossless accounting of the submitted stream: DECODING the
 *  runs (concatenating each run's value repeated `length` times, in order) must reproduce EXACTLY the submitted
 *  statuses — same values, same order, same length — with every run length ≥ 1, the reported runCount equal to
 *  the number of runs, originalLength equal to the stream length, compressionRatio / longestRun / dominantStatus
 *  honest, and the disposition following. A fabricated run, a wrong length, or a reordered decode corrupts the
 *  encoding. encodingSourced() verifies it; the Agent Fabric enforces it via policy.statusrle.encoding-sourced.
 *  It does NOT recompute the canonical RLE — that is the canonical gate's job — so the two are isolable. (The
 *  sourced + self-consistency gate — mirrors the Huffman Agent's code-sourced and the Rolling Census Peak Agent's
 *  windows-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the runs are canonical (RLE re-derives the unique maximal-run encoding).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running run-length encoding over the submitted statuses must reproduce the EXACT run list — RLE has a
 *  UNIQUE canonical form (maximal runs: adjacent runs never share a value), so any over-split run (e.g. [A×2]
 *  reported as [A×1][A×1]) is a non-canonical encoding even though it still decodes correctly. runsCanonical()
 *  re-derives the canonical runs INDEPENDENT of the reported runs, so an over-split-but-decodable encoding fails
 *  canonical only (it still passes sourced), while a fabricated run that doesn't decode fails sourced only — the
 *  two gates are isolable. The Agent Fabric enforces it via policy.statusrle.runs-canonical. (The load-bearing
 *  correctness gate — mirrors the Rolling Census Peak Agent's deque-exact and the Huffman Agent's code-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous write-back.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent COMPRESSES on paper — it never writes the compressed timeline back to a source of record, replaces
 *  the raw stream, or persists the encoding on its own (each is a data-write that must be authorized); every
 *  encoding is a RECOMMENDATION requiring a data steward to confirm. noAutonomousWrite() reports the honest
 *  signal the Agent Fabric enforces via policy.statusrle.no-autonomous-write. (Mirrors the Timeline Merge Agent's
 *  no-autonomous-merge and the Rolling Census Peak Agent's no-autonomous-divert — the harmful action is
 *  enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  An encoding — compressible or incompressible — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresStewardReview:true, autoWritten:false). An incompressible disposition is NOT a governance block — it
 *  is the honest finding that the stream has no consecutive repeats worth encoding (RLE gains nothing). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (a run list that doesn't decode, a
 *  non-canonical encoding, or an autonomous write-back) — which the Agent Fabric rejects before it can leave the
 *  fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified time-series / telemetry compression system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real telemetry compression uses delta / delta-of-delta encoding, dictionary methods, Gorilla-style float
 *  compression, and lossy downsampling — not a bare RLE over illustrative status labels. This compresses the
 *  supplied illustrative statuses only. TIME IS DATA: the statuses are plain values and the encoding is a pure
 *  function of them (no clock, no randomness), so the same request always yields the same determination, which is
 *  what lets the demo, the seeded trace, and the tests agree. The stream is a clearly-labeled ILLUSTRATIVE
 *  synthetic. The statuses reference a device / bed monitoring timeline, so a determination is treated as
 *  PHI-adjacent and the agent is on the HIPAA audit path.
 */

/** One run: a value repeated `length` consecutive times. */
export type Run = {
  value: string;
  /** Run length, ≥ 1. */
  length: number;
};

/** A request: the per-slot status stream to compress. */
export type StatusTimelineRequest = {
  streamRef: string;
  /** Per-slot status values, in time order. */
  statuses: string[];
};

export type StatusTimelineDisposition = "compressible" | "incompressible";

/** The deterministic finding the agent returns. */
export type StatusTimelineDetermination = {
  streamRef: string;
  statuses: string[];
  /** The canonical run-length encoding (maximal runs). */
  runs: Run[];
  runCount: number;
  originalLength: number;
  /** originalLength / runCount, rounded to 4 dp (1 when there are no runs). */
  compressionRatio: number;
  /** The longest single run length (0 when empty). */
  longestRun: number;
  /** The status with the most total slots (ties broken by first appearance); "" when empty. */
  dominantStatus: string;
  disposition: StatusTimelineDisposition;
  /** Always true — a data steward confirms every encoding. */
  requiresStewardReview: true;
  /** Always false — the agent never autonomously writes the timeline back. */
  autoWritten: false;
  reason: string;
  synthetic: true;
  note: string;
};

/**
 * RUN-LENGTH ENCODE — the heart of the service. A single left-to-right pass coalescing each maximal block of
 * identical consecutive values into one (value, length) run. The canonical, provably-unique RLE (adjacent runs
 * never share a value). Pure — a function of the statuses only.
 */
export function runLengthEncode(statuses: string[]): Run[] {
  const s = Array.isArray(statuses) ? statuses : [];
  const runs: Run[] = [];
  for (let i = 0; i < s.length; i++) {
    const prev = runs[runs.length - 1];
    if (prev && prev.value === s[i]) {
      prev.length += 1;
    } else {
      runs.push({ value: s[i], length: 1 });
    }
  }
  return runs;
}

/** DECODE runs back to the flat status stream (value repeated `length` times, in order). Pure. */
export function runLengthDecode(runs: Run[]): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(runs) ? runs : []) {
    const n = Math.max(0, Math.floor(r.length));
    for (let i = 0; i < n; i++) out.push(r.value);
  }
  return out;
}

/** Round to 4 dp for a stable compression-ratio comparison. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** The dominant status (most total slots), ties broken by first appearance. "" for an empty stream. */
function dominantOf(statuses: string[]): string {
  const totals = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  statuses.forEach((v, i) => {
    totals.set(v, (totals.get(v) ?? 0) + 1);
    if (!firstSeen.has(v)) firstSeen.set(v, i);
  });
  let best = "";
  let bestTotal = -1;
  let bestFirst = Infinity;
  for (const [v, total] of totals) {
    const first = firstSeen.get(v)!;
    if (total > bestTotal || (total === bestTotal && first < bestFirst)) {
      best = v;
      bestTotal = total;
      bestFirst = first;
    }
  }
  return best;
}

/**
 * The deterministic compression function — DETERMINISTIC: a pure function of the request's own statuses (no
 * randomness, no clock). It run-length-encodes the stream, tallies the run count / ratio / longest run / dominant
 * status, and derives the disposition. Nothing is written back — the encoding is handed to a data steward.
 */
export function evaluateStatusTimeline(request: StatusTimelineRequest): StatusTimelineDetermination {
  const statuses = Array.isArray(request.statuses) ? request.statuses : [];
  const runs = runLengthEncode(statuses);
  const runCount = runs.length;
  const originalLength = statuses.length;
  const compressionRatio = runCount === 0 ? 1 : round4(originalLength / runCount);
  const longestRun = runs.reduce((acc, r) => Math.max(acc, r.length), 0);
  const dominantStatus = dominantOf(statuses);
  // "Compressible" means RLE actually shrinks the stream (fewer runs than slots — i.e. some consecutive repeat).
  const disposition: StatusTimelineDisposition =
    originalLength > 0 && runCount < originalLength ? "compressible" : "incompressible";

  const reason =
    disposition === "compressible"
      ? `Compressed ${originalLength} status slot(s) of ${request.streamRef} into ${runCount} run(s) (ratio ${compressionRatio}×, longest run ${longestRun}, dominant "${dominantStatus}").`
      : `Stream ${request.streamRef} is INCOMPRESSIBLE by RLE — ${originalLength} slot(s) yield ${runCount} run(s) (no consecutive repeats to coalesce); run-length encoding gains nothing.`;

  return {
    streamRef: request.streamRef,
    statuses,
    runs,
    runCount,
    originalLength,
    compressionRatio,
    longestRun,
    dominantStatus,
    disposition,
    requiresStewardReview: true,
    autoWritten: false,
    reason,
    synthetic: true,
    note:
      `Run-length encoding ${request.streamRef}: ${disposition.toUpperCase()} — ` +
      `${originalLength} slot(s) → ${runCount} run(s) (ratio ${compressionRatio}×, longest run ${longestRun}) via RUN-LENGTH ENCODING. ` +
      "Real telemetry compression uses delta / delta-of-delta encoding, dictionary methods, Gorilla-style float compression, and lossy downsampling — not a bare RLE over illustrative status labels. Synthetic/illustrative statuses — NOT a certified time-series / telemetry compression system. The agent never writes the compressed timeline back to a source of record on its own — a data steward confirms every encoding. The statuses reference a device / bed monitoring timeline, so a determination is PHI-adjacent and on the HIPAA audit path."
  };
}

/**
 * Sourced + self-consistency check: is the reported encoding a REAL, lossless accounting of the submitted
 * stream? DECODING the runs must reproduce EXACTLY the submitted statuses (same values, order, and length), every
 * run length must be ≥ 1, the reported runCount equal to the number of runs, originalLength equal to the stream
 * length, compressionRatio / longestRun / dominantStatus honest, and the disposition following. Catches a
 * fabricated run, a wrong length, or a reordered decode. Does NOT recompute the canonical RLE (that is the
 * canonical gate's job), so it is independent of it — an over-split-but-decodable encoding still passes sourced.
 * Anything evaluateStatusTimeline() produces satisfies it. This is the honest signal the encoding reports to
 * policy.statusrle.encoding-sourced. A non-object / malformed input is a violation.
 */
export function encodingSourced(
  decision:
    | {
        statuses?: unknown;
        runs?: unknown;
        runCount?: unknown;
        originalLength?: unknown;
        compressionRatio?: unknown;
        longestRun?: unknown;
        dominantStatus?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const statuses = Array.isArray(decision.statuses) ? (decision.statuses as string[]) : null;
  const runs = Array.isArray(decision.runs) ? (decision.runs as Run[]) : null;
  if (!statuses || !runs) return false;
  for (const v of statuses) if (typeof v !== "string") return false;
  for (const r of runs) {
    if (!r || typeof r.value !== "string" || typeof r.length !== "number" || !Number.isInteger(r.length) || r.length < 1) {
      return false;
    }
  }

  // Decode and require an EXACT match to the submitted stream.
  const decoded = runLengthDecode(runs);
  if (decoded.length !== statuses.length) return false;
  for (let i = 0; i < statuses.length; i++) if (decoded[i] !== statuses[i]) return false;

  if (decision.runCount !== undefined && decision.runCount !== runs.length) return false;
  if (decision.originalLength !== undefined && decision.originalLength !== statuses.length) return false;

  const expectedRatio = runs.length === 0 ? 1 : round4(statuses.length / runs.length);
  if (decision.compressionRatio !== undefined && round4(decision.compressionRatio as number) !== expectedRatio) {
    return false;
  }
  const expectedLongest = runs.reduce((acc, r) => Math.max(acc, r.length), 0);
  if (decision.longestRun !== undefined && decision.longestRun !== expectedLongest) return false;

  const expectedDominant = dominantOf(statuses);
  if (decision.dominantStatus !== undefined && decision.dominantStatus !== expectedDominant) return false;

  const expectedDisposition: StatusTimelineDisposition =
    statuses.length > 0 && runs.length < statuses.length ? "compressible" : "incompressible";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * Canonical check: re-running run-length encoding over the submitted statuses must reproduce the EXACT run list.
 * RLE has a UNIQUE canonical form (maximal runs — adjacent runs never share a value), so any over-split or
 * mis-merged run list is non-canonical even if it still decodes correctly. True only when the recompute agrees,
 * run for run (value + length). The load-bearing correctness gate — it re-derives the canonical runs INDEPENDENT
 * of the reported runs, so an over-split-but-decodable encoding fails here while a fabricated run that doesn't
 * decode fails sourced — the two gates are isolable. Anything evaluateStatusTimeline() produces satisfies it. A
 * non-object input is a violation.
 */
export function runsCanonical(
  decision: { statuses?: unknown; runs?: unknown } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const statuses = Array.isArray(decision.statuses) ? (decision.statuses as string[]) : null;
  const runs = Array.isArray(decision.runs) ? (decision.runs as Run[]) : null;
  if (!statuses || !runs) return false;
  for (const v of statuses) if (typeof v !== "string") return false;
  for (const r of runs) {
    if (!r || typeof r.value !== "string" || typeof r.length !== "number") return false;
  }

  const canonical = runLengthEncode(statuses);
  if (runs.length !== canonical.length) return false;
  for (let i = 0; i < canonical.length; i++) {
    if (runs[i].value !== canonical[i].value || runs[i].length !== canonical[i].length) return false;
  }
  return true;
}

/**
 * No-autonomous-write check: did the agent avoid writing the timeline back on its own? True unless the
 * determination reports it auto-wrote (autoWritten:true) or does not require steward review
 * (requiresStewardReview:false). Anything evaluateStatusTimeline() produces satisfies it. This is the honest
 * signal the encoding reports to policy.statusrle.no-autonomous-write. A non-object input is a violation.
 */
export function noAutonomousWrite(
  decision: { autoWritten?: boolean; requiresStewardReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoWritten === true) return false;
  if (decision.requiresStewardReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of an encoding. */
export function statusTimelineSummary(decision: StatusTimelineDetermination): {
  streamRef: string;
  disposition: StatusTimelineDisposition;
  originalLength: number;
  runCount: number;
  compressionRatio: number;
  longestRun: number;
  dominantStatus: string;
  requiresStewardReview: boolean;
  synthetic: boolean;
} {
  return {
    streamRef: decision.streamRef,
    disposition: decision.disposition,
    originalLength: decision.originalLength,
    runCount: decision.runCount,
    compressionRatio: decision.compressionRatio,
    longestRun: decision.longestRun,
    dominantStatus: decision.dominantStatus,
    requiresStewardReview: decision.requiresStewardReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request: a 16-slot remote-monitoring device status stream with long stable runs and a
 * couple of transient states. Compresses to a handful of runs. "Compressible." Synthetic; PHI-adjacent (device
 * monitoring timeline).
 *
 * Statuses: normal×5, high×3, normal×4, sync-error×1, normal×3 → 5 runs from 16 slots.
 */
export const DEMO_STATUS_TIMELINE_REQUEST: StatusTimelineRequest = {
  streamRef: "rpm-device-status-2026-6601",
  statuses: [
    "normal",
    "normal",
    "normal",
    "normal",
    "normal",
    "high",
    "high",
    "high",
    "normal",
    "normal",
    "normal",
    "normal",
    "sync-error",
    "normal",
    "normal",
    "normal"
  ]
};

/**
 * A representative demo request whose statuses alternate every slot — RLE yields one run per slot, no gain.
 * "Incompressible." Synthetic.
 */
export const DEMO_STATUS_TIMELINE_INCOMPRESSIBLE_REQUEST: StatusTimelineRequest = {
  streamRef: "rpm-device-status-2026-6602",
  statuses: ["on", "off", "on", "off", "on", "off"]
};

/**
 * A representative demo request that is one long stable run — maximal compression (one run from many slots).
 * "Compressible." Synthetic.
 */
export const DEMO_STATUS_TIMELINE_STABLE_REQUEST: StatusTimelineRequest = {
  streamRef: "bed-occupancy-status-2026-6603",
  statuses: ["occupied", "occupied", "occupied", "occupied", "occupied", "occupied", "occupied", "occupied"]
};
