/**
 * Clinical Event Timeline Merge / Multi-Source Record Reconciliation — the deterministic, transparent
 * data-substrate layer that takes a patient's clinical EVENTS as they arrive in several already-sorted
 * source STREAMS (an EHR, another EHR, a pharmacy, a claims feed — each stream's events in ascending time
 * order) and merges them into ONE chronologically-ordered unified TIMELINE, flagging the DUPLICATES (the
 * SAME clinical event reported by more than one source), without ever writing the merged timeline back to a
 * source system of record — a data steward confirms.
 *
 * Deterministic, dependency-free domain core the Timeline Merge agent (app/api/agents/timeline-merge) wraps
 * — a platform / data-substrate service on the platform & data-substrate plane of Pause's Agent Fabric.
 * UNLIKE the Reportable Condition agent's RECURSIVE BOOLEAN EXPRESSION-TREE EVALUATION, the PCP Matching
 * agent's TWO-SIDED STABLE MATCHING (Gale–Shapley), the Network Adequacy agent's GEOSPATIAL GREAT-CIRCLE
 * DISTANCE, the Identifier Validation agent's MODULAR-ARITHMETIC CHECKSUM, the Household Composition agent's
 * UNION-FIND CONNECTED COMPONENTS, the Provider Benchmarking agent's PERCENTILE / RANK STATISTICS, the MLR
 * Rebate agent's LARGEST-REMAINDER APPORTIONMENT, the Claim Lifecycle agent's FSM TRANSITION VALIDATION, the
 * Medication Name Safety agent's STRING EDIT DISTANCE, the Schedule Conflict agent's GREEDY INTERVAL
 * SELECTION, the Caseload Balancing agent's GREEDY BIN-PACKING, the Access Anomaly agent's SLIDING-WINDOW
 * COUNTING, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment Reconciliation agent's KEYED
 * SET-DIFFERENCE, or the Audit Log Integrity agent's HASH CHAIN — and, CRUCIALLY, UNLIKE the Coverage
 * Continuity agent's INTERVAL MERGING (which merges OVERLAPPING date SPANS into continuous coverage; this
 * merges POINT events from many streams into one order) and the Master-Patient-Index agent's WEIGHTED
 * identity MATCHING (which resolves WHO a record belongs to; this runs AFTER identity is known, merging that
 * patient's already-resolved event streams) — the heart of this service is the K-WAY MERGE OF SORTED
 * STREAMS: the classic "merge k sorted lists" / external-sort merge phase that repeatedly takes the
 * earliest head across the k stream cursors to produce one globally-ordered sequence in linear time, plus a
 * content-key DEDUPLICATION pass that flags the second-and-later report of the same clinical event. A
 * mis-ordered or mis-deduplicated timeline corrupts the clinical record — a duplicated med looks like a
 * double dose, an out-of-order lab hides a trend — so this service merges deterministically and hands the
 * timeline to a human.
 *
 *   Inbound:  a TimelineMergeRequest { recordRef, streams[] }
 *   Outbound: a TimelineMergeDetermination { timeline[], sourceContributions[], totalSubmitted, keptCount,
 *             duplicateCount, disposition, requiresStewardReview:true, autoWritten:false, reason,
 *             synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every timeline event is sourced and every stream event is accounted for.
 * ─────────────────────────────────────────────────────────────────────
 *  A merged timeline is trustworthy only if it is built from the submitted streams: every timeline entry
 *  must trace to a SUBMITTED stream event (same source + eventId + timestamp + kind; no FABRICATED event),
 *  every submitted event must appear EXACTLY ONCE (none dropped, none double-listed), and the per-source
 *  contributions + kept / duplicate / total tallies must add up. A fabricated or dropped event silently
 *  corrupts the record. eventsSourced() verifies it; the Agent Fabric enforces it via
 *  policy.timeline.events-sourced. (The sourced + completeness gate — mirrors the Enrollment Reconciliation
 *  Agent's reconciliation-complete and the Caseload Balancing Agent's assignment-complete.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the merge order + dedup recompute.
 * ─────────────────────────────────────────────────────────────────────
 *  Recomputing the k-way merge of the submitted streams must reproduce the reported chronological order (the
 *  timestamps non-decreasing, ties broken deterministically by source then eventId) and the reported
 *  duplicate flags (an event flagged duplicate genuinely repeats an earlier kept event with the same content
 *  key; a kept event genuinely does not). A mis-ordered or mis-flagged timeline hides a trend or fakes a
 *  double dose. mergeConsistent() recomputes it end-to-end; the Agent Fabric enforces it via
 *  policy.timeline.merge-consistent. (The load-bearing correctness gate — mirrors the Reportable Condition
 *  Agent's classification-consistent and the Care Pathway Agent's sequence-valid.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: the timeline is never autonomously written.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent MERGES — it never WRITES the merged timeline back to a source system of record, purges a
 *  "duplicate", or overwrites a chart on its own (each is a data-integrity action that must be authorized);
 *  every merge is a RECOMMENDATION requiring a data steward to confirm. noAutonomousMerge() reports the
 *  honest signal the Agent Fabric enforces via policy.timeline.no-autonomous-merge. (Mirrors the Enrollment
 *  Reconciliation Agent's no-autonomous-change and the Audit Log Integrity Agent's read-only posture — the
 *  harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A merge — clean-merge or duplicates-found — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresStewardReview:true, autoWritten:false). A GOVERNANCE BLOCK is when a caller PRESENTS an offending
 *  DETERMINATION (a fabricated event, a mis-ordered / mis-deduplicated timeline, or an autonomous write) —
 *  which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified record-reconciliation / EMPI system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real record reconciliation resolves identity first (an EMPI), reconciles with FHIR resource provenance,
 *  and applies source-of-truth precedence rules. This merges the supplied already-identity-resolved streams
 *  only. It IS PHI-bearing — the events are a patient's clinical data — so it is on the HIPAA-audit policy.
 *  TIME IS DATA: the timeline is a pure function of the streams' own timestamps (no clock, no randomness), so
 *  the same streams always yield the same timeline, which is what lets the demo, the seeded trace, and the
 *  tests agree. The events are clearly-labeled ILLUSTRATIVE synthetics.
 */

/** A single clinical event within a source stream. `timestamp` is epoch-ms — time is data, not a clock. */
export type TimelineEvent = {
  eventId: string;
  source: string;
  timestamp: number;
  kind: string;
  /** Optional content key identifying the SAME clinical event across sources; defaults to `${kind}|${timestamp}`. */
  dedupKey?: string;
  label?: string;
};

/** A single source's stream of events (each stream is expected in ascending time order; sorted defensively). */
export type EventStream = {
  source: string;
  events: TimelineEvent[];
};

/** A timeline-merge request. */
export type TimelineMergeRequest = {
  recordRef: string;
  streams: EventStream[];
};

/** One entry in the merged timeline. */
export type MergedEntry = {
  eventId: string;
  source: string;
  timestamp: number;
  kind: string;
  dedupKey: string;
  /** The eventId of the earlier kept event this one duplicates, or null when this is the kept event. */
  duplicateOf: string | null;
  label?: string;
};

/** Per-source contribution tally. */
export type SourceContribution = {
  source: string;
  submitted: number;
  kept: number;
  duplicates: number;
};

export type TimelineMergeDisposition = "clean-merge" | "duplicates-found";

/** The deterministic finding the agent returns. */
export type TimelineMergeDetermination = {
  recordRef: string;
  /** The submitted streams, echoed so the guards can recompute. */
  streams: EventStream[];
  /** The merged, chronologically-ordered, dedup-flagged timeline. */
  timeline: MergedEntry[];
  sourceContributions: SourceContribution[];
  totalSubmitted: number;
  keptCount: number;
  duplicateCount: number;
  disposition: TimelineMergeDisposition;
  /** Always true — a data steward confirms every merge. */
  requiresStewardReview: true;
  /** Always false — the agent never autonomously writes the timeline back. */
  autoWritten: false;
  reason: string;
  synthetic: true;
  note: string;
};

/** The content key that identifies the "same" clinical event across sources. */
export function dedupKeyOf(event: TimelineEvent): string {
  return typeof event.dedupKey === "string" && event.dedupKey.length > 0
    ? event.dedupKey
    : `${event.kind}|${event.timestamp}`;
}

/**
 * Deterministic total order over events: earliest timestamp first, ties broken by source then eventId.
 * Returns negative when a precedes b.
 */
function compareEvents(a: TimelineEvent, b: TimelineEvent): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.eventId !== b.eventId) return a.eventId < b.eventId ? -1 : 1;
  return 0;
}

/**
 * The K-WAY MERGE of sorted streams — the heart of the service. Each stream is sorted defensively, then the
 * k cursors are advanced by repeatedly taking the earliest head across all streams (the classic
 * merge-k-sorted-lists / external-sort merge phase). Pure + deterministic; returns the globally-ordered
 * event sequence (not yet deduplicated).
 */
export function kWayMerge(streams: EventStream[]): TimelineEvent[] {
  const cursors = streams.map((s) => ({
    events: [...(s.events ?? [])].sort(compareEvents),
    i: 0
  }));
  const merged: TimelineEvent[] = [];
  const total = cursors.reduce((n, c) => n + c.events.length, 0);

  for (let picked = 0; picked < total; picked++) {
    let best = -1;
    for (let k = 0; k < cursors.length; k++) {
      const c = cursors[k];
      if (c.i >= c.events.length) continue;
      if (best === -1 || compareEvents(c.events[c.i], cursors[best].events[cursors[best].i]) < 0) {
        best = k;
      }
    }
    if (best === -1) break;
    merged.push(cursors[best].events[cursors[best].i]);
    cursors[best].i += 1;
  }
  return merged;
}

/** Apply the content-key dedup pass to an ordered event sequence, producing the flagged timeline. */
function dedupPass(ordered: TimelineEvent[]): MergedEntry[] {
  const keptByKey = new Map<string, string>(); // dedupKey -> kept eventId
  return ordered.map((e) => {
    const key = dedupKeyOf(e);
    const priorKept = keptByKey.get(key);
    const duplicateOf = priorKept ?? null;
    if (!priorKept) keptByKey.set(key, e.eventId);
    const entry: MergedEntry = {
      eventId: e.eventId,
      source: e.source,
      timestamp: e.timestamp,
      kind: e.kind,
      dedupKey: key,
      duplicateOf
    };
    if (e.label !== undefined) entry.label = e.label;
    return entry;
  });
}

/**
 * The deterministic merge function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own streams (no randomness, no clock). It k-way merges the sorted streams into one
 * chronological order, flags the duplicates by content key, tallies per-source contributions, and derives
 * the disposition. Nothing is written — the timeline is handed to a data steward.
 */
export function evaluateTimelineMerge(request: TimelineMergeRequest): TimelineMergeDetermination {
  const streams = Array.isArray(request.streams) ? request.streams : [];
  const ordered = kWayMerge(streams);
  const timeline = dedupPass(ordered);

  const keptCount = timeline.filter((t) => t.duplicateOf === null).length;
  const duplicateCount = timeline.length - keptCount;
  const totalSubmitted = streams.reduce((n, s) => n + (s.events?.length ?? 0), 0);

  const sourceContributions: SourceContribution[] = streams
    .map((s) => {
      const entries = timeline.filter((t) => t.source === s.source);
      const dup = entries.filter((t) => t.duplicateOf !== null).length;
      return {
        source: s.source,
        submitted: s.events?.length ?? 0,
        kept: entries.length - dup,
        duplicates: dup
      };
    })
    .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));

  const disposition: TimelineMergeDisposition = duplicateCount > 0 ? "duplicates-found" : "clean-merge";
  const reason =
    duplicateCount > 0
      ? `Merged ${totalSubmitted} events from ${streams.length} source(s) into ${keptCount} unique event(s); ${duplicateCount} duplicate(s) flagged for steward review.`
      : `Merged ${totalSubmitted} events from ${streams.length} source(s) into a clean chronological timeline; no duplicates.`;

  return {
    recordRef: request.recordRef,
    streams,
    timeline,
    sourceContributions,
    totalSubmitted,
    keptCount,
    duplicateCount,
    disposition,
    requiresStewardReview: true,
    autoWritten: false,
    reason,
    synthetic: true,
    note:
      `Timeline merge ${request.recordRef}: ${disposition.toUpperCase()} — ${totalSubmitted} events from ${streams.length} source stream(s) merged via K-WAY MERGE OF SORTED STREAMS (repeatedly taking the earliest head across the stream cursors) into ${timeline.length} chronologically-ordered entries, with ${duplicateCount} content-key duplicate(s) flagged.` +
      " Real record reconciliation resolves identity first (an EMPI), reconciles with FHIR resource provenance, and applies source-of-truth precedence rules. PHI-bearing — the events are a patient's clinical data. Synthetic/illustrative events — NOT a certified record-reconciliation / EMPI system. The agent never writes the merged timeline back to a source system of record — a data steward confirms every merge."
  };
}

/** A stable index of the submitted stream events, keyed by `${source}|${eventId}`. */
function submittedEventIndex(streams: EventStream[]): Map<string, TimelineEvent> {
  const idx = new Map<string, TimelineEvent>();
  for (const s of streams) {
    for (const e of s.events ?? []) idx.set(`${e.source}|${e.eventId}`, e);
  }
  return idx;
}

/**
 * Sourced + completeness check: is the timeline built from the submitted streams? True only when every
 * timeline entry traces to a SUBMITTED stream event (same source + eventId + timestamp + kind; no fabricated
 * event), every submitted event appears EXACTLY ONCE (none dropped, none double-listed), the per-source
 * contributions echo the submitted counts and match the actual kept / duplicate tallies, and the kept +
 * duplicate + total counts add up. Catches a fabricated or dropped event. Does NOT recompute the merge order
 * or the dedup flags (that is the consistency check's job), so it is independent of it. Anything
 * evaluateTimelineMerge() produces satisfies it. This is the honest signal the route reports to
 * policy.timeline.events-sourced. A non-object / malformed input is a violation.
 */
export function eventsSourced(
  decision:
    | {
        streams?: unknown;
        timeline?: unknown;
        sourceContributions?: unknown;
        totalSubmitted?: unknown;
        keptCount?: unknown;
        duplicateCount?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const streams = Array.isArray(decision.streams) ? (decision.streams as EventStream[]) : null;
  const timeline = Array.isArray(decision.timeline) ? (decision.timeline as MergedEntry[]) : null;
  if (!streams || !timeline) return false;

  const idx = submittedEventIndex(streams);

  // Every timeline entry traces to a submitted event (same source + eventId + timestamp + kind); each
  // submitted event appears exactly once.
  const seen = new Set<string>();
  for (const entry of timeline) {
    const key = `${entry.source}|${entry.eventId}`;
    const submitted = idx.get(key);
    if (!submitted) return false; // fabricated event
    if (submitted.timestamp !== entry.timestamp || submitted.kind !== entry.kind) return false;
    if (seen.has(key)) return false; // double-listed
    seen.add(key);
  }
  if (seen.size !== idx.size) return false; // some submitted event dropped

  // Totals.
  const totalSubmitted = idx.size;
  if (decision.totalSubmitted !== undefined && decision.totalSubmitted !== totalSubmitted) return false;
  const reportedKept = timeline.filter((t) => t.duplicateOf === null).length;
  const reportedDup = timeline.length - reportedKept;
  if (decision.keptCount !== undefined && decision.keptCount !== reportedKept) return false;
  if (decision.duplicateCount !== undefined && decision.duplicateCount !== reportedDup) return false;
  if (reportedKept + reportedDup !== timeline.length) return false;

  // Per-source contributions echo the submitted counts + actual kept / duplicate tallies.
  if (decision.sourceContributions !== undefined) {
    const contributions = Array.isArray(decision.sourceContributions)
      ? (decision.sourceContributions as SourceContribution[])
      : null;
    if (!contributions) return false;
    const bySource = new Map<string, SourceContribution>();
    for (const c of contributions) bySource.set(c.source, c);
    const submittedBySource = new Map<string, number>();
    for (const s of streams) submittedBySource.set(s.source, s.events?.length ?? 0);
    if (bySource.size !== submittedBySource.size) return false;
    for (const [source, submitted] of submittedBySource) {
      const c = bySource.get(source);
      if (!c) return false;
      if (c.submitted !== submitted) return false;
      const entries = timeline.filter((t) => t.source === source);
      const dup = entries.filter((t) => t.duplicateOf !== null).length;
      if (c.duplicates !== dup) return false;
      if (c.kept !== entries.length - dup) return false;
    }
  }
  return true;
}

/**
 * Consistency check: recomputing the k-way merge of the submitted streams must reproduce the reported
 * chronological order and the reported duplicate flags. True only when, filtering the reported timeline to
 * entries whose event is in the submitted streams, that filtered sequence equals the recomputed merge
 * (same order, same duplicateOf), AND the reported timestamps are non-decreasing. Catches a mis-ordered or
 * mis-deduplicated timeline. The load-bearing correctness gate — it recomputes the merge from the streams
 * INDEPENDENT of the submitted-event correspondence (a fabricated entry is filtered out here, so it fails
 * sourced while the real events still recompute — the two gates are isolable). Anything
 * evaluateTimelineMerge() produces satisfies it. A non-object input is a violation.
 */
export function mergeConsistent(
  decision:
    | { streams?: unknown; timeline?: unknown }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const streams = Array.isArray(decision.streams) ? (decision.streams as EventStream[]) : null;
  const timeline = Array.isArray(decision.timeline) ? (decision.timeline as MergedEntry[]) : null;
  if (!streams || !timeline) return false;

  const expected = dedupPass(kWayMerge(streams));
  const expectedByKey = new Map<string, MergedEntry>();
  for (const e of expected) expectedByKey.set(`${e.source}|${e.eventId}`, e);

  // Filter the reported timeline to real (submitted) events, preserving order.
  const realEntries = timeline.filter((t) => expectedByKey.has(`${t.source}|${t.eventId}`));
  if (realEntries.length !== expected.length) return false; // a real event dropped/duplicated in reporting

  for (let i = 0; i < expected.length; i++) {
    const got = realEntries[i];
    const want = expected[i];
    if (got.source !== want.source || got.eventId !== want.eventId) return false; // wrong order
    if ((got.duplicateOf ?? null) !== (want.duplicateOf ?? null)) return false; // wrong dedup flag
    if (got.dedupKey !== want.dedupKey) return false;
  }

  // The reported timeline's timestamps must be non-decreasing.
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i].timestamp < timeline[i - 1].timestamp) return false;
  }
  return true;
}

/**
 * No-autonomous-merge check: did the agent avoid autonomously writing the timeline back? True unless the
 * determination reports it auto-wrote (autoWritten:true) or does not require steward review
 * (requiresStewardReview:false). Anything evaluateTimelineMerge() produces satisfies it. This is the honest
 * signal the route reports to policy.timeline.no-autonomous-merge. A non-object input is a violation.
 */
export function noAutonomousMerge(
  decision:
    | { autoWritten?: boolean; requiresStewardReview?: boolean }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoWritten === true) return false;
  if (decision.requiresStewardReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a merge. */
export function timelineMergeSummary(decision: TimelineMergeDetermination): {
  recordRef: string;
  disposition: TimelineMergeDisposition;
  totalSubmitted: number;
  keptCount: number;
  duplicateCount: number;
  sourceCount: number;
  requiresStewardReview: boolean;
  synthetic: boolean;
} {
  return {
    recordRef: decision.recordRef,
    disposition: decision.disposition,
    totalSubmitted: decision.totalSubmitted,
    keptCount: decision.keptCount,
    duplicateCount: decision.duplicateCount,
    sourceCount: decision.streams.length,
    requiresStewardReview: decision.requiresStewardReview,
    synthetic: decision.synthetic
  };
}

/**
 * A representative demo request that merges three source streams with two cross-source duplicates
 * (duplicates-found). Synthetic.
 */
export const DEMO_TIMELINE_MERGE_REQUEST: TimelineMergeRequest = {
  recordRef: "record-merge-001",
  streams: [
    {
      source: "ehr-a",
      events: [
        { eventId: "a1", source: "ehr-a", timestamp: 100, kind: "office-visit", label: "GYN visit" },
        { eventId: "a2", source: "ehr-a", timestamp: 300, kind: "lab-panel", label: "FSH / estradiol panel" }
      ]
    },
    {
      source: "ehr-b",
      events: [
        { eventId: "b1", source: "ehr-b", timestamp: 100, kind: "office-visit", label: "Same GYN visit (duplicate)" },
        { eventId: "b2", source: "ehr-b", timestamp: 500, kind: "medication-start", label: "HRT start" }
      ]
    },
    {
      source: "pharmacy",
      events: [
        { eventId: "c1", source: "pharmacy", timestamp: 300, kind: "lab-panel", label: "Same lab panel (duplicate)" },
        { eventId: "c2", source: "pharmacy", timestamp: 700, kind: "medication-fill", label: "HRT fill" }
      ]
    }
  ]
};

/** A representative demo request whose streams share no content keys (clean-merge). Synthetic. */
export const DEMO_TIMELINE_MERGE_CLEAN_REQUEST: TimelineMergeRequest = {
  recordRef: "record-merge-002",
  streams: [
    {
      source: "ehr-a",
      events: [
        { eventId: "a1", source: "ehr-a", timestamp: 100, kind: "office-visit", label: "GYN visit" },
        { eventId: "a2", source: "ehr-a", timestamp: 400, kind: "lab-panel", label: "Lipid panel" }
      ]
    },
    {
      source: "claims",
      events: [
        { eventId: "d1", source: "claims", timestamp: 250, kind: "medication-fill", label: "HRT fill" },
        { eventId: "d2", source: "claims", timestamp: 600, kind: "imaging", label: "DEXA scan" }
      ]
    }
  ]
};

/** A representative demo request with a single stream already in order (clean-merge). Synthetic. */
export const DEMO_TIMELINE_MERGE_SINGLE_REQUEST: TimelineMergeRequest = {
  recordRef: "record-merge-003",
  streams: [
    {
      source: "ehr-a",
      events: [
        { eventId: "a1", source: "ehr-a", timestamp: 100, kind: "office-visit", label: "GYN visit" },
        { eventId: "a2", source: "ehr-a", timestamp: 200, kind: "lab-panel", label: "FSH panel" },
        { eventId: "a3", source: "ehr-a", timestamp: 300, kind: "medication-start", label: "HRT start" }
      ]
    }
  ]
};
