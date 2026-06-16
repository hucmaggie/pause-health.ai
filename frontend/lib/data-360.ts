/**
 * Salesforce Data 360 mock.
 *
 * What Data 360 (formerly Data Cloud) provides in production:
 *
 *   1. Zero-copy data federation -- query data where it lives
 *      (Snowflake, Databricks, BigQuery, Redshift, JupyterHealth FHIR
 *      store) via the Data Federation + Iceberg connectors. No
 *      ingestion required.
 *   2. Unified data model -- Customer 360 schema with healthcare
 *      extensions aligned to FHIR R5 (Patient, Encounter, Observation,
 *      Care Plan).
 *   3. Calculated Insights + Streaming Insights -- materialized
 *      features computed across federated sources (e.g. 30-day HRV
 *      z-score, menopause symptom burden index).
 *   4. Identity Resolution -- clinical-grade patient matching across
 *      EHR, wearable, intake, and claims sources.
 *   5. Segments -- population builder that powers Agentforce
 *      grounding, Marketing Cloud activation, and Health Cloud
 *      timeline cards.
 *   6. Activation -- pushes segments and feature signals into
 *      Agentforce, MuleSoft, and the Agent Fabric.
 *
 * What this module mocks:
 *
 *   - getGroundingContext(patientId): the bundle the Care Router
 *     receives before deciding. Calculated insights + recent
 *     longitudinal observations + last care plan + cohort comparison.
 *   - getFederatedRecord(patientId): the full unified record (what
 *     Patient 360 in Salesforce would render).
 *   - resolveIdentity(input): identity resolution stub.
 *   - listSegments(): the population segments that drive activation.
 *
 * Real customer deployments swap this module's functions for calls
 * into the Salesforce Data 360 Federated Query API and the Calculated
 * Insights API. The shapes returned here match what those APIs return
 * for an equivalent menopause-cohort schema.
 */

export const DEMO_DATA360_PATIENT_ID = "pause-demo-patient-001";

export type FederatedSource =
  | "salesforce-data-360-native"
  | "jupyterhealth-fhir"
  | "dbdp-wearable-features"
  | "agentforce-intake-history"
  | "epic-health-cloud"
  | "mocked-payer-claims";

/**
 * Stable, source-independent classifier for a Calculated Insight. The `id`
 * carries provenance detail and DIFFERS between the mock and the live Data
 * Cloud path (e.g. the HRV insight is `insight.hrv-zscore-30d` in the mock but
 * `insight.hrv-rmssd-30d` live; last-contact is `…-mscp-contact` mock vs
 * `…-last-clinical-contact` live). Anything that branches on an insight — the
 * Care Router rationale especially — MUST key on `kind`, never the `id`, or it
 * silently stops firing the moment the org flips from mock to live.
 */
export type InsightKind =
  | "hrv-variability"
  | "vasomotor-burden"
  | "sleep-disruption"
  | "days-since-clinical-contact"
  | "care-program-enrollment"
  | "care-plan-status";

export type CalculatedInsight = {
  id: string;
  name: string;
  description: string;
  value: number | string;
  unit?: string;
  computedAt: string;
  sourceWindow: string;
  /** Which federated sources contributed. */
  federatedFrom: FederatedSource[];
  /**
   * Source-independent classifier — see InsightKind. Optional only so older
   * callers/fixtures still type-check; the mock and the live builder both set
   * it, and the Care Router matches on it (falling back to id-aliases for
   * fixtures that predate the field).
   */
  kind?: InsightKind;
};

export type LongitudinalObservation = {
  id: string;
  loinc: string;
  display: string;
  effectiveDate: string;
  value: number;
  unit: string;
  trend?: "improving" | "stable" | "worsening";
  source: FederatedSource;
};

export type CohortComparison = {
  cohortName: string;
  cohortSize: number;
  patientPercentile: number;
  metric: string;
  pathwayOutcomes: Array<{
    pathway: string;
    n: number;
    resolutionRate: number;
  }>;
};

export type GroundingContext = {
  unifiedPatientId: string;
  identityResolution: {
    confidence: number;
    matchedSources: FederatedSource[];
    resolutionRuleset: string;
  };
  calculatedInsights: CalculatedInsight[];
  longitudinalObservations: LongitudinalObservation[];
  recentIntakeCount: number;
  lastClinicianContact: { daysAgo: number; clinicianType: string };
  cohortComparison: CohortComparison;
  groundingProvenance: {
    federatedQuery: string;
    durationMs: number;
    sourcesQueried: FederatedSource[];
    computedInsightsCount: number;
  };
};

export type Segment = {
  id: string;
  name: string;
  description: string;
  patientCount: number;
  updatedAt: string;
  criteria: string;
  activatedTo: Array<"agentforce" | "agent-fabric" | "health-cloud" | "marketing-cloud">;
};

const SEGMENTS: Segment[] = [
  {
    id: "seg.late-perimenopause.rising-hrv-variability",
    name: "Late perimenopause · rising HRV variability",
    description:
      "Patients age 45–55 with cycle status irregular or stopped <12 months and a 30-day HRV variability z-score > 1.2.",
    patientCount: 412,
    updatedAt: "2026-05-25T22:00:00Z",
    criteria:
      "ageBand IN ('40-45','46-50','51-55') AND cycleStatus IN ('irregular','stopped<12mo') AND hrv_variability_30d_zscore > 1.2",
    activatedTo: ["agentforce", "agent-fabric"]
  },
  {
    id: "seg.vasomotor-burden.no-mscp-12mo",
    name: "High vasomotor burden · no MSCP contact in 12 months",
    description:
      "Patients with vasomotor burden index > 60 (DBDP-computed) and no MSCP-credentialed clinician contact in the last 365 days.",
    patientCount: 217,
    updatedAt: "2026-05-25T22:00:00Z",
    criteria:
      "vasomotor_burden_index_30d > 60 AND days_since_mscp_contact > 365",
    activatedTo: ["agentforce", "agent-fabric", "health-cloud"]
  },
  {
    id: "seg.poi-suspect.under-40",
    name: "POI rule-out · under-40 with menopause-pattern symptoms",
    description:
      "Patients under 40 with cycle status irregular and any vasomotor or vaginal symptom captured at intake. Routes via the POI rule.",
    patientCount: 38,
    updatedAt: "2026-05-25T22:00:00Z",
    criteria:
      "ageBand = '<40' AND cycleStatus = 'irregular' AND primarySymptom IN ('hot_flashes','gsm','sleep')",
    activatedTo: ["agentforce", "agent-fabric"]
  },
  {
    id: "seg.bleeding-postmenopausal.urgent-followup",
    name: "Postmenopausal bleeding · urgent follow-up cohort",
    description:
      "Patients who reported unexpected bleeding at intake while in stopped>=12mo cycle status. Auto-flagged for 24h gynecology review.",
    patientCount: 24,
    updatedAt: "2026-05-25T22:00:00Z",
    criteria:
      "primarySymptom = 'bleeding' AND cycleStatus = 'stopped>=12mo'",
    activatedTo: ["agentforce", "agent-fabric", "health-cloud"]
  }
];

const TYPICAL_AGE_BANDS = new Set([
  "40-45",
  "46-50",
  "51-55",
  "56-60",
  ">60"
]);

function pickCohortName(ageBand?: string, primarySymptom?: string): string {
  const band = ageBand && TYPICAL_AGE_BANDS.has(ageBand) ? ageBand : "46-50";
  const sym = primarySymptom ?? "hot_flashes";
  return `Cohort: ${band} · primary ${sym}`;
}

/**
 * Returns the grounding context the Care Router consumes before
 * deciding. Deterministic but parameterized off the patient id so
 * different demo patients produce different (and clinically
 * appropriate) signals.
 */
export function getGroundingContext(args: {
  patientId: string;
  hint?: { ageBand?: string; primarySymptom?: string; cycleStatus?: string };
}): GroundingContext {
  const t0 = Date.now();
  const ageBand = args.hint?.ageBand;
  const primary = args.hint?.primarySymptom;

  const insights: CalculatedInsight[] = [
    {
      id: "insight.hrv-zscore-30d",
      kind: "hrv-variability",
      name: "30-day HRV variability z-score",
      description:
        "Patient's HRV variability relative to her own 90-day baseline, recomputed nightly from DBDP-derived RMSSD windows.",
      value: 1.42,
      unit: "z-score",
      computedAt: new Date(t0 - 1000 * 60 * 60 * 6).toISOString(),
      sourceWindow: "last-30-days",
      federatedFrom: ["dbdp-wearable-features", "jupyterhealth-fhir"]
    },
    {
      id: "insight.vasomotor-burden-30d",
      kind: "vasomotor-burden",
      name: "Vasomotor symptom burden (30-day)",
      description:
        "Composite of intake reports, wearable thermoregulation signals, and sleep disruption. Scored 0-100.",
      value: 62,
      unit: "score",
      computedAt: new Date(t0 - 1000 * 60 * 60 * 6).toISOString(),
      sourceWindow: "last-30-days",
      federatedFrom: [
        "dbdp-wearable-features",
        "agentforce-intake-history",
        "jupyterhealth-fhir"
      ]
    },
    {
      id: "insight.sleep-disruption-7d",
      kind: "sleep-disruption",
      name: "Sleep disruption index (7-day)",
      description:
        "Fraction of nights with disrupted sleep (>2 awakenings >5 min, sleep efficiency <80%).",
      value: 0.57,
      unit: "fraction",
      computedAt: new Date(t0 - 1000 * 60 * 60 * 6).toISOString(),
      sourceWindow: "last-7-days",
      federatedFrom: ["dbdp-wearable-features"]
    },
    {
      id: "insight.days-since-mscp-contact",
      kind: "days-since-clinical-contact",
      name: "Days since last MSCP-credentialed clinician contact",
      description:
        "Time since the patient last had a documented encounter with an MSCP-credentialed clinician (across all federated EHR sources).",
      value: 412,
      unit: "days",
      computedAt: new Date(t0 - 1000 * 60 * 60 * 12).toISOString(),
      sourceWindow: "all-time",
      federatedFrom: ["jupyterhealth-fhir", "epic-health-cloud"]
    }
  ];

  const longitudinal: LongitudinalObservation[] = [
    {
      id: "obs.hrv.30d.avg",
      loinc: "8889-8",
      display: "Heart rate variability — 30-day average RMSSD",
      effectiveDate: new Date(t0 - 1000 * 60 * 60 * 24 * 30).toISOString(),
      value: 22.8,
      unit: "ms",
      trend: "worsening",
      source: "dbdp-wearable-features"
    },
    {
      id: "obs.hrv.7d.avg",
      loinc: "8889-8",
      display: "Heart rate variability — 7-day average RMSSD",
      effectiveDate: new Date(t0 - 1000 * 60 * 60 * 24 * 7).toISOString(),
      value: 18.9,
      unit: "ms",
      trend: "worsening",
      source: "dbdp-wearable-features"
    },
    {
      id: "obs.sleep-duration.7d.avg",
      loinc: "93832-4",
      display: "Sleep duration — 7-day average",
      effectiveDate: new Date(t0 - 1000 * 60 * 60 * 24 * 7).toISOString(),
      value: 6.1,
      unit: "h",
      trend: "stable",
      source: "dbdp-wearable-features"
    },
    {
      id: "obs.hot-flashes.30d.count",
      loinc: "urn:pause:vasomotor-events",
      display: "Self-reported vasomotor events (30-day count)",
      effectiveDate: new Date(t0 - 1000 * 60 * 60 * 24 * 1).toISOString(),
      value: 124,
      unit: "events",
      trend: "worsening",
      source: "agentforce-intake-history"
    }
  ];

  const cohort: CohortComparison = {
    cohortName: pickCohortName(ageBand, primary),
    cohortSize: 3142,
    patientPercentile: 78,
    metric: "vasomotor symptom burden",
    pathwayOutcomes: [
      { pathway: "mscp-virtual-visit", n: 1840, resolutionRate: 0.71 },
      { pathway: "mscp-in-person", n: 612, resolutionRate: 0.78 },
      { pathway: "self-care-tracking", n: 690, resolutionRate: 0.34 }
    ]
  };

  const finishedAt = Date.now();

  return {
    unifiedPatientId: args.patientId,
    identityResolution: {
      confidence: 0.97,
      matchedSources: [
        "agentforce-intake-history",
        "jupyterhealth-fhir",
        "dbdp-wearable-features",
        "epic-health-cloud"
      ],
      resolutionRuleset: "pause-menopause-cohort-IR-v3"
    },
    calculatedInsights: insights,
    longitudinalObservations: longitudinal,
    recentIntakeCount: 3,
    lastClinicianContact: { daysAgo: 412, clinicianType: "primary-care" },
    cohortComparison: cohort,
    groundingProvenance: {
      federatedQuery:
        "SELECT * FROM data360.patient_grounding_view WHERE unified_patient_id = :id",
      durationMs: finishedAt - t0,
      sourcesQueried: [
        "salesforce-data-360-native",
        "jupyterhealth-fhir",
        "dbdp-wearable-features",
        "agentforce-intake-history",
        "epic-health-cloud"
      ],
      computedInsightsCount: insights.length
    }
  };
}

/**
 * Full federated patient record (what /demo/patient would render
 * in L3 scope). Returns a superset of GroundingContext plus enough
 * shape for the JSON viewer linked from the Agent Fabric console.
 */
export function getFederatedRecord(patientId: string) {
  const grounding = getGroundingContext({ patientId });
  return {
    unifiedPatientId: patientId,
    profile: {
      ageBand: "46-50",
      menopauseStage: "late-perimenopause",
      preferredLanguage: "en-US",
      timezone: "America/Los_Angeles"
    },
    identityResolution: grounding.identityResolution,
    insights: grounding.calculatedInsights,
    longitudinal: grounding.longitudinalObservations,
    cohortComparison: grounding.cohortComparison,
    consents: [
      {
        scope: "wearable-ingest",
        granted: true,
        signedAt: "2026-04-12T17:21:00Z"
      },
      {
        scope: "ai-decision-support",
        granted: true,
        signedAt: "2026-04-12T17:21:00Z"
      }
    ],
    activeSegments: SEGMENTS.filter((s) =>
      [
        "seg.late-perimenopause.rising-hrv-variability",
        "seg.vasomotor-burden.no-mscp-12mo"
      ].includes(s.id)
    ).map((s) => ({ id: s.id, name: s.name }))
  };
}

/**
 * Identity Resolution stub. In production Data 360 IR runs a
 * configurable ruleset across federated sources to map heterogeneous
 * identifiers to a unified patient id. The prototype just echoes the
 * demo id with a high-confidence resolution provenance block.
 */
export function resolveIdentity(input: {
  preferredName?: string;
  ageBand?: string;
  cycleStatus?: string;
  externalIds?: Record<string, string>;
}): {
  unifiedPatientId: string;
  confidence: number;
  matchedSources: FederatedSource[];
  resolutionRuleset: string;
  echo: typeof input;
} {
  return {
    unifiedPatientId: DEMO_DATA360_PATIENT_ID,
    confidence: 0.97,
    matchedSources: [
      "agentforce-intake-history",
      "jupyterhealth-fhir",
      "dbdp-wearable-features",
      "epic-health-cloud"
    ],
    resolutionRuleset: "pause-menopause-cohort-IR-v3",
    echo: input
  };
}

export function listSegments(): Segment[] {
  return SEGMENTS.slice();
}
