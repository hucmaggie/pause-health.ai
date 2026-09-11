/**
 * Member Contact Rate Limiting / Token-Bucket Throttle — the deterministic, transparent care-coordination layer
 * that, given a CHRONOLOGICALLY-ORDERED sequence of outbound contact ATTEMPTS to a member (calls / texts / emails
 * from the various agents) and a token-bucket CONFIG (a burst CAPACITY of tokens and a continuous REFILL rate per
 * hour), replays the attempts through a TOKEN BUCKET to decide which contacts are PERMITTED and which are
 * THROTTLED — so a member is never over-contacted past the configured frequency cap — without ever actually
 * sending or suppressing a single message on its own. An outreach coordinator confirms.
 *
 * Deterministic, dependency-free domain core the Contact Rate Limit agent (app/api/agents/contact-rate-limit)
 * wraps — a contact-governance agent on the care-coordination plane of Pause's Agent Fabric. CRUCIALLY, the
 * heart of this service is the TOKEN-BUCKET RATE-LIMITING algorithm: the bucket holds up to `capacity` tokens and
 * refills continuously at `refillPerHour` tokens/hour (never above capacity); each attempt, processed in time
 * order, first accrues the refill earned since the previous attempt, then — if at least one whole token is
 * available — consumes one token and is PERMITTED, otherwise is THROTTLED (no token consumed). This is a
 * genuinely NEW computation pattern for the fabric: it is NOT the Outreach Prioritization agent's 0/1 KNAPSACK
 * (which selects WHICH members to contact under a capacity budget — this governs HOW OFTEN one member may be
 * contacted over time), NOT the Access Anomaly agent's SLIDING-WINDOW COUNTING (a fixed-window event count with
 * no continuous refill or token reservoir), NOT the SLA Worklist agent's EARLIEST-DEADLINE-FIRST SCHEDULING, NOT
 * the Referral Throughput agent's MAX-FLOW, NOT the Network Build-Out agent's MINIMUM SPANNING TREE, NOT the Care
 * Routing agent's DIJKSTRA'S SHORTEST PATH, and NOT the Schedule Conflict agent's GREEDY INTERVAL SELECTION — it
 * is token-bucket throttling: a continuously-refilling token reservoir with a burst cap. The per-attempt
 * permit/throttle decision is provably determined by the bucket state, and the exact throttle decision is the
 * invariant this service reports and defends.
 *
 *   Inbound:  a ContactRateLimitRequest { memberRef, capacity, refillPerHour, attempts[] }  (attempts: { id, atMs })
 *   Outbound: a ContactRateLimitDetermination { decisions[], permittedCount, throttledCount, finalTokens,
 *             capacity, refillPerHour, disposition, attemptCount, requiresCoordinatorReview:true,
 *             autoSent:false, reason, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 1: the replay is sourced and self-consistent.
 * ─────────────────────────────────────────────────────────────────────
 *  A throttle plan is trustworthy only if the reported per-attempt decisions are a REAL, self-consistent replay
 *  of the submitted attempts: the decisions must cover EXACTLY the submitted attempts (same ids, same timestamps,
 *  in the SAME non-decreasing time order — none dropped, added, reordered, or with a fabricated timestamp), the
 *  reported permittedCount / throttledCount must match the decisions, and the disposition must follow (within-
 *  limits iff throttledCount === 0). A fabricated attempt, a reordered replay, or a miscounted tally corrupts the
 *  plan. replaySourced() verifies it; the Agent Fabric enforces it via policy.contactrate.replay-sourced. It does
 *  NOT re-simulate the bucket — that is the policy gate's job — so the two are isolable. (The sourced + self-
 *  consistency gate — mirrors the Referral Throughput Agent's flow-sourced and the Batch Partition Agent's
 *  partition-sourced.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 2: the throttle is policy-exact (the token bucket re-simulates).
 * ─────────────────────────────────────────────────────────────────────
 *  Re-running the token-bucket simulation over the submitted attempts + config must reproduce the EXACT permit /
 *  throttle decision for every attempt and the final token level — no over-throttling (denying a contact the
 *  bucket would have allowed) and no under-throttling (permitting a contact past the cap). throttleExact()
 *  re-simulates the bucket from the attempts + config INDEPENDENT of the reported decisions and compares the
 *  per-attempt outcomes, so a fabricated replay that still reports the right tally fails sourced only, and a
 *  real-but-mis-simulated throttle fails policy only — the two gates are isolable. The Agent Fabric enforces it
 *  via policy.contactrate.throttle-exact. (The load-bearing correctness gate — mirrors the Referral Throughput
 *  Agent's throughput-optimal and the Care Routing Agent's route-optimal.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY 3: no autonomous send / suppression.
 * ─────────────────────────────────────────────────────────────────────
 *  The agent PLANS on paper — it never actually sends a permitted contact or suppresses a throttled one on its
 *  own (each is a member-communication action that must be authorized); every throttle plan is a RECOMMENDATION
 *  requiring an outreach coordinator to confirm. noAutonomousSend() reports the honest signal the Agent Fabric
 *  enforces via policy.contactrate.no-autonomous-send. (Mirrors the Referral Throughput Agent's no-autonomous-
 *  route and the Batch Partition Agent's no-autonomous-assign — the harmful action is enforced-off.)
 *
 * ─────────────────────────────────────────────────────────────────────
 *  LEGITIMATE FINDING vs GOVERNANCE BLOCK.
 * ─────────────────────────────────────────────────────────────────────
 *  A throttle plan — within-limits or throttled — is a SAFE, honest OUTPUT: the task COMPLETES (it carries
 *  requiresCoordinatorReview:true, autoSent:false). A throttled disposition is NOT a governance block — it is the
 *  honest finding that some attempts exceeded the frequency cap (surfacing which ones is the whole point). A
 *  GOVERNANCE BLOCK is when a caller PRESENTS an offending DETERMINATION (a fabricated / reordered replay, a
 *  mis-simulated throttle, or an autonomous send) — which the Agent Fabric rejects before it can leave the fabric.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified communications-compliance system.
 * ─────────────────────────────────────────────────────────────────────
 *  Real member-contact governance weighs TCPA / CAN-SPAM consent, quiet hours, channel-specific caps, member
 *  preferences, and campaign suppression lists — not a bare token bucket over illustrative timestamps. This
 *  throttles the supplied illustrative attempts only. TIME IS DATA: the timestamps + config are plain numbers and
 *  the replay is a pure function of them (no real clock, no randomness), so the same request always yields the
 *  same determination, which is what lets the demo, the seeded trace, and the tests agree. The attempts are a
 *  clearly-labeled ILLUSTRATIVE synthetic. The attempts reference member contacts, so a determination is treated
 *  as PHI-adjacent and the agent is on the HIPAA audit path.
 */

/** One outbound contact attempt: an id + when it was attempted (epoch ms). */
export type ContactAttempt = {
  id: string;
  /** Attempt time, epoch milliseconds. Attempts are processed in non-decreasing atMs order. */
  atMs: number;
};

/** A request: the member, the bucket config, and the ordered attempts. */
export type ContactRateLimitRequest = {
  memberRef: string;
  /** Burst capacity — the maximum tokens the bucket can hold (and the max back-to-back contacts). */
  capacity: number;
  /** Sustained refill rate, tokens per hour. */
  refillPerHour: number;
  /** The contact attempts, in (or to be sorted into) non-decreasing time order. */
  attempts: ContactAttempt[];
};

export type ContactRateLimitDisposition = "within-limits" | "throttled";

/** One attempt's decision + the bucket state observed just before it. */
export type ContactDecision = {
  id: string;
  atMs: number;
  decision: "permitted" | "throttled";
  /** Tokens available at this attempt (after refill, before consumption), rounded to 4 dp. */
  tokensBefore: number;
};

/** The deterministic finding the agent returns. */
export type ContactRateLimitDetermination = {
  memberRef: string;
  /** The submitted attempts, echoed (sorted by atMs) so the guards can recompute. */
  attempts: ContactAttempt[];
  capacity: number;
  refillPerHour: number;
  /** Per-attempt permit/throttle decisions, in time order. */
  decisions: ContactDecision[];
  permittedCount: number;
  throttledCount: number;
  /** Tokens left in the bucket after the last attempt, rounded to 4 dp. */
  finalTokens: number;
  attemptCount: number;
  disposition: ContactRateLimitDisposition;
  /** Always true — an outreach coordinator confirms every throttle plan. */
  requiresCoordinatorReview: true;
  /** Always false — the agent never autonomously sends or suppresses a contact. */
  autoSent: false;
  reason: string;
  synthetic: true;
  note: string;
};

/** Round to 4 decimal places so token math is stable across re-simulations (no float drift in comparisons). */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Sort attempts into non-decreasing atMs order, ties broken by id, without mutating the input. */
function sortedAttempts(attempts: ContactAttempt[]): ContactAttempt[] {
  return [...attempts].sort((a, b) => (a.atMs !== b.atMs ? a.atMs - b.atMs : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The core TOKEN-BUCKET simulation — pure. Starts full (capacity tokens), and for each attempt in time order:
 * accrue refill earned since the previous attempt (refillPerHour × elapsedHours), cap at capacity, then if ≥ 1
 * token is available consume one and PERMIT, else THROTTLE. Returns the per-attempt decisions (with the token
 * level seen just before each) and the final token level. Deterministic; a function of the config + timestamps
 * only.
 */
export function simulateTokenBucket(
  request: ContactRateLimitRequest
): { decisions: ContactDecision[]; finalTokens: number } {
  const capacity = Math.max(0, request.capacity);
  const refillPerHour = Math.max(0, request.refillPerHour);
  const attempts = sortedAttempts(Array.isArray(request.attempts) ? request.attempts : []);

  let tokens = capacity; // bucket starts full
  let lastMs: number | null = null;
  const decisions: ContactDecision[] = [];

  for (const a of attempts) {
    if (lastMs !== null) {
      const elapsedHours = Math.max(0, (a.atMs - lastMs) / 3_600_000);
      tokens = Math.min(capacity, tokens + elapsedHours * refillPerHour);
    }
    lastMs = a.atMs;
    const tokensBefore = round4(tokens);
    if (tokens >= 1) {
      tokens -= 1;
      decisions.push({ id: a.id, atMs: a.atMs, decision: "permitted", tokensBefore });
    } else {
      decisions.push({ id: a.id, atMs: a.atMs, decision: "throttled", tokensBefore });
    }
  }
  return { decisions, finalTokens: round4(tokens) };
}

/**
 * The deterministic throttle-planning function — the heart of the service. DETERMINISTIC: a pure function of the
 * request's own config + attempts (no randomness, no clock). It replays the token bucket, tallies permitted /
 * throttled, reads the final token level, and derives the disposition. Nothing is sent — the plan is handed to an
 * outreach coordinator.
 */
export function evaluateContactRateLimit(
  request: ContactRateLimitRequest
): ContactRateLimitDetermination {
  const attempts = sortedAttempts(Array.isArray(request.attempts) ? request.attempts : []);
  const capacity = Math.max(0, request.capacity);
  const refillPerHour = Math.max(0, request.refillPerHour);
  const { decisions, finalTokens } = simulateTokenBucket({ ...request, attempts, capacity, refillPerHour });
  const permittedCount = decisions.filter((d) => d.decision === "permitted").length;
  const throttledCount = decisions.length - permittedCount;
  const disposition: ContactRateLimitDisposition = throttledCount === 0 ? "within-limits" : "throttled";

  const reason =
    disposition === "within-limits"
      ? `All ${attempts.length} contact attempt(s) to ${request.memberRef} are within the frequency cap (capacity ${capacity}, refill ${refillPerHour}/hr) — none throttled.`
      : `${throttledCount} of ${attempts.length} contact attempt(s) to ${request.memberRef} exceed the frequency cap (capacity ${capacity}, refill ${refillPerHour}/hr) and are throttled; ${permittedCount} permitted.`;

  return {
    memberRef: request.memberRef,
    attempts,
    capacity,
    refillPerHour,
    decisions,
    permittedCount,
    throttledCount,
    finalTokens,
    attemptCount: attempts.length,
    disposition,
    requiresCoordinatorReview: true,
    autoSent: false,
    reason,
    synthetic: true,
    note:
      `Token-bucket throttle ${request.memberRef}: ${disposition.toUpperCase()} — ` +
      `${permittedCount} permitted / ${throttledCount} throttled of ${attempts.length} attempt(s) ` +
      `(capacity ${capacity}, refill ${refillPerHour}/hr) via TOKEN-BUCKET RATE LIMITING. ` +
      "Real member-contact governance weighs TCPA / CAN-SPAM consent, quiet hours, channel-specific caps, member preferences, and campaign suppression lists — not a bare token bucket over illustrative timestamps. Synthetic/illustrative attempts — NOT a certified communications-compliance system. The agent never sends a permitted contact or suppresses a throttled one on its own — an outreach coordinator confirms every plan. The attempts reference member contacts, so a determination is PHI-adjacent and on the HIPAA audit path."
  };
}

/**
 * Sourced + self-consistency check: are the reported decisions a REAL, self-consistent replay of the submitted
 * attempts? The decisions must cover EXACTLY the submitted attempts (same ids + timestamps, in non-decreasing
 * time order — none dropped, added, reordered, or with a fabricated timestamp), each decision must be "permitted"
 * or "throttled", the reported permittedCount / throttledCount must match the decisions, attemptCount must be
 * honest, and the disposition must follow (within-limits iff throttledCount === 0). Catches a fabricated attempt,
 * a reordered replay, or a miscounted tally. Does NOT re-simulate the bucket (that is the policy gate's job), so
 * it is independent of it. Anything evaluateContactRateLimit() produces satisfies it. This is the honest signal
 * the plan reports to policy.contactrate.replay-sourced. A non-object / malformed input is a violation.
 */
export function replaySourced(
  decision:
    | {
        attempts?: unknown;
        decisions?: unknown;
        permittedCount?: unknown;
        throttledCount?: unknown;
        attemptCount?: unknown;
        disposition?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const attempts = Array.isArray(decision.attempts) ? (decision.attempts as ContactAttempt[]) : null;
  const decisions = Array.isArray(decision.decisions) ? (decision.decisions as ContactDecision[]) : null;
  if (!attempts || !decisions) return false;
  for (const a of attempts) {
    if (!a || typeof a.id !== "string" || typeof a.atMs !== "number" || !Number.isFinite(a.atMs)) return false;
  }
  if (decisions.length !== attempts.length) return false;

  // The decisions must be an order-preserving cover of the submitted attempts, sorted by atMs (ties by id).
  const expectedOrder = sortedAttempts(attempts);
  let prevMs = -Infinity;
  let throttled = 0;
  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    if (!d || typeof d.id !== "string" || typeof d.atMs !== "number" || !Number.isFinite(d.atMs)) return false;
    if (d.decision !== "permitted" && d.decision !== "throttled") return false;
    if (d.id !== expectedOrder[i].id || d.atMs !== expectedOrder[i].atMs) return false; // dropped/added/reordered
    if (d.atMs < prevMs) return false; // not non-decreasing
    prevMs = d.atMs;
    if (d.decision === "throttled") throttled++;
  }
  const permitted = decisions.length - throttled;
  if (decision.permittedCount !== undefined && decision.permittedCount !== permitted) return false;
  if (decision.throttledCount !== undefined && decision.throttledCount !== throttled) return false;
  if (decision.attemptCount !== undefined && decision.attemptCount !== attempts.length) return false;

  const expectedDisposition: ContactRateLimitDisposition = throttled === 0 ? "within-limits" : "throttled";
  if (decision.disposition !== undefined && decision.disposition !== expectedDisposition) return false;
  return true;
}

/**
 * Policy-exactness check: re-running the token-bucket simulation over the submitted attempts + config must
 * reproduce the EXACT permit / throttle decision for every attempt and the final token level. True only when the
 * recompute agrees. Catches over-throttling (denying a contact the bucket would allow) and under-throttling
 * (permitting past the cap). The load-bearing correctness gate — it re-simulates the bucket from the attempts +
 * config INDEPENDENT of the reported decisions, so a fabricated replay that still reports the right tally fails
 * sourced only while a real-but-mis-simulated throttle fails here — the two gates are isolable. Anything
 * evaluateContactRateLimit() produces satisfies it. A non-object input is a violation.
 */
export function throttleExact(
  decision:
    | {
        memberRef?: unknown;
        capacity?: unknown;
        refillPerHour?: unknown;
        attempts?: unknown;
        decisions?: unknown;
        finalTokens?: unknown;
      }
    | null
    | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  const attempts = Array.isArray(decision.attempts) ? (decision.attempts as ContactAttempt[]) : null;
  const decisions = Array.isArray(decision.decisions) ? (decision.decisions as ContactDecision[]) : null;
  if (!attempts || !decisions) return false;
  if (typeof decision.capacity !== "number" || !Number.isFinite(decision.capacity)) return false;
  if (typeof decision.refillPerHour !== "number" || !Number.isFinite(decision.refillPerHour)) return false;
  for (const a of attempts) {
    if (!a || typeof a.id !== "string" || typeof a.atMs !== "number" || !Number.isFinite(a.atMs)) return false;
  }

  const { decisions: expected, finalTokens } = simulateTokenBucket({
    memberRef: typeof decision.memberRef === "string" ? decision.memberRef : "",
    capacity: decision.capacity,
    refillPerHour: decision.refillPerHour,
    attempts
  });
  if (decisions.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (decisions[i].id !== expected[i].id) return false;
    if (decisions[i].decision !== expected[i].decision) return false; // over/under-throttle
  }
  if (decision.finalTokens !== undefined && round4(decision.finalTokens as number) !== finalTokens) return false;
  return true;
}

/**
 * No-autonomous-send check: did the agent avoid sending / suppressing on its own? True unless the determination
 * reports it auto-sent contacts (autoSent:true) or does not require coordinator review (requiresCoordinatorReview:
 * false). Anything evaluateContactRateLimit() produces satisfies it. This is the honest signal the plan reports
 * to policy.contactrate.no-autonomous-send. A non-object input is a violation.
 */
export function noAutonomousSend(
  decision: { autoSent?: boolean; requiresCoordinatorReview?: boolean } | null | undefined
): boolean {
  if (!decision || typeof decision !== "object") return false;
  if (decision.autoSent === true) return false;
  if (decision.requiresCoordinatorReview === false) return false;
  return true;
}

/** A compact, trace-safe summary of a throttle plan. */
export function contactRateLimitSummary(decision: ContactRateLimitDetermination): {
  memberRef: string;
  disposition: ContactRateLimitDisposition;
  attemptCount: number;
  permittedCount: number;
  throttledCount: number;
  capacity: number;
  refillPerHour: number;
  requiresCoordinatorReview: boolean;
  synthetic: boolean;
} {
  return {
    memberRef: decision.memberRef,
    disposition: decision.disposition,
    attemptCount: decision.attemptCount,
    permittedCount: decision.permittedCount,
    throttledCount: decision.throttledCount,
    capacity: decision.capacity,
    refillPerHour: decision.refillPerHour,
    requiresCoordinatorReview: decision.requiresCoordinatorReview,
    synthetic: decision.synthetic
  };
}

const HOUR = 3_600_000;
const BASE = 1_700_000_000_000; // a fixed epoch-ms anchor so the demo timestamps are stable data, not a clock.

/**
 * A representative demo request: five contact attempts across ~90 minutes against a bucket of capacity 3
 * refilling 1 token/hour. The bucket starts full (3), so the first three burst through; the 4th (at +20 min,
 * before enough refill) is throttled; by the 5th (at +90 min) ~1.2 tokens have refilled, so it is permitted. Net:
 * 4 permitted, 1 throttled. "Throttled." Synthetic; PHI-adjacent (member contact labels).
 */
export const DEMO_CONTACT_RATE_LIMIT_REQUEST: ContactRateLimitRequest = {
  memberRef: "member-outreach-7731",
  capacity: 3,
  refillPerHour: 1,
  attempts: [
    { id: "call-1", atMs: BASE },
    { id: "text-1", atMs: BASE + 5 * 60_000 },
    { id: "email-1", atMs: BASE + 10 * 60_000 },
    { id: "call-2", atMs: BASE + 20 * 60_000 },
    { id: "text-2", atMs: BASE + 90 * 60_000 }
  ]
};

/**
 * A representative demo request where the attempts are spaced an hour apart against a bucket refilling 1/hr — the
 * sustained rate keeps pace, so every attempt is permitted. "Within-limits." Synthetic.
 */
export const DEMO_CONTACT_RATE_LIMIT_WITHIN_REQUEST: ContactRateLimitRequest = {
  memberRef: "member-checkin-2204",
  capacity: 2,
  refillPerHour: 1,
  attempts: [
    { id: "c1", atMs: BASE },
    { id: "c2", atMs: BASE + 1 * HOUR },
    { id: "c3", atMs: BASE + 2 * HOUR }
  ]
};

/**
 * A representative demo request with a single dense burst against a capacity-1 bucket — only the first attempt is
 * permitted, the rest throttled until refill. "Throttled." Synthetic.
 */
export const DEMO_CONTACT_RATE_LIMIT_BURST_REQUEST: ContactRateLimitRequest = {
  memberRef: "member-campaign-5560",
  capacity: 1,
  refillPerHour: 2,
  attempts: [
    { id: "m1", atMs: BASE },
    { id: "m2", atMs: BASE + 60_000 },
    { id: "m3", atMs: BASE + 120_000 }
  ]
};
