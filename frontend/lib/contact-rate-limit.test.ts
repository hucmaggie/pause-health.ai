import { describe, expect, it } from "vitest";

import {
  DEMO_CONTACT_RATE_LIMIT_BURST_REQUEST,
  DEMO_CONTACT_RATE_LIMIT_REQUEST,
  DEMO_CONTACT_RATE_LIMIT_WITHIN_REQUEST,
  contactRateLimitSummary,
  evaluateContactRateLimit,
  noAutonomousSend,
  replaySourced,
  simulateTokenBucket,
  throttleExact
} from "./contact-rate-limit";

describe("simulateTokenBucket", () => {
  it("bursts up to capacity then throttles until refill", () => {
    const { decisions, finalTokens } = simulateTokenBucket(DEMO_CONTACT_RATE_LIMIT_REQUEST);
    expect(decisions.map((d) => d.decision)).toEqual([
      "permitted",
      "permitted",
      "permitted",
      "throttled",
      "permitted"
    ]);
    expect(finalTokens).toBe(0.5);
  });

  it("keeps pace when attempts match the sustained refill", () => {
    const { decisions } = simulateTokenBucket(DEMO_CONTACT_RATE_LIMIT_WITHIN_REQUEST);
    expect(decisions.every((d) => d.decision === "permitted")).toBe(true);
  });

  it("permits only the first of a dense burst against a capacity-1 bucket", () => {
    const { decisions } = simulateTokenBucket(DEMO_CONTACT_RATE_LIMIT_BURST_REQUEST);
    expect(decisions.map((d) => d.decision)).toEqual(["permitted", "throttled", "throttled"]);
  });

  it("handles no attempts", () => {
    const { decisions, finalTokens } = simulateTokenBucket({
      memberRef: "m",
      capacity: 3,
      refillPerHour: 1,
      attempts: []
    });
    expect(decisions).toEqual([]);
    expect(finalTokens).toBe(3);
  });
});

describe("evaluateContactRateLimit", () => {
  it("classifies a throttled burst", () => {
    const d = evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST);
    expect(d.disposition).toBe("throttled");
    expect(d.permittedCount).toBe(4);
    expect(d.throttledCount).toBe(1);
    expect(d.finalTokens).toBe(0.5);
    expect(d.requiresCoordinatorReview).toBe(true);
    expect(d.autoSent).toBe(false);
  });

  it("classifies a within-limits cadence", () => {
    const d = evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_WITHIN_REQUEST);
    expect(d.disposition).toBe("within-limits");
    expect(d.throttledCount).toBe(0);
  });

  it("sorts attempts into time order before replaying", () => {
    const d = evaluateContactRateLimit({
      memberRef: "m",
      capacity: 1,
      refillPerHour: 0,
      attempts: [
        { id: "late", atMs: 2000 },
        { id: "early", atMs: 1000 }
      ]
    });
    expect(d.decisions.map((x) => x.id)).toEqual(["early", "late"]);
    expect(d.decisions.map((x) => x.decision)).toEqual(["permitted", "throttled"]);
  });

  it("is deterministic", () => {
    expect(evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST)).toEqual(
      evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST)
    );
  });
});

describe("replaySourced", () => {
  it("is true for each demo plan", () => {
    expect(replaySourced(evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST))).toBe(true);
    expect(replaySourced(evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_WITHIN_REQUEST))).toBe(true);
    expect(replaySourced(evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_BURST_REQUEST))).toBe(true);
  });

  it("is false for a reordered replay", () => {
    const d = evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST);
    const decisions = [d.decisions[1], d.decisions[0], ...d.decisions.slice(2)];
    expect(replaySourced({ ...d, decisions })).toBe(false);
  });

  it("is false for a miscounted tally", () => {
    const d = evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST);
    expect(replaySourced({ ...d, permittedCount: d.permittedCount + 1 })).toBe(false);
  });

  it("is false for a dropped attempt", () => {
    const d = evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST);
    expect(replaySourced({ ...d, decisions: d.decisions.slice(0, 4) })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(replaySourced(null)).toBe(false);
  });
});

describe("throttleExact", () => {
  it("is true for each demo plan", () => {
    expect(throttleExact(evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST))).toBe(true);
    expect(throttleExact(evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_BURST_REQUEST))).toBe(true);
  });

  it("is false for an under-throttled decision (while replay-sourced stays true)", () => {
    const d = evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST);
    // Flip the throttled attempt (index 3) to permitted: a self-consistent replay, but the bucket would throttle.
    const decisions = d.decisions.map((x, i) =>
      i === 3 ? { ...x, decision: "permitted" as const } : x
    );
    const tampered = { ...d, decisions, permittedCount: 5, throttledCount: 0, disposition: "within-limits" as const };
    expect(replaySourced(tampered)).toBe(true);
    expect(throttleExact(tampered)).toBe(false);
  });

  it("is false for a mismatched final token level", () => {
    const d = evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST);
    expect(throttleExact({ ...d, finalTokens: 2.5 })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(throttleExact(undefined)).toBe(false);
  });
});

describe("noAutonomousSend", () => {
  it("is true for a produced plan", () => {
    expect(noAutonomousSend(evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST))).toBe(true);
  });

  it("is false when auto-sent", () => {
    const d = evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST);
    expect(noAutonomousSend({ ...d, autoSent: true as unknown as false })).toBe(false);
  });

  it("is false when coordinator review is skipped", () => {
    const d = evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST);
    expect(noAutonomousSend({ ...d, requiresCoordinatorReview: false as unknown as true })).toBe(false);
  });

  it("is false for a non-object", () => {
    expect(noAutonomousSend(null)).toBe(false);
  });
});

describe("contactRateLimitSummary", () => {
  it("projects the trace-safe fields", () => {
    const d = evaluateContactRateLimit(DEMO_CONTACT_RATE_LIMIT_REQUEST);
    expect(contactRateLimitSummary(d)).toEqual({
      memberRef: "member-outreach-7731",
      disposition: "throttled",
      attemptCount: 5,
      permittedCount: 4,
      throttledCount: 1,
      capacity: 3,
      refillPerHour: 1,
      requiresCoordinatorReview: true,
      synthetic: true
    });
  });
});
