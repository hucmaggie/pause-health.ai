import { describe, expect, it } from "vitest";

import {
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW_MINUTES,
  DEMO_ACCESS_ANOMALY_BURST_REQUEST,
  DEMO_ACCESS_ANOMALY_NORMAL_REQUEST,
  DEMO_ACCESS_ANOMALY_REQUEST,
  accessAnomalySummary,
  accessEventsSourced,
  accessNoAutonomousAction,
  accessWindowCountConsistent,
  evaluateAccessAnomaly,
  toEpochMs
} from "./access-anomaly";

describe("toEpochMs", () => {
  it("parses an ISO datetime", () => {
    expect(toEpochMs("2025-01-15T09:00:00Z")).toBe(1736931600000);
  });
  it("rejects an invalid / empty timestamp", () => {
    expect(toEpochMs("not-a-date")).toBeNull();
    expect(toEpochMs("")).toBeNull();
    // @ts-expect-error deliberately wrong type
    expect(toEpochMs(null)).toBeNull();
  });
});

describe("evaluateAccessAnomaly", () => {
  it("flags an anomalous access volume over the threshold", () => {
    const d = evaluateAccessAnomaly(DEMO_ACCESS_ANOMALY_REQUEST);
    expect(d.disposition).toBe("anomalous-access-volume");
    expect(d.hasAnomaly).toBe(true);
    expect(d.peakWindow.count).toBe(24);
    expect(d.peakWindow.distinctPatients).toBe(24);
    expect(d.totalEvents).toBe(24);
    expect(d.windowMinutes).toBe(60);
    expect(d.threshold).toBe(20);
    expect(d.requiresPrivacyReview).toBe(true);
    expect(d.autoLockedAccount).toBe(false);
    expect(d.autoRevokedAccess).toBe(false);
  });

  it("reports normal activity for spread-out access", () => {
    const d = evaluateAccessAnomaly(DEMO_ACCESS_ANOMALY_NORMAL_REQUEST);
    expect(d.disposition).toBe("normal");
    expect(d.hasAnomaly).toBe(false);
    // 90 minutes apart, 60-minute window → every window holds exactly one event.
    expect(d.peakWindow.count).toBe(1);
    expect(d.totalEvents).toBe(6);
  });

  it("is WINDOWED, not a naive total (high total, small bursts → normal)", () => {
    const d = evaluateAccessAnomaly(DEMO_ACCESS_ANOMALY_BURST_REQUEST);
    expect(d.totalEvents).toBe(18);
    // Bursts of 3 within a 30-minute window, threshold 5 → peak 3, not anomalous.
    expect(d.peakWindow.count).toBe(3);
    expect(d.hasAnomaly).toBe(false);
    expect(d.disposition).toBe("normal");
  });

  it("counts events at the window boundary (inclusive span)", () => {
    // 5 events exactly 15 minutes apart span 60 minutes → all fit one 60-min window.
    const events = [0, 15, 30, 45, 60].map((m, i) => ({
      eventId: `e${i}`,
      patientRef: `p${i}`,
      action: "view",
      timestamp: new Date(Date.parse("2025-01-15T09:00:00Z") + m * 60_000).toISOString()
    }));
    const d = evaluateAccessAnomaly({
      requestRef: "r",
      actorRef: "a",
      windowMinutes: 60,
      threshold: 4,
      events
    });
    expect(d.peakWindow.count).toBe(5);
    expect(d.hasAnomaly).toBe(true);
  });

  it("excludes an event just outside the window", () => {
    // 3 events at 0, 30, 61 minutes; a 60-min window holds at most the first two.
    const events = [0, 30, 61].map((m, i) => ({
      eventId: `e${i}`,
      patientRef: `p${i}`,
      action: "view",
      timestamp: new Date(Date.parse("2025-01-15T09:00:00Z") + m * 60_000).toISOString()
    }));
    const d = evaluateAccessAnomaly({
      requestRef: "r",
      actorRef: "a",
      windowMinutes: 60,
      threshold: 10,
      events
    });
    expect(d.peakWindow.count).toBe(2);
  });

  it("skips events with an invalid timestamp", () => {
    const d = evaluateAccessAnomaly({
      requestRef: "r",
      actorRef: "a",
      events: [
        { eventId: "good", patientRef: "p1", action: "view", timestamp: "2025-01-15T09:00:00Z" },
        { eventId: "bad", patientRef: "p2", action: "view", timestamp: "nope" }
      ]
    });
    expect(d.invalidEvents).toEqual(["bad"]);
    expect(d.events).toHaveLength(1);
  });

  it("handles an empty event set", () => {
    const d = evaluateAccessAnomaly({ requestRef: "r", actorRef: "a", events: [] });
    expect(d.peakWindow.count).toBe(0);
    expect(d.disposition).toBe("normal");
    expect(d.totalEvents).toBe(0);
  });

  it("defaults the window + threshold when unset", () => {
    const d = evaluateAccessAnomaly({
      requestRef: "r",
      actorRef: "a",
      events: [{ eventId: "e", patientRef: "p", action: "view", timestamp: "2025-01-15T09:00:00Z" }]
    });
    expect(d.windowMinutes).toBe(DEFAULT_WINDOW_MINUTES);
    expect(d.threshold).toBe(DEFAULT_THRESHOLD);
  });

  it("is deterministic", () => {
    expect(evaluateAccessAnomaly(DEMO_ACCESS_ANOMALY_REQUEST)).toEqual(
      evaluateAccessAnomaly(DEMO_ACCESS_ANOMALY_REQUEST)
    );
  });
});

describe("accessEventsSourced", () => {
  it("passes produced determinations", () => {
    expect(accessEventsSourced(evaluateAccessAnomaly(DEMO_ACCESS_ANOMALY_REQUEST))).toBe(true);
    expect(accessEventsSourced(evaluateAccessAnomaly(DEMO_ACCESS_ANOMALY_NORMAL_REQUEST))).toBe(true);
  });
  it("passes an empty peak", () => {
    expect(accessEventsSourced(evaluateAccessAnomaly({ requestRef: "r", actorRef: "a", events: [] }))).toBe(
      true
    );
  });
  it("fails a peak event not backed by a submitted event", () => {
    expect(
      accessEventsSourced({
        peakWindow: { count: 1, distinctPatients: 1, eventIds: ["ghost"] },
        events: [{ eventId: "real", patientRef: "p1" }]
      })
    ).toBe(false);
  });
  it("fails a phantom count (count != eventIds length)", () => {
    expect(
      accessEventsSourced({
        peakWindow: { count: 5, distinctPatients: 1, eventIds: ["real"] },
        events: [{ eventId: "real", patientRef: "p1" }]
      })
    ).toBe(false);
  });
  it("fails an overstated distinct-patient breadth", () => {
    expect(
      accessEventsSourced({
        peakWindow: { count: 1, distinctPatients: 9, eventIds: ["real"] },
        events: [{ eventId: "real", patientRef: "p1" }]
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(accessEventsSourced(null)).toBe(false);
  });
});

describe("accessWindowCountConsistent", () => {
  it("passes produced determinations", () => {
    expect(accessWindowCountConsistent(evaluateAccessAnomaly(DEMO_ACCESS_ANOMALY_REQUEST))).toBe(true);
    expect(accessWindowCountConsistent(evaluateAccessAnomaly(DEMO_ACCESS_ANOMALY_BURST_REQUEST))).toBe(true);
  });
  it("fails a miscounted peak", () => {
    expect(
      accessWindowCountConsistent({
        peakWindow: { count: 9, eventIds: ["e1", "e2"] },
        events: [
          { eventId: "e1", epochMs: 0 },
          { eventId: "e2", epochMs: 60_000 }
        ],
        windowMinutes: 60,
        threshold: 20,
        hasAnomaly: false
      })
    ).toBe(false);
  });
  it("fails a window wider than the configured length", () => {
    // Two events 90 minutes apart claimed as one 60-minute-window peak.
    expect(
      accessWindowCountConsistent({
        peakWindow: { count: 2, eventIds: ["e1", "e2"] },
        events: [
          { eventId: "e1", epochMs: 0 },
          { eventId: "e2", epochMs: 90 * 60_000 }
        ],
        windowMinutes: 60,
        threshold: 20,
        hasAnomaly: false
      })
    ).toBe(false);
  });
  it("fails a mismatched anomaly flag", () => {
    expect(
      accessWindowCountConsistent({
        peakWindow: { count: 2, eventIds: ["e1", "e2"] },
        events: [
          { eventId: "e1", epochMs: 0 },
          { eventId: "e2", epochMs: 60_000 }
        ],
        windowMinutes: 60,
        threshold: 20,
        hasAnomaly: true // wrong: 2 does not exceed 20
      })
    ).toBe(false);
  });
  it("fails a null input", () => {
    expect(accessWindowCountConsistent(null)).toBe(false);
  });
});

describe("accessNoAutonomousAction", () => {
  it("passes a produced determination", () => {
    expect(accessNoAutonomousAction(evaluateAccessAnomaly(DEMO_ACCESS_ANOMALY_REQUEST))).toBe(true);
  });
  it("fails an autonomously-locked account", () => {
    expect(
      accessNoAutonomousAction({ autoLockedAccount: true, autoRevokedAccess: false, requiresPrivacyReview: true })
    ).toBe(false);
  });
  it("fails an autonomously-revoked access", () => {
    expect(
      accessNoAutonomousAction({ autoLockedAccount: false, autoRevokedAccess: true, requiresPrivacyReview: true })
    ).toBe(false);
  });
  it("fails an un-reviewed finding", () => {
    expect(
      accessNoAutonomousAction({ autoLockedAccount: false, autoRevokedAccess: false, requiresPrivacyReview: false })
    ).toBe(false);
  });
});

describe("accessAnomalySummary", () => {
  it("projects a compact, trace-safe summary", () => {
    const s = accessAnomalySummary(evaluateAccessAnomaly(DEMO_ACCESS_ANOMALY_REQUEST));
    expect(s.disposition).toBe("anomalous-access-volume");
    expect(s.peakCount).toBe(24);
    expect(s.distinctPatients).toBe(24);
    expect(s.totalEvents).toBe(24);
    expect(s.hasAnomaly).toBe(true);
    expect(s.requiresPrivacyReview).toBe(true);
    expect(s.synthetic).toBe(true);
  });
});
