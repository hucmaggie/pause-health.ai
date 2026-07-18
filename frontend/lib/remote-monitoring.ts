/**
 * Remote Patient Monitoring & Symptom-Trend Tracking — longitudinal
 * (time-series) menopause/midlife symptom & vital tracking with deterministic
 * trend detection and clinician-routed escalation.
 *
 * Deterministic, dependency-free domain core the Remote Patient Monitoring Agent
 * (app/api/agents/remote-monitoring) wraps — the Salesforce "Agentforce for
 * Health" / Health Cloud remote-patient-monitoring analog on Pause's Agent
 * Fabric. It ingests longitudinal self-reported or wearable/device readings for
 * a menopause/midlife patient (hot-flash frequency, sleep hours, mood score,
 * resting heart rate, weight), DETERMINISTICALLY classifies each metric's trend
 * over the reading window (improving / stable / worsening) by comparing a recent
 * window against a baseline window, applies (synthetic) red-flag thresholds, and
 * ROUTES worsening or red-flag trends to a human clinician for review — it never
 * takes an autonomous clinical action.
 *
 *   Inbound:  MonitoringReading[] (each: metricId, an EXPLICIT timestamp `at`,
 *             a numeric value, and a device/self-report source)
 *   Outbound: MonitoringAssessment { perMetricTrends[], escalations[] (each with
 *             metric, triggeringRule, severity, routedTo:'clinician-review'),
 *             overallStatus, synthetic:true, note }
 *
 * ─────────────────────────────────────────────────────────────────────
 *  CRITICAL HONESTY PROPERTY: this agent only MONITORS + ROUTES.
 * ─────────────────────────────────────────────────────────────────────
 *  A worsening or red-flag trend is ROUTED to a human clinician for review
 *  (routedTo: 'clinician-review'). The agent must NEVER act on a trend
 *  autonomously (no auto-ordering, auto-medication, auto-titration). This
 *  module encodes that: every escalation this module produces is routedTo
 *  'clinician-review', and escalationsRouteToHuman() reports the honest signal
 *  the Agent Fabric enforces via policy.rpm.no-autonomous-escalation (a
 *  caller-asserted autonomous escalation → false → blocked).
 *
 * ─────────────────────────────────────────────────────────────────────
 *  DEMO-HONESTY: this is NOT a certified remote-monitoring device.
 * ─────────────────────────────────────────────────────────────────────
 *  The monitored metrics, their trend bands, and their red-flag thresholds
 *  below are ILLUSTRATIVE synthetic/demo values chosen to model the SHAPE of
 *  longitudinal trend detection — they are NOT certified or clinically-
 *  authoritative RPM thresholds (real thresholds are device-, vendor-, and
 *  patient-specific). There is NO randomness and NO clock anywhere here: the
 *  window split + trend classification is a pure function of the readings' own
 *  timestamps (the caller passes `at` as data), so the same input series always
 *  yields the same trend + escalation decision — which is what lets the demo,
 *  the seeded trace, and the tests agree.
 */

/** Which direction of change constitutes a WORSENING trend for a metric. */
export type WorseDirection = "up" | "down";

/** A monitored longitudinal metric in the (illustrative) catalog. */
export type MonitoredMetric = {
  /** Stable catalog id every MonitoringReading must reference. */
  id: string;
  /** Human-readable metric label. */
  label: string;
  /** Display unit for the value (e.g. "/day", "hrs", "bpm"). */
  unit: string;
  /** Whether an increase ("up") or a decrease ("down") is the worsening direction. */
  worseDirection: WorseDirection;
  /**
   * Minimum absolute change in the window means to count as a real trend, in the
   * metric's unit. A change smaller than this is classified "stable". Illustrative.
   */
  stableBand: number;
  /**
   * A (synthetic) red-flag threshold applied to the MOST RECENT reading. When the
   * latest value crosses it in the worsening direction, the metric is red-flagged
   * and escalated as urgent. Illustrative — not a certified clinical threshold.
   */
  redFlag: { comparator: ">=" | "<="; value: number };
  /**
   * The (illustrative) reason this metric is monitored in a menopause-care
   * context. NOT a certified rationale — a demo-honest description.
   */
  rationale: string;
};

/**
 * The monitored-metric catalog. Illustrative/synthetic values; NOT a certified
 * remote-monitoring device (see the module header). A small, menopause-relevant
 * set: vasomotor burden, sleep, mood, a cardiovascular vital, and weight.
 */
export const MONITORED_METRICS: MonitoredMetric[] = [
  {
    id: "metric.hot-flash-frequency",
    label: "Hot-flash frequency",
    unit: "/day",
    worseDirection: "up",
    // ~2 more hot flashes/day sustained is a meaningful worsening, illustrative.
    stableBand: 2,
    // ≥15 vasomotor episodes/day is a red-flag burden, illustrative.
    redFlag: { comparator: ">=", value: 15 },
    rationale:
      "Rising vasomotor (hot-flash) frequency signals worsening symptom burden that may warrant a therapy review. (Illustrative — not a certified threshold.)"
  },
  {
    id: "metric.sleep-hours",
    label: "Sleep duration",
    unit: "hrs",
    worseDirection: "down",
    // ~1 hour less sleep/night sustained is a meaningful decline, illustrative.
    stableBand: 1,
    // ≤4 hours/night is a red-flag sleep deficit, illustrative.
    redFlag: { comparator: "<=", value: 4 },
    rationale:
      "Declining sleep duration is a common, quality-of-life-limiting menopause symptom worth surfacing to a clinician. (Illustrative — not a certified threshold.)"
  },
  {
    id: "metric.mood-score",
    label: "Mood score (0–10, higher is better)",
    unit: "pts",
    worseDirection: "down",
    // ~1.5-point drop on a 0–10 scale is a meaningful decline, illustrative.
    stableBand: 1.5,
    // A most-recent mood ≤3/10 is a red-flag low-mood cutoff, illustrative.
    redFlag: { comparator: "<=", value: 3 },
    rationale:
      "A falling self-reported mood score can indicate worsening mood/depressive symptoms that a clinician should review. (Illustrative — not a validated instrument.)"
  },
  {
    id: "metric.resting-heart-rate",
    label: "Resting heart rate",
    unit: "bpm",
    worseDirection: "up",
    // ~6 bpm sustained rise is a meaningful change, illustrative.
    stableBand: 6,
    // ≥100 bpm resting is a red-flag tachycardia cutoff, illustrative.
    redFlag: { comparator: ">=", value: 100 },
    rationale:
      "A rising resting heart rate is a wearable-derived cardiovascular signal worth a clinician's attention. (Illustrative — not a certified threshold.)"
  },
  {
    id: "metric.weight-kg",
    label: "Body weight",
    unit: "kg",
    worseDirection: "up",
    // ~2 kg sustained change over the window is a meaningful trend, illustrative.
    stableBand: 2,
    // ≥100 kg is a synthetic red-flag cutoff for this demo cohort, illustrative.
    redFlag: { comparator: ">=", value: 100 },
    rationale:
      "Sustained weight gain across the menopause transition compounds cardiometabolic risk and can warrant review. (Illustrative — not a certified threshold.)"
  }
];

const METRIC_BY_ID = new Map(MONITORED_METRICS.map((m) => [m.id, m]));

/** Is `id` a defined monitored-metric catalog id? */
export function isCatalogMetric(id: string): boolean {
  return METRIC_BY_ID.has(id);
}

/** Look up a monitored metric by id (undefined for an off-catalog id). */
export function getMonitoredMetric(id: string): MonitoredMetric | undefined {
  return METRIC_BY_ID.get(id);
}

/**
 * The source a reading traces to. Every legitimate reading is either patient
 * self-reported or captured from a wearable / connected device / clinic device;
 * a reading without a recognized source is treated as fabricated.
 */
export type ReadingSource = "self-report" | "wearable" | "device" | "clinic-device";

/** The recognized reading sources (a reading must trace to one of these). */
export const READING_SOURCES: ReadingSource[] = [
  "self-report",
  "wearable",
  "device",
  "clinic-device"
];

const READING_SOURCE_SET = new Set<string>(READING_SOURCES);

/** Is `source` a recognized device/self-report reading source? */
export function isValidReadingSource(source: unknown): source is ReadingSource {
  return typeof source === "string" && READING_SOURCE_SET.has(source);
}

/**
 * A single longitudinal reading. Deterministic: the caller supplies an EXPLICIT
 * timestamp `at` (ISO-8601; sorted lexically, which is chronological for ISO),
 * so there is no clock dependency.
 */
export type MonitoringReading = {
  /** The monitored-metric catalog id (e.g. "metric.sleep-hours"). */
  metricId: string;
  /** When the reading was taken (ISO-8601 date or datetime). */
  at: string;
  /** The numeric value in the metric's unit. */
  value: number;
  /** Where the reading traces to (device/self-report); required for integrity. */
  source: ReadingSource;
};

export type MetricTrendKind = "improving" | "stable" | "worsening";

/** A per-metric trend classification over the reading window. */
export type MetricTrend = {
  /** The monitored-metric catalog id this trend is about. */
  metricId: string;
  metricLabel: string;
  unit: string;
  /** improving / stable / worsening over the window (deterministic). */
  trend: MetricTrendKind;
  /** Mean of the baseline (earlier) window, rounded to 2 decimals. */
  baselineMean: number;
  /** Mean of the recent (later) window, rounded to 2 decimals. */
  recentMean: number;
  /** recentMean − baselineMean, rounded to 2 decimals. */
  delta: number;
  /** The most-recent reading's value. */
  latestValue: number;
  /** The most-recent reading's timestamp. */
  latestAt: string;
  /** How many readings fed the classification. */
  readingsCount: number;
  /** True when the most-recent value crosses the (synthetic) red-flag threshold. */
  redFlag: boolean;
  /** Human-readable reason for the trend + red-flag call. */
  rationale: string;
};

export type EscalationSeverity = "elevated" | "urgent";
/** Escalations are ALWAYS routed to a human clinician — never acted on autonomously. */
export type EscalationRoute = "clinician-review";

/** A worsening / red-flag trend routed to a clinician for review. */
export type MonitoringEscalation = {
  /** The monitored-metric catalog id that triggered the escalation. */
  metricId: string;
  metricLabel: string;
  /** The rule id that fired (every escalation cites the rule that triggered it). */
  triggeringRule: string;
  /** Human-readable description of the triggering rule. */
  ruleDescription: string;
  /** urgent for a red-flag threshold crossing; elevated for a worsening trend. */
  severity: EscalationSeverity;
  /** Always "clinician-review" — the agent routes to a human, never acts. */
  routedTo: EscalationRoute;
  /** Human-readable reason this escalation was raised. */
  rationale: string;
};

export type OverallStatus = "stable" | "improving" | "escalate";

/** The deterministic assessment the agent returns. */
export type MonitoringAssessment = {
  /** Per-metric trend classifications, one per metric with readings. */
  perMetricTrends: MetricTrend[];
  /** Worsening / red-flag trends routed to a clinician (may be empty). */
  escalations: MonitoringEscalation[];
  /** Roll-up: escalate (any escalation) / improving / stable. */
  overallStatus: OverallStatus;
  /** Always true — the metrics + thresholds are illustrative synthetics. */
  synthetic: true;
  /** Rule-based, templated summary note (never a live-model narrative). */
  note: string;
};

/** The rule ids an escalation can cite. */
export const RULE_RED_FLAG = "rule.red-flag-threshold";
export const RULE_WORSENING_TREND = "rule.worsening-trend";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Does the value cross the red-flag threshold in the worsening direction? */
function crossesRedFlag(metric: MonitoredMetric, value: number): boolean {
  return metric.redFlag.comparator === ">="
    ? value >= metric.redFlag.value
    : value <= metric.redFlag.value;
}

/**
 * Classify a single metric's trend over its readings. DETERMINISTIC: sorts by
 * the readings' own timestamps, splits into a baseline (earlier) window and a
 * recent (later) window, compares the window means against the metric's stable
 * band, and applies the red-flag threshold to the most-recent value. A pure
 * function of the readings (no randomness, no clock). Off-catalog metrics fall
 * back to a neutral label/unit but still classify.
 */
export function detectMetricTrend(
  metricId: string,
  readings: MonitoringReading[]
): MetricTrend {
  const metric = getMonitoredMetric(metricId);
  const label = metric?.label ?? metricId;
  const unit = metric?.unit ?? "";
  const worseDirection = metric?.worseDirection ?? "up";
  const stableBand = metric?.stableBand ?? 0;

  // Sort chronologically by the explicit timestamp (ISO sorts lexically).
  const sorted = [...readings].sort((a, b) => a.at.localeCompare(b.at));
  const values = sorted.map((r) => r.value);
  const n = sorted.length;
  const latest = sorted[n - 1];
  const latestValue = latest?.value ?? 0;
  const latestAt = latest?.at ?? "";

  const redFlag = metric ? crossesRedFlag(metric, latestValue) : false;

  if (n < 2) {
    // Insufficient history to trend — stable by construction.
    return {
      metricId,
      metricLabel: label,
      unit,
      trend: "stable",
      baselineMean: round2(latestValue),
      recentMean: round2(latestValue),
      delta: 0,
      latestValue,
      latestAt,
      readingsCount: n,
      redFlag,
      rationale: `insufficient history for ${label.toLowerCase()} (${n} reading${
        n === 1 ? "" : "s"
      }) — treated as stable`
    };
  }

  const baseline = values.slice(0, Math.floor(n / 2));
  const recent = values.slice(Math.ceil(n / 2));
  const baselineMean = round2(mean(baseline));
  const recentMean = round2(mean(recent));
  const delta = round2(recentMean - baselineMean);

  // Positive when change moves in the WORSENING direction.
  const worseningDelta = worseDirection === "up" ? delta : -delta;

  let trend: MetricTrendKind;
  if (Math.abs(delta) < stableBand) {
    trend = "stable";
  } else if (worseningDelta > 0) {
    trend = "worsening";
  } else {
    trend = "improving";
  }

  const dir = delta >= 0 ? "up" : "down";
  const rationale = redFlag
    ? `${label.toLowerCase()} latest ${latestValue}${unit} crosses the red-flag threshold (${metric?.redFlag.comparator} ${metric?.redFlag.value}${unit})`
    : `${label.toLowerCase()} ${trend} (baseline ${baselineMean}${unit} → recent ${recentMean}${unit}, ${dir} ${Math.abs(
        delta
      )}${unit} vs stable band ${stableBand}${unit})`;

  return {
    metricId,
    metricLabel: label,
    unit,
    trend,
    baselineMean,
    recentMean,
    delta,
    latestValue,
    latestAt,
    readingsCount: n,
    redFlag,
    rationale
  };
}

/** Group readings by their metricId, preserving insertion order of first sight. */
function groupByMetric(
  readings: MonitoringReading[]
): Array<{ metricId: string; readings: MonitoringReading[] }> {
  const order: string[] = [];
  const byId = new Map<string, MonitoringReading[]>();
  for (const r of readings) {
    if (!byId.has(r.metricId)) {
      byId.set(r.metricId, []);
      order.push(r.metricId);
    }
    byId.get(r.metricId)!.push(r);
  }
  return order.map((metricId) => ({ metricId, readings: byId.get(metricId)! }));
}

/**
 * Build the clinician-routed escalations for a set of per-metric trends. A
 * red-flag metric escalates as `urgent` (rule.red-flag-threshold); a worsening
 * metric escalates as `elevated` (rule.worsening-trend). Every escalation is
 * routedTo 'clinician-review' — the agent NEVER acts autonomously.
 */
export function buildEscalations(trends: MetricTrend[]): MonitoringEscalation[] {
  const escalations: MonitoringEscalation[] = [];
  for (const t of trends) {
    if (t.redFlag) {
      escalations.push({
        metricId: t.metricId,
        metricLabel: t.metricLabel,
        triggeringRule: RULE_RED_FLAG,
        ruleDescription: `${t.metricLabel} crossed its red-flag threshold on the most recent reading`,
        severity: "urgent",
        routedTo: "clinician-review",
        rationale: t.rationale
      });
    } else if (t.trend === "worsening") {
      escalations.push({
        metricId: t.metricId,
        metricLabel: t.metricLabel,
        triggeringRule: RULE_WORSENING_TREND,
        ruleDescription: `${t.metricLabel} showed a worsening trend across the reading window`,
        severity: "elevated",
        routedTo: "clinician-review",
        rationale: t.rationale
      });
    }
  }
  return escalations;
}

/**
 * Assess a longitudinal reading set. DETERMINISTIC: groups readings by metric,
 * classifies each metric's trend over its window, and routes every worsening /
 * red-flag trend to a clinician for review. A pure function of the readings (no
 * randomness, no clock). Only catalog metrics are classified; an off-catalog
 * metricId is ignored here (integrity is enforced separately at the boundary via
 * readingsTraceToSource + the catalog).
 */
export function assessMonitoring(
  readings: MonitoringReading[]
): MonitoringAssessment {
  const groups = groupByMetric(readings).filter((g) => isCatalogMetric(g.metricId));
  const perMetricTrends = groups.map((g) => detectMetricTrend(g.metricId, g.readings));
  const escalations = buildEscalations(perMetricTrends);

  let overallStatus: OverallStatus;
  if (escalations.length > 0) {
    overallStatus = "escalate";
  } else if (perMetricTrends.some((t) => t.trend === "improving")) {
    overallStatus = "improving";
  } else {
    overallStatus = "stable";
  }

  const worsening = escalations.filter((e) => e.severity === "elevated").length;
  const urgent = escalations.filter((e) => e.severity === "urgent").length;
  const note =
    `Monitored ${perMetricTrends.length} metric${
      perMetricTrends.length === 1 ? "" : "s"
    } over the reading window; ${escalations.length} escalation${
      escalations.length === 1 ? "" : "s"
    } routed to clinician review` +
    (escalations.length > 0 ? ` (${urgent} red-flag, ${worsening} worsening)` : "") +
    ". Synthetic/illustrative thresholds — not a certified remote-monitoring device; no autonomous clinical action is taken.";

  return {
    perMetricTrends,
    escalations,
    overallStatus,
    synthetic: true,
    note
  };
}

/**
 * Integrity check: does EVERY reading trace to a recognized device/self-report
 * source AND a defined catalog metric? True for a well-formed reading set; the
 * guard that catches a caller-asserted, fabricated reading (missing / off-list
 * source, or an off-catalog metric). This is the honest signal the route reports
 * to policy.rpm.reading-source-integrity.
 */
export function readingsTraceToSource(
  readings: Array<Pick<MonitoringReading, "metricId" | "source">> | null | undefined
): boolean {
  if (!Array.isArray(readings)) return false;
  return readings.every(
    (r) => isValidReadingSource(r.source) && isCatalogMetric(r.metricId)
  );
}

/**
 * Honesty check: are ALL escalations routed to a human clinician (never acted on
 * autonomously)? True for anything buildEscalations()/assessMonitoring()
 * produces; the guard that catches a caller-asserted autonomous escalation
 * (routedTo anything other than 'clinician-review'). This is the honest signal
 * the route reports to policy.rpm.no-autonomous-escalation. An empty set is
 * vacuously true (nothing was escalated autonomously).
 */
export function escalationsRouteToHuman(
  escalations: Array<Pick<MonitoringEscalation, "routedTo">> | null | undefined
): boolean {
  if (!Array.isArray(escalations)) return false;
  return escalations.every((e) => e.routedTo === "clinician-review");
}

/**
 * A representative, deterministic demo reading set (illustrative). Uses explicit
 * timestamps so it is independent of any clock: hot-flash frequency worsening
 * (up), sleep declining (down → worsening), mood improving (up), and resting HR
 * stable — a representative mix across metrics + sources.
 */
export const DEMO_MONITORING_READINGS: MonitoringReading[] = [
  // Hot-flash frequency climbing 6 → 12/day (worsening; up).
  { metricId: "metric.hot-flash-frequency", at: "2026-01-05", value: 6, source: "self-report" },
  { metricId: "metric.hot-flash-frequency", at: "2026-01-12", value: 7, source: "self-report" },
  { metricId: "metric.hot-flash-frequency", at: "2026-01-19", value: 10, source: "self-report" },
  { metricId: "metric.hot-flash-frequency", at: "2026-01-26", value: 12, source: "self-report" },
  // Sleep declining 7 → 5 hrs (worsening; down).
  { metricId: "metric.sleep-hours", at: "2026-01-05", value: 7, source: "wearable" },
  { metricId: "metric.sleep-hours", at: "2026-01-12", value: 6.5, source: "wearable" },
  { metricId: "metric.sleep-hours", at: "2026-01-19", value: 5.5, source: "wearable" },
  { metricId: "metric.sleep-hours", at: "2026-01-26", value: 5, source: "wearable" },
  // Mood improving 4 → 7 (improving; up).
  { metricId: "metric.mood-score", at: "2026-01-05", value: 4, source: "self-report" },
  { metricId: "metric.mood-score", at: "2026-01-12", value: 5, source: "self-report" },
  { metricId: "metric.mood-score", at: "2026-01-19", value: 6, source: "self-report" },
  { metricId: "metric.mood-score", at: "2026-01-26", value: 7, source: "self-report" },
  // Resting HR essentially flat 68 → 70 (stable).
  { metricId: "metric.resting-heart-rate", at: "2026-01-05", value: 68, source: "wearable" },
  { metricId: "metric.resting-heart-rate", at: "2026-01-12", value: 69, source: "wearable" },
  { metricId: "metric.resting-heart-rate", at: "2026-01-19", value: 70, source: "wearable" },
  { metricId: "metric.resting-heart-rate", at: "2026-01-26", value: 70, source: "wearable" }
];
