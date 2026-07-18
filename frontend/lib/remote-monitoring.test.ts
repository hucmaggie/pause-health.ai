import { describe, expect, it } from "vitest";
import {
  DEMO_MONITORING_READINGS,
  MONITORED_METRICS,
  RULE_RED_FLAG,
  RULE_WORSENING_TREND,
  assessMonitoring,
  buildEscalations,
  detectMetricTrend,
  escalationsRouteToHuman,
  getMonitoredMetric,
  isCatalogMetric,
  isValidReadingSource,
  readingsTraceToSource,
  type MonitoringReading
} from "./remote-monitoring";

/**
 * Tests for lib/remote-monitoring.ts — the deterministic longitudinal
 * symptom/vital trend detector behind the Remote Patient Monitoring Agent.
 * Trend classification is a pure function of the readings' own timestamps +
 * values (no randomness, no clock), so the same input series always produces
 * the same trends + escalations. These pin determinism, the improving / stable
 * / worsening window classification, red-flag threshold escalation, the
 * clinician-routed (never autonomous) escalation shape, and the two honest
 * governance signals (reading-source integrity + escalation-routed-to-human).
 */

function reading(
  metricId: string,
  at: string,
  value: number,
  source: MonitoringReading["source"] = "self-report"
): MonitoringReading {
  return { metricId, at, value, source };
}

describe("monitored-metric catalog", () => {
  it("exposes a non-empty catalog with stable ids, units, bands, and red flags", () => {
    expect(MONITORED_METRICS.length).toBeGreaterThan(0);
    for (const m of MONITORED_METRICS) {
      expect(m.id).toMatch(/^metric\./);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.rationale.length).toBeGreaterThan(0);
      expect(m.stableBand).toBeGreaterThan(0);
      expect(["up", "down"]).toContain(m.worseDirection);
      expect([">=", "<="]).toContain(m.redFlag.comparator);
    }
  });

  it("covers vasomotor, sleep, mood, a vital, and weight", () => {
    const ids = MONITORED_METRICS.map((m) => m.id);
    expect(ids).toContain("metric.hot-flash-frequency");
    expect(ids).toContain("metric.sleep-hours");
    expect(ids).toContain("metric.mood-score");
    expect(ids).toContain("metric.resting-heart-rate");
    expect(ids).toContain("metric.weight-kg");
  });

  it("isCatalogMetric / getMonitoredMetric agree with the catalog", () => {
    for (const m of MONITORED_METRICS) {
      expect(isCatalogMetric(m.id)).toBe(true);
      expect(getMonitoredMetric(m.id)?.label).toBe(m.label);
    }
    expect(isCatalogMetric("metric.totally-made-up")).toBe(false);
    expect(getMonitoredMetric("metric.totally-made-up")).toBeUndefined();
  });

  it("recognizes only device/self-report sources", () => {
    for (const s of ["self-report", "wearable", "device", "clinic-device"]) {
      expect(isValidReadingSource(s)).toBe(true);
    }
    expect(isValidReadingSource("fabricated")).toBe(false);
    expect(isValidReadingSource(undefined)).toBe(false);
    expect(isValidReadingSource("")).toBe(false);
  });
});

describe("detectMetricTrend · determinism + classification", () => {
  it("is deterministic — the same series yields the same trend", () => {
    const series = [
      reading("metric.hot-flash-frequency", "2026-01-05", 6),
      reading("metric.hot-flash-frequency", "2026-01-26", 12)
    ];
    expect(detectMetricTrend("metric.hot-flash-frequency", series)).toEqual(
      detectMetricTrend("metric.hot-flash-frequency", series)
    );
  });

  it("sorts by the readings' own timestamps (order-independent)", () => {
    const forward = [
      reading("metric.sleep-hours", "2026-01-05", 7, "wearable"),
      reading("metric.sleep-hours", "2026-01-26", 5, "wearable")
    ];
    const shuffled = [forward[1], forward[0]];
    expect(detectMetricTrend("metric.sleep-hours", shuffled)).toEqual(
      detectMetricTrend("metric.sleep-hours", forward)
    );
  });

  it("classifies a rising metric where up is worse as worsening", () => {
    const t = detectMetricTrend("metric.hot-flash-frequency", [
      reading("metric.hot-flash-frequency", "2026-01-05", 6),
      reading("metric.hot-flash-frequency", "2026-01-12", 7),
      reading("metric.hot-flash-frequency", "2026-01-19", 10),
      reading("metric.hot-flash-frequency", "2026-01-26", 12)
    ]);
    expect(t.trend).toBe("worsening");
    expect(t.redFlag).toBe(false);
    expect(t.delta).toBeGreaterThan(0);
  });

  it("classifies a falling metric where down is worse as worsening", () => {
    const t = detectMetricTrend("metric.sleep-hours", [
      reading("metric.sleep-hours", "2026-01-05", 7, "wearable"),
      reading("metric.sleep-hours", "2026-01-12", 6.5, "wearable"),
      reading("metric.sleep-hours", "2026-01-19", 5.5, "wearable"),
      reading("metric.sleep-hours", "2026-01-26", 5, "wearable")
    ]);
    expect(t.trend).toBe("worsening");
    expect(t.delta).toBeLessThan(0);
  });

  it("classifies a rising mood (down is worse) as improving", () => {
    const t = detectMetricTrend("metric.mood-score", [
      reading("metric.mood-score", "2026-01-05", 4),
      reading("metric.mood-score", "2026-01-12", 5),
      reading("metric.mood-score", "2026-01-19", 6),
      reading("metric.mood-score", "2026-01-26", 7)
    ]);
    expect(t.trend).toBe("improving");
  });

  it("classifies a change within the stable band as stable", () => {
    const t = detectMetricTrend("metric.resting-heart-rate", [
      reading("metric.resting-heart-rate", "2026-01-05", 68, "wearable"),
      reading("metric.resting-heart-rate", "2026-01-12", 69, "wearable"),
      reading("metric.resting-heart-rate", "2026-01-19", 70, "wearable"),
      reading("metric.resting-heart-rate", "2026-01-26", 70, "wearable")
    ]);
    expect(t.trend).toBe("stable");
  });

  it("flags a most-recent value crossing the red-flag threshold", () => {
    const t = detectMetricTrend("metric.hot-flash-frequency", [
      reading("metric.hot-flash-frequency", "2026-01-05", 10),
      reading("metric.hot-flash-frequency", "2026-01-26", 16)
    ]);
    expect(t.redFlag).toBe(true);
    expect(t.latestValue).toBe(16);
  });

  it("treats a single reading as stable (insufficient history)", () => {
    const t = detectMetricTrend("metric.sleep-hours", [
      reading("metric.sleep-hours", "2026-01-05", 6, "wearable")
    ]);
    expect(t.trend).toBe("stable");
    expect(t.readingsCount).toBe(1);
  });
});

describe("assessMonitoring + buildEscalations · clinician-routed escalation", () => {
  it("routes worsening + red-flag trends to clinician review, never acting autonomously", () => {
    const assessment = assessMonitoring(DEMO_MONITORING_READINGS);
    // The demo mix: hot-flash worsening + sleep worsening escalate; mood
    // improving + resting-HR stable do not.
    expect(assessment.overallStatus).toBe("escalate");
    expect(assessment.escalations.length).toBeGreaterThan(0);
    for (const e of assessment.escalations) {
      expect(e.routedTo).toBe("clinician-review");
      expect([RULE_RED_FLAG, RULE_WORSENING_TREND]).toContain(e.triggeringRule);
    }
    const metricIds = assessment.escalations.map((e) => e.metricId);
    expect(metricIds).toContain("metric.hot-flash-frequency");
    expect(metricIds).toContain("metric.sleep-hours");
    // Every escalation cites the metric + rule that triggered it.
    expect(escalationsRouteToHuman(assessment.escalations)).toBe(true);
    expect(assessment.synthetic).toBe(true);
  });

  it("escalates a red-flag crossing as urgent and a worsening trend as elevated", () => {
    const urgent = buildEscalations([
      detectMetricTrend("metric.hot-flash-frequency", [
        reading("metric.hot-flash-frequency", "2026-01-05", 10),
        reading("metric.hot-flash-frequency", "2026-01-26", 16)
      ])
    ]);
    expect(urgent[0].severity).toBe("urgent");
    expect(urgent[0].triggeringRule).toBe(RULE_RED_FLAG);

    const elevated = buildEscalations([
      detectMetricTrend("metric.hot-flash-frequency", [
        reading("metric.hot-flash-frequency", "2026-01-05", 6),
        reading("metric.hot-flash-frequency", "2026-01-26", 12)
      ])
    ]);
    expect(elevated[0].severity).toBe("elevated");
    expect(elevated[0].triggeringRule).toBe(RULE_WORSENING_TREND);
  });

  it("returns stable/improving with no escalation for a benign series", () => {
    const assessment = assessMonitoring([
      reading("metric.mood-score", "2026-01-05", 4),
      reading("metric.mood-score", "2026-01-12", 5),
      reading("metric.mood-score", "2026-01-19", 6),
      reading("metric.mood-score", "2026-01-26", 7)
    ]);
    expect(assessment.escalations).toHaveLength(0);
    expect(assessment.overallStatus).toBe("improving");
  });

  it("ignores off-catalog metrics in the assessment", () => {
    const assessment = assessMonitoring([
      reading("metric.totally-invented", "2026-01-05", 1),
      reading("metric.totally-invented", "2026-01-26", 99)
    ]);
    expect(assessment.perMetricTrends).toHaveLength(0);
    expect(assessment.escalations).toHaveLength(0);
  });
});

describe("readingsTraceToSource · reading-source integrity signal", () => {
  it("is true when every reading traces to a source and a catalog metric", () => {
    expect(readingsTraceToSource(DEMO_MONITORING_READINGS)).toBe(true);
  });

  it("is false for a fabricated reading (missing / off-list source)", () => {
    expect(
      readingsTraceToSource([
        { metricId: "metric.sleep-hours", source: "fabricated" as never }
      ])
    ).toBe(false);
  });

  it("is false for an off-catalog metric", () => {
    expect(
      readingsTraceToSource([
        { metricId: "metric.totally-invented", source: "self-report" }
      ])
    ).toBe(false);
  });

  it("is false for a non-array input", () => {
    expect(readingsTraceToSource(null)).toBe(false);
    expect(readingsTraceToSource(undefined)).toBe(false);
  });
});

describe("escalationsRouteToHuman · no-autonomous-escalation signal", () => {
  it("is true for a clinician-routed set (and an empty set)", () => {
    expect(escalationsRouteToHuman([])).toBe(true);
    expect(
      escalationsRouteToHuman([{ routedTo: "clinician-review" }])
    ).toBe(true);
  });

  it("is false for a caller-asserted autonomous escalation", () => {
    expect(
      escalationsRouteToHuman([
        { routedTo: "auto-order" as never }
      ])
    ).toBe(false);
    expect(escalationsRouteToHuman(null)).toBe(false);
  });
});
