/**
 * Access Anomaly Detection — the deterministic, transparent data-substrate layer that takes an
 * actor's PHI-ACCESS EVENTS (each a timestamped read of a patient record from the audit trail) and
 * COUNTS them within a ROLLING TIME WINDOW, finding the PEAK number of accesses in any window of the
 * configured length and flagging an ANOMALY when that peak exceeds the threshold (a possible snooping
 * / breach pattern under the HIPAA Security Rule's information-system-activity-review safeguard,
 * §164.308(a)(1)(ii)(D)) — never autonomously LOCKING the actor's account, revoking their access, or
 * disciplining them; a privacy officer reviews every flag.
 *
 * Deterministic, dependency-free domain core the Access Anomaly agent
 * (app/api/agents/access-anomaly) wraps — a control-plane / data-substrate service on the platform &
 * data substrate plane of Pause's Agent Fabric. UNLIKE the Coverage Continuity agent's INTERVAL
 * MERGING + GAP DETECTION, the Care Pathway agent's TOPOLOGICAL ORDERING, the Enrollment
 * Reconciliation agent's KEYED SET-DIFFERENCE, the Member Cost-Share agent's SEQUENTIAL dollar
 * waterfall, the OIG Exclusion agent's identity MATCHING, or the Audit Log Integrity agent's HASH
 * CHAIN — and UNLIKE the DATE-DEADLINE agents (Timely Filing, Right of Access, Amendment) that add N
 * days to a single date — the heart of this service is SLIDING-WINDOW COUNTING over timestamped events
 * (a two-pointer scan finding the peak count in any window of a fixed length). "Information system
 * activity review" is the HIPAA safeguard requiring covered entities to regularly review records of
 * information-system activity such as audit logs and access reports; an unusual VOLUME of accesses by
 * one actor in a short window is a classic snooping / breach indicator.
 *
 *   Inbound:  an AccessAnomalyRequest { requestRef, actorRef, windowMinutes, threshold, events[] }
 *   Outbound: an AccessAnomalyDetermination { disposition, peakWindow, totalEvents,
 *             distinctPatientsTotal, windowMinutes, threshold, hasAnomaly, events[], invalidEvents[],
 *             requiresPrivacyReview: true, autoLockedAccount:false, autoRevokedAccess:false, reason,
 *             synthetic:true, note }
 *
 * It COMPLEMENTS — it does NOT duplicate — the other platform agents: distinct from the Audit Log
 * Integrity agent (whether the audit TRAIL is tamper-evident), the Break-the-Glass agent (whether a
 * single emergency access is authorized), the Minimum Necessary agent (how much PHI a purpose may
 * see), the Accounting of Disclosures agent (WHO a patient's PHI was disclosed to), and the Consent
 * agent (whether a patient may be contacted / data used): this detects an unusual VOLUME of accesses
 * by one actor over time — the temporal shape of their activity, and any spike in it.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: every counted access is sourced — no fabricated access.
 * ─────────────────────────────────────────────────────────────────────
 *  An anomaly finding is trustworthy only if every event in the reported peak window traces to a
 *  submitted access event — the peak window's event ids must be a subset of the submitted events, and
 *  its count must equal the number of those ids. A fabricated access (an event in the peak not backed
 *  by a submitted one) would manufacture a false anomaly; a phantom count would overstate the spike.
 *  accessEventsSourced() verifies the peak window's events all resolve to submitted events and the
 *  count matches; it reports the honest signal the Agent Fabric enforces via
 *  policy.access.events-sourced. (Mirrors the Coverage Continuity Agent's segments-sourced and the
 *  Audit Log Integrity Agent's hash-chain-verified posture.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the window count is consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  The reported peak must be the true maximum number of events in any window of the configured length:
 *  recomputing the sliding-window peak from the events must reproduce the reported peak count, the
 *  peak window's events must all fall within a span of at most windowMinutes, and the anomaly flag
 *  must equal whether the peak exceeds the threshold. A miscounted peak, a window wider than the
 *  configured length, or an anomaly flag that doesn't match the threshold drives a wrong finding.
 *  accessWindowCountConsistent() recomputes the peak, checks the window span, and re-derives the flag;
 *  it reports the honest signal the Agent Fabric enforces via policy.access.window-count-consistent.
 *  (The load-bearing correctness gate — mirrors the Coverage Continuity Agent's math-consistent and
 *  the Audit Log Integrity Agent's sequence-complete.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: an access action is never autonomously taken.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent MEASURES — it never LOCKS the actor's account, revokes their access, or disciplines them
 *  (each is an access / employment action that must be authorized); every flag is a RECOMMENDATION
 *  requiring a privacy officer to review. accessNoAutonomousAction() reports the honest signal the
 *  Agent Fabric enforces via policy.access.no-autonomous-action. (Mirrors the Coverage Continuity
 *  Agent's no-autonomous-determination and the Audit Log Integrity Agent's no-autonomous-redaction
 *  posture — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A finding — normal activity OR an anomalous spike — is a SAFE, honest OUTPUT: the task COMPLETES (it
 *  carries requiresPrivacyReview:true, autoLockedAccount:false, autoRevokedAccess:false). A GOVERNANCE
 *  BLOCK is when a caller PRESENTS an offending FINDING (one with a fabricated peak event, an
 *  inconsistent / over-wide window count, or an autonomously-taken access action) — which the Agent
 *  Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified breach-detection / SIEM system.
 * ─────────────────────────────────────────────────────────────────────
 *  The events + window + threshold below are clearly-labeled ILLUSTRATIVE synthetics chosen to model
 *  the SHAPE of an access-anomaly analysis deterministically in the demo. Real activity review uses the
 *  full audit trail, user-behavior analytics, role / relationship context (is there a treatment
 *  relationship?), and the privacy officer's judgment. TIME IS DATA: the analysis is a pure function of
 *  the request's own events + window + threshold — there is NO reliance on the real clock — so the same
 *  events always yield the same peak + finding, which is what lets the demo, the seeded trace, and the
 *  tests agree.
 */

/** The default rolling window length, in minutes, for counting an actor's accesses. */
export const DEFAULT_WINDOW_MINUTES = 60;

/** The default anomaly threshold: more than this many accesses in one window is flagged. */
export const DEFAULT_THRESHOLD = 20;

/** A single PHI-access event on an actor's activity trail. */
export type AccessEvent = {
  /** The event identifier. */
  eventId: string;
  /** The patient record the access touched (a reference, not the record). */
  patientRef: string;
  /** The action taken, e.g. "view" / "print" / "export". */
  action: string;
  /** The access timestamp, ISO 8601 datetime (e.g. 2025-01-15T09:00:00Z). */
  timestamp: string;
};

/** An access-anomaly detection request scoped to one actor. */
export type AccessAnomalyRequest = {
  /** Synthetic request reference. */
  requestRef: string;
  /** Synthetic actor reference (the user / workforce member whose activity is reviewed). */
  actorRef: string;
  /** The rolling window length in minutes (defaults to DEFAULT_WINDOW_MINUTES = 60). */
  windowMinutes?: number;
  /** The anomaly threshold: a peak strictly greater than this is flagged (defaults to DEFAULT_THRESHOLD = 20). */
  threshold?: number;
  /** The actor's access events. */
  events: AccessEvent[];
};

/** A validated, echoed event carrying its epoch-millisecond timestamp (for self-contained guards). */
export type EchoedAccessEvent = AccessEvent & { epochMs: number };

/** The peak rolling window — the densest span of accesses found. */
export type PeakWindow = {
  /** The window's first access timestamp, ISO. */
  startTime: string;
  /** The window's last access timestamp, ISO. */
  endTime: string;
  /** The window start, epoch-milliseconds. */
  startEpochMs: number;
  /** The window end, epoch-milliseconds. */
  endEpochMs: number;
  /** The number of accesses in the window. */
  count: number;
  /** The number of distinct patients accessed in the window. */
  distinctPatients: number;
  /** The event ids in the window (a subset of the submitted events). */
  eventIds: string[];
};

/** The disposition of an access-anomaly finding. */
export type AccessAnomalyDisposition = "normal" | "anomalous-access-volume";

/** The deterministic access-anomaly finding the agent returns. */
export type AccessAnomalyDetermination = {
  requestRef: string;
  actorRef: string;
  disposition: AccessAnomalyDisposition;
  /** The window length applied, in minutes. */
  windowMinutes: number;
  /** The threshold applied. */
  threshold: number;
  /** The densest window of accesses found (an empty window when there are no valid events). */
  peakWindow: PeakWindow;
  /** The total number of valid events. */
  totalEvents: number;
  /** The number of distinct patients accessed across all valid events. */
  distinctPatientsTotal: number;
  /** Whether the peak exceeds the threshold. */
  hasAnomaly: boolean;
  /** The validated events, echoed with epoch-ms timestamps so the honesty guards are self-contained. */
  events: EchoedAccessEvent[];
  /** Any events that could not be parsed (invalid / missing timestamp). */
  invalidEvents: string[];
  /** Always true — a privacy officer reviews every finding. */
  requiresPrivacyReview: true;
  /** Always false — the agent never autonomously locks the actor's account. */
  autoLockedAccount: false;
  /** Always false — the agent never autonomously revokes the actor's access. */
  autoRevokedAccess: false;
  /** Human-readable reason. */
  reason: string;
  /** Always true — the events are illustrative. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** Parse an ISO 8601 datetime to epoch-milliseconds, or null if invalid. */
export function toEpochMs(iso: string): number | null {
  if (typeof iso !== "string" || iso.length === 0) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** An empty peak window (no accesses). */
function emptyPeakWindow(): PeakWindow {
  return {
    startTime: "",
    endTime: "",
    startEpochMs: 0,
    endEpochMs: 0,
    count: 0,
    distinctPatients: 0,
    eventIds: []
  };
}

/**
 * The deterministic sliding-window peak — the heart of the service. Given the events sorted by time
 * and a window length in milliseconds, a two-pointer scan finds the maximum number of events that fall
 * within any window of that length (inclusive: events whose timestamps span ≤ windowMs). Returns the
 * FIRST window (earliest end) achieving that maximum, along with its event ids. Pure + deterministic.
 */
function computePeakWindow(sorted: EchoedAccessEvent[], windowMs: number): PeakWindow {
  if (sorted.length === 0) return emptyPeakWindow();
  let left = 0;
  let bestLeft = 0;
  let bestRight = 0;
  let bestCount = 1;
  for (let right = 0; right < sorted.length; right += 1) {
    while (sorted[right].epochMs - sorted[left].epochMs > windowMs) {
      left += 1;
    }
    const count = right - left + 1;
    if (count > bestCount) {
      bestCount = count;
      bestLeft = left;
      bestRight = right;
    }
  }
  const window = sorted.slice(bestLeft, bestRight + 1);
  const distinctPatients = new Set(window.map((e) => e.patientRef)).size;
  return {
    startTime: window[0].timestamp,
    endTime: window[window.length - 1].timestamp,
    startEpochMs: window[0].epochMs,
    endEpochMs: window[window.length - 1].epochMs,
    count: bestCount,
    distinctPatients,
    eventIds: window.map((e) => e.eventId)
  };
}

/**
 * The deterministic detection function — the heart of the service. DETERMINISTIC: a pure function of
 * the request's own events + window + threshold (time is data; no real clock). It validates + parses
 * the events to epoch-ms, SORTS them by time, finds the PEAK rolling window (the densest span of
 * accesses in any window of the configured length), and flags an ANOMALY when that peak exceeds the
 * threshold. Nothing is acted on here — every flag is handed to a privacy officer.
 */
export function evaluateAccessAnomaly(
  request: AccessAnomalyRequest
): AccessAnomalyDetermination {
  const windowMinutes =
    typeof request.windowMinutes === "number" &&
    Number.isFinite(request.windowMinutes) &&
    request.windowMinutes > 0
      ? Math.floor(request.windowMinutes)
      : DEFAULT_WINDOW_MINUTES;
  const threshold =
    typeof request.threshold === "number" &&
    Number.isFinite(request.threshold) &&
    request.threshold >= 0
      ? Math.floor(request.threshold)
      : DEFAULT_THRESHOLD;
  const windowMs = windowMinutes * 60_000;

  const rawEvents = Array.isArray(request.events) ? request.events : [];
  const echoed: EchoedAccessEvent[] = [];
  const invalidEvents: string[] = [];
  for (const e of rawEvents) {
    const epochMs = e ? toEpochMs(e.timestamp) : null;
    if (epochMs === null || !e || typeof e.eventId !== "string") {
      if (e && typeof e.eventId === "string") invalidEvents.push(e.eventId);
      continue;
    }
    echoed.push({
      eventId: e.eventId,
      patientRef: e.patientRef,
      action: e.action,
      timestamp: e.timestamp,
      epochMs
    });
  }

  // Sort by time (then event id for a stable, deterministic order on ties).
  const sorted = echoed
    .slice()
    .sort((a, b) => (a.epochMs !== b.epochMs ? a.epochMs - b.epochMs : a.eventId.localeCompare(b.eventId)));

  const peakWindow = computePeakWindow(sorted, windowMs);
  const totalEvents = echoed.length;
  const distinctPatientsTotal = new Set(echoed.map((e) => e.patientRef)).size;
  const hasAnomaly = peakWindow.count > threshold;
  const disposition: AccessAnomalyDisposition = hasAnomaly
    ? "anomalous-access-volume"
    : "normal";

  const reason = hasAnomaly
    ? `Actor ${request.actorRef} accessed ${peakWindow.count} record(s) within a ${windowMinutes}-minute window (${peakWindow.distinctPatients} distinct patient(s)) — over the threshold of ${threshold}, an anomalous access volume flagged for privacy review.`
    : `Actor ${request.actorRef} peaked at ${peakWindow.count} access(es) in any ${windowMinutes}-minute window across ${totalEvents} event(s) — within the threshold of ${threshold}, normal activity.`;

  return {
    requestRef: request.requestRef,
    actorRef: request.actorRef,
    disposition,
    windowMinutes,
    threshold,
    peakWindow,
    totalEvents,
    distinctPatientsTotal,
    hasAnomaly,
    events: echoed,
    invalidEvents,
    requiresPrivacyReview: true,
    autoLockedAccount: false,
    autoRevokedAccess: false,
    reason,
    synthetic: true,
    note:
      `Access anomaly ${request.requestRef}: ${disposition.toUpperCase()} — peak ${peakWindow.count} access(es) in any ${windowMinutes}-minute window (${peakWindow.distinctPatients} distinct patient(s)) across ${totalEvents} event(s), threshold ${threshold}.` +
      (invalidEvents.length > 0 ? ` ${invalidEvents.length} event(s) skipped as invalid.` : "") +
      " PHI-bearing — the events reference the patients whose records were accessed. Synthetic/illustrative events — NOT a certified breach-detection / SIEM system; real activity review uses the full audit trail, user-behavior analytics, and role / relationship context. The agent never locks an account or revokes access on its own — a privacy officer reviews every flag."
  };
}

/**
 * Events-sourced check: does every event in the reported peak window trace to a submitted event, and
 * does the count match? True only when the peak window's event ids are a subset of the echoed events'
 * ids and the reported count equals the number of those ids (and the distinct-patient count matches
 * the patients of those events). Catches a fabricated peak event or a phantom count. Anything
 * evaluateAccessAnomaly() produces satisfies it. This is the honest signal the route reports to
 * policy.access.events-sourced. A non-object / malformed input is a violation.
 */
export function accessEventsSourced(
  decision:
    | {
        peakWindow?: { count?: number; distinctPatients?: number; eventIds?: unknown };
        events?: Array<{ eventId?: unknown; patientRef?: unknown }>;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const peak = decision.peakWindow;
  const events = Array.isArray(decision.events) ? decision.events : null;
  if (!peak || typeof peak !== "object" || !events) return false;
  const eventIds = Array.isArray(peak.eventIds) ? peak.eventIds : null;
  if (!eventIds) return false;
  if (typeof peak.count !== "number") return false;

  const byId = new Map<string, string>();
  for (const e of events) {
    if (!e || typeof e.eventId !== "string" || typeof e.patientRef !== "string") return false;
    byId.set(e.eventId, e.patientRef);
  }

  if (peak.count !== eventIds.length) return false;
  const patients = new Set<string>();
  for (const id of eventIds) {
    if (typeof id !== "string" || !byId.has(id)) return false;
    patients.add(byId.get(id) as string);
  }
  // An empty peak (no events) is trivially sourced.
  if (eventIds.length === 0) return peak.count === 0;
  if (typeof peak.distinctPatients === "number" && peak.distinctPatients !== patients.size) {
    return false;
  }
  return true;
}

/**
 * Window-count-consistent check: is the reported peak the true maximum in any window of the configured
 * length? True only when recomputing the sliding-window peak from the echoed events + windowMinutes
 * reproduces the reported peak count, the peak window's events all fall within a span of at most
 * windowMinutes, and the anomaly flag equals whether the peak exceeds the threshold. Catches a
 * miscounted peak, an over-wide window, or a mismatched anomaly flag. The load-bearing correctness
 * gate. Anything evaluateAccessAnomaly() produces satisfies it. This is the honest signal the route
 * reports to policy.access.window-count-consistent. A non-object input is a violation.
 */
export function accessWindowCountConsistent(
  decision:
    | {
        peakWindow?: { count?: number; eventIds?: unknown };
        events?: Array<{ eventId?: unknown; epochMs?: unknown }>;
        windowMinutes?: number;
        threshold?: number;
        hasAnomaly?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const peak = decision.peakWindow;
  const events = Array.isArray(decision.events) ? decision.events : null;
  if (!peak || typeof peak !== "object" || !events) return false;
  if (typeof decision.windowMinutes !== "number" || decision.windowMinutes <= 0) return false;
  if (typeof decision.threshold !== "number") return false;
  if (typeof decision.hasAnomaly !== "boolean") return false;
  if (typeof peak.count !== "number") return false;

  const windowMs = Math.floor(decision.windowMinutes) * 60_000;

  // Rebuild echoed events with their epoch-ms; every event must carry a numeric epochMs.
  const echoed: EchoedAccessEvent[] = [];
  const byId = new Map<string, number>();
  for (const e of events) {
    if (!e || typeof e.eventId !== "string" || typeof e.epochMs !== "number") return false;
    byId.set(e.eventId, e.epochMs);
    echoed.push({
      eventId: e.eventId,
      patientRef: "",
      action: "",
      timestamp: "",
      epochMs: e.epochMs
    });
  }

  // The peak window's events must all fall within a windowMs span.
  const eventIds = Array.isArray(peak.eventIds) ? peak.eventIds : null;
  if (!eventIds) return false;
  const peakTimes: number[] = [];
  for (const id of eventIds) {
    if (typeof id !== "string" || !byId.has(id)) return false;
    peakTimes.push(byId.get(id) as number);
  }
  if (peakTimes.length > 0) {
    const span = Math.max(...peakTimes) - Math.min(...peakTimes);
    if (span > windowMs) return false;
  }

  // Recompute the peak independently and compare.
  const sorted = echoed
    .slice()
    .sort((a, b) => (a.epochMs !== b.epochMs ? a.epochMs - b.epochMs : a.eventId.localeCompare(b.eventId)));
  const recomputed = computePeakWindow(sorted, windowMs);
  if (recomputed.count !== peak.count) return false;

  if (decision.hasAnomaly !== peak.count > decision.threshold) return false;
  return true;
}

/**
 * No-autonomous-action check: did the agent avoid autonomously taking an access / employment action?
 * True unless the finding reports it locked the account (autoLockedAccount:true), revoked access
 * (autoRevokedAccess:true), or does not require privacy review (requiresPrivacyReview:false). Anything
 * evaluateAccessAnomaly() produces satisfies it. This is the honest signal the route reports to
 * policy.access.no-autonomous-action. A non-object input is a violation.
 */
export function accessNoAutonomousAction(
  decision:
    | {
        autoLockedAccount?: boolean;
        autoRevokedAccess?: boolean;
        requiresPrivacyReview?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoLockedAccount === true) return false;
  if (decision.autoRevokedAccess === true) return false;
  if (decision.requiresPrivacyReview === false) return false;
  return true;
}

/**
 * A compact, trace-safe summary of a finding — the shape stamped onto the Agent Fabric trace + the
 * response `meta`.
 */
export function accessAnomalySummary(decision: AccessAnomalyDetermination): {
  requestRef: string;
  actorRef: string;
  disposition: AccessAnomalyDisposition;
  peakCount: number;
  distinctPatients: number;
  totalEvents: number;
  hasAnomaly: boolean;
  requiresPrivacyReview: boolean;
  synthetic: boolean;
} {
  return {
    requestRef: decision.requestRef,
    actorRef: decision.actorRef,
    disposition: decision.disposition,
    peakCount: decision.peakWindow.count,
    distinctPatients: decision.peakWindow.distinctPatients,
    totalEvents: decision.totalEvents,
    hasAnomaly: decision.hasAnomaly,
    requiresPrivacyReview: decision.requiresPrivacyReview,
    synthetic: decision.synthetic
  };
}

/** Build a run of N access events for an actor, each `stepMinutes` apart starting at `startIso`. */
function buildEvents(
  startIso: string,
  count: number,
  stepMinutes: number,
  patientPrefix: string
): AccessEvent[] {
  const start = Date.parse(startIso);
  const events: AccessEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = new Date(start + i * stepMinutes * 60_000).toISOString();
    events.push({
      eventId: `evt-${patientPrefix}-${i + 1}`,
      patientRef: `patient-${patientPrefix}-${i + 1}`,
      action: "view",
      timestamp: t
    });
  }
  return events;
}

/**
 * A representative demo request: an actor who views 24 records within ~46 minutes — over the default
 * 20-in-60-minutes threshold, so it is an ANOMALOUS access volume. Synthetic.
 */
export const DEMO_ACCESS_ANOMALY_REQUEST: AccessAnomalyRequest = {
  requestRef: "aad-001",
  actorRef: "actor-3391",
  windowMinutes: 60,
  threshold: 20,
  events: buildEvents("2025-01-15T09:00:00Z", 24, 2, "a")
};

/**
 * A representative demo request: an actor with routine, spread-out access — a handful of records over
 * a full shift, never more than a few in any window — so it is NORMAL. Synthetic.
 */
export const DEMO_ACCESS_ANOMALY_NORMAL_REQUEST: AccessAnomalyRequest = {
  requestRef: "aad-002",
  actorRef: "actor-2007",
  windowMinutes: 60,
  threshold: 20,
  events: buildEvents("2025-01-15T08:00:00Z", 6, 90, "b")
};

/**
 * A representative demo request: an actor whose TOTAL accesses are high (18) but spread across the day
 * in small bursts so no single 30-minute window exceeds the threshold of 5 — NORMAL. Demonstrates that
 * the detection is WINDOWED, not a naive total count. Synthetic.
 */
export const DEMO_ACCESS_ANOMALY_BURST_REQUEST: AccessAnomalyRequest = {
  requestRef: "aad-003",
  actorRef: "actor-5540",
  windowMinutes: 30,
  threshold: 5,
  events: [
    ...buildEvents("2025-01-15T08:00:00Z", 3, 5, "c"),
    ...buildEvents("2025-01-15T10:00:00Z", 3, 5, "d"),
    ...buildEvents("2025-01-15T12:00:00Z", 3, 5, "e"),
    ...buildEvents("2025-01-15T14:00:00Z", 3, 5, "f"),
    ...buildEvents("2025-01-15T16:00:00Z", 3, 5, "g"),
    ...buildEvents("2025-01-15T18:00:00Z", 3, 5, "h")
  ]
};
