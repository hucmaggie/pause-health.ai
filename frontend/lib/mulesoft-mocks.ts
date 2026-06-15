/**
 * Shared fixtures for the mocked Pause-Health.ai Experience APIs.
 *
 * In production these payloads are served by MuleSoft Process / Experience
 * APIs running on the customer's Anypoint Runtime Fabric or CloudHub 2.0.
 * Here they are deterministic mocks so prospects, partners, MCP clients,
 * and reviewers can `curl` real-shape responses without any deployment.
 *
 * Keep these fixtures dependency-free and pure JSON-serializable.
 */

import generatedProviderDirectory from "./provider-directory.generated.json";
import generatedProviderDirectoryMeta from "./provider-directory.generated.meta.json";

export const DEMO_PATIENT_ID = "pause-demo-patient-001";
const RAW_HRV_ID = "obs-hrv-raw-001";

export function buildPatientTimelineBundle(patientId: string = DEMO_PATIENT_ID) {
  return {
    resourceType: "Bundle",
    type: "searchset",
    meta: {
      lastUpdated: "2026-05-25T18:00:00Z",
      source: "urn:pause-health:mulesoft:pause-patient-bundle-process-api"
    },
    entry: [
      {
        fullUrl: `urn:uuid:${patientId}`,
        resource: {
          resourceType: "Patient",
          id: patientId,
          meta: { profile: ["http://hl7.org/fhir/StructureDefinition/Patient"] },
          identifier: [
            { system: "urn:pause-health:demo-cohort", value: patientId }
          ],
          active: true,
          gender: "female",
          birthDate: "1974-08-12",
          extension: [
            {
              url: "urn:pause-health:extension:menopause-stage",
              valueString: "late-perimenopause"
            }
          ]
        }
      },
      {
        fullUrl: "urn:uuid:obs-heart-rate-001",
        resource: {
          resourceType: "Observation",
          id: "obs-heart-rate-001",
          status: "final",
          category: [
            {
              coding: [
                {
                  system:
                    "http://terminology.hl7.org/CodeSystem/observation-category",
                  code: "vital-signs",
                  display: "Vital Signs"
                }
              ]
            }
          ],
          code: {
            coding: [
              {
                system: "http://loinc.org",
                code: "8867-4",
                display: "Heart rate"
              }
            ]
          },
          subject: { reference: `Patient/${patientId}` },
          effectiveDateTime: "2026-05-25T07:30:00Z",
          valueQuantity: {
            value: 72,
            unit: "/min",
            system: "http://unitsofmeasure.org",
            code: "/min"
          },
          device: { display: "Oura Ring Gen3" },
          extension: [
            {
              url: "urn:pause-health:extension:mulesoft-pipeline-version",
              valueString: "pause-ingest-process-api@1.0"
            }
          ]
        }
      },
      {
        fullUrl: "urn:uuid:obs-sleep-duration-001",
        resource: {
          resourceType: "Observation",
          id: "obs-sleep-duration-001",
          status: "final",
          category: [
            {
              coding: [
                {
                  system:
                    "http://terminology.hl7.org/CodeSystem/observation-category",
                  code: "activity",
                  display: "Activity"
                }
              ]
            }
          ],
          code: {
            coding: [
              {
                system: "http://loinc.org",
                code: "93832-4",
                display: "Sleep duration"
              }
            ]
          },
          subject: { reference: `Patient/${patientId}` },
          effectivePeriod: {
            start: "2026-05-24T23:14:00Z",
            end: "2026-05-25T06:42:00Z"
          },
          valueQuantity: {
            value: 6.5,
            unit: "h",
            system: "http://unitsofmeasure.org",
            code: "h"
          },
          device: { display: "Oura Ring Gen3" }
        }
      },
      {
        fullUrl: `urn:uuid:${RAW_HRV_ID}`,
        resource: {
          resourceType: "Observation",
          id: RAW_HRV_ID,
          status: "final",
          category: [
            {
              coding: [
                {
                  system:
                    "http://terminology.hl7.org/CodeSystem/observation-category",
                  code: "vital-signs",
                  display: "Vital Signs"
                }
              ]
            }
          ],
          code: {
            coding: [
              {
                system: "http://loinc.org",
                code: "80404-7",
                display: "R-R interval by EKG"
              }
            ]
          },
          subject: { reference: `Patient/${patientId}` },
          effectivePeriod: {
            start: "2026-05-25T02:00:00Z",
            end: "2026-05-25T02:03:00Z"
          },
          component: Array.from({ length: 6 }, (_, idx) => ({
            code: { text: `RR interval ${idx + 1}` },
            valueQuantity: {
              value: [812, 798, 825, 841, 833, 820][idx],
              unit: "ms",
              system: "http://unitsofmeasure.org",
              code: "ms"
            }
          })),
          device: { display: "Oura Ring Gen3" }
        }
      },
      {
        fullUrl: "urn:uuid:obs-feature-rmssd-001",
        resource: {
          resourceType: "Observation",
          id: "obs-feature-rmssd-001",
          status: "final",
          category: [
            {
              coding: [
                {
                  system:
                    "http://terminology.hl7.org/CodeSystem/observation-category",
                  code: "survey",
                  display: "Survey"
                }
              ]
            }
          ],
          code: {
            coding: [
              {
                system: "urn:pause-health:code:dbdp-features",
                code: "hrv_rmssd_sliding_180s",
                display: "HRV RMSSD (sliding 180s window, DBDP/FLIRT)"
              }
            ],
            text: "Sliding-window RMSSD"
          },
          subject: { reference: `Patient/${patientId}` },
          effectivePeriod: {
            start: "2026-05-25T02:00:00Z",
            end: "2026-05-25T02:03:00Z"
          },
          valueQuantity: {
            value: 18.4,
            unit: "ms",
            system: "http://unitsofmeasure.org",
            code: "ms"
          },
          derivedFrom: [{ reference: `Observation/${RAW_HRV_ID}` }],
          extension: [
            {
              url: "urn:pause-health:extension:feature-source",
              valueString: "pause_ingest.features.hrv_features_flirt"
            },
            {
              url: "urn:pause-health:extension:mulesoft-pipeline-version",
              valueString: "pause-ingest-process-api@1.0"
            }
          ]
        }
      }
    ]
  };
}

/**
 * Structured intake record produced by the Salesforce Agentforce Service
 * Agent (or the local fallback) and persisted by the MuleSoft Process API
 * `pause-intake-process-api`. The shape is intentionally flat and
 * boring -- this is what a downstream EHR or clinician dashboard
 * consumes, not a raw chat transcript.
 */
export function buildPatientIntakeRecord(patientId: string = DEMO_PATIENT_ID) {
  return {
    patientId,
    capturedAt: "2026-05-25T17:42:00Z",
    capturedBy: {
      channel: "agentforce-service-agent",
      agentVersion: "pause-intake-agent@2.1",
      operator: "self-service"
    },
    chiefComplaint:
      "Frequent night-time hot flashes (4-6 per night) and persistent sleep disruption for ~5 months.",
    symptoms: [
      { code: "vasomotor.hot_flashes", severity: 7, frequencyPerWeek: 35 },
      { code: "sleep.disruption", severity: 8, frequencyPerWeek: 28 },
      { code: "mood.irritability", severity: 5, frequencyPerWeek: 14 },
      { code: "cognitive.brain_fog", severity: 4, frequencyPerWeek: 10 }
    ],
    menopauseStage: "late-perimenopause",
    lastMenstrualPeriod: "2025-11-02",
    redFlagScreen: {
      postmenopausalBleeding: false,
      severeChestPain: false,
      newNeurologicalDeficit: false,
      suicidalIdeation: false,
      passed: true
    },
    currentMedications: [
      { name: "Vitamin D3", dose: "2000 IU", route: "oral", daily: true }
    ],
    allergies: [],
    triageRecommendation: {
      acuity: "routine",
      suggestedSpecialty: "menopause-certified-practitioner",
      rationale:
        "Symptom cluster consistent with vasomotor menopause phenotype; no red-flag findings; HRV biomarker drift confirmed via wearable feed."
    },
    provenance: {
      processApi: "pause-intake-process-api@1.3",
      experienceApi: "pause-clinical-experience-api@1.0",
      hipaaAuditId: "audit-2026-05-25-17-42-001"
    }
  };
}

/**
 * Slice of the provider graph (Path B from /proposal/menopause-society):
 * a future defensible directory of menopause-experienced clinicians
 * synthesized from CMS NPPES, state board registries, and the MSCP
 * credential list. Today this is hand-curated synthetic data so the
 * shape and filtering UX are real, even though the directory is not.
 *
 * Filters honored: zip (3-digit prefix match), menopauseOnly (boolean).
 */
export type ProviderRecord = {
  npi: string;
  name: string;
  credentials: string[];
  specialty: string;
  menopauseCertified: boolean;
  city: string;
  state: string;
  zip: string;
  acceptingNewPatients: boolean;
  telehealth: boolean;
  graphScore: number;
  /**
   * Centroid of the practice ZIP, from the Census 2020 ZCTA gazetteer
   * (see provider_ingest/centroids.py). Both null when the ZIP has no ZCTA
   * centroid (rare: PO-box-only / very new ZIPs); the directory then
   * falls back to score-only ranking for that provider.
   */
  latitude?: number | null;
  longitude?: number | null;
  /**
   * Public-registry service-line signals — small set of tokens detected in
   * NPPES data that suggest a non-certified provider actually delivers
   * menopause care. Examples: "facog" (board-certified OB/GYN), "whnp"
   * (Women's Health Nurse Practitioner), "multi-taxonomy" (≥2 menopause-
   * relevant NUCC codes). Empty array when nothing matched. See
   * provider_ingest/signals.py for the full list.
   */
  serviceSignals?: string[];
  /**
   * Disposition against the published state sanction overlays. Survivors of
   * the build always carry "active" — sanctioned providers are filtered out
   * at build time so the directory never recommends one. The field is here
   * so the contract documents what was checked (today: CA Medi-Cal S&I
   * list); future values like "probation" can land additively.
   */
  licenseStatus?: "active" | "suspended" | "probation";
  /**
   * Plans the provider accepts. Today **derived synthetically per-NPI** by
   * `provider_ingest/insurance.py` (no public payer feed exists); the
   * shape — and therefore the API contract, the filter UX, and the agent
   * framing — is real, and a paid data partnership can replace the
   * derivation later without changes downstream. The full set: medicare,
   * medicaid, aetna, bcbs, uhc, cigna, humana, kaiser. Always non-empty
   * (Medicare is the conservative floor); listed in canonical order so
   * consumers can render without sorting.
   */
  insuranceAccepted?: string[];
};

/** Returned by queryProviderDirectory when the patient's ZIP centroid is known. */
export type ProviderRecordRanked = ProviderRecord & {
  /** Great-circle distance from the patient's ZIP to the practice ZIP, in miles. */
  distanceMiles?: number | null;
};

/**
 * Hand-curated fallback slice. Retained so the directory still answers if the
 * generated dataset is ever empty/missing. The live directory is the
 * NPPES-derived `provider-directory.generated.json` (see PROVIDER_DIRECTORY
 * below), produced by the `provider_ingest` pipeline.
 */
const FALLBACK_DIRECTORY: ProviderRecord[] = [
  {
    npi: "1730155570",
    name: "Dr. Priya Anand, MD, MSCP",
    credentials: ["MD", "MSCP", "FACOG"],
    specialty: "Obstetrics & Gynecology",
    menopauseCertified: true,
    city: "Irvine",
    state: "CA",
    zip: "92614",
    acceptingNewPatients: true,
    telehealth: true,
    graphScore: 0.94
  },
  {
    npi: "1457390021",
    name: "Dr. Helen Okafor, DO, MSCP",
    credentials: ["DO", "MSCP"],
    specialty: "Internal Medicine — Women's Health",
    menopauseCertified: true,
    city: "Newport Beach",
    state: "CA",
    zip: "92660",
    acceptingNewPatients: true,
    telehealth: true,
    graphScore: 0.91
  },
  {
    npi: "1881903422",
    name: "Dr. Marisol Reyes, MD",
    credentials: ["MD", "FACOG"],
    specialty: "Obstetrics & Gynecology",
    menopauseCertified: false,
    city: "Santa Ana",
    state: "CA",
    zip: "92705",
    acceptingNewPatients: false,
    telehealth: false,
    graphScore: 0.71
  },
  {
    npi: "1306188891",
    name: "Dr. Aileen Chen, NP, MSCP",
    credentials: ["NP", "MSCP"],
    specialty: "Family Medicine — Midlife Health",
    menopauseCertified: true,
    city: "Brooklyn",
    state: "NY",
    zip: "11215",
    acceptingNewPatients: true,
    telehealth: true,
    graphScore: 0.89
  },
  {
    npi: "1922450088",
    name: "Dr. Samuel Levin, MD, MSCP",
    credentials: ["MD", "MSCP"],
    specialty: "Endocrinology",
    menopauseCertified: true,
    city: "Manhattan",
    state: "NY",
    zip: "10024",
    acceptingNewPatients: false,
    telehealth: true,
    graphScore: 0.87
  }
];

/**
 * Live directory: NPPES taxonomy-filtered providers with a computed graphScore,
 * emitted by `provider_ingest` into `provider-directory.generated.json`. The
 * committed dataset is a national `npidata_pfile` run (CMS, June 2026) merged
 * with the demo fixture: every menopause-certified provider is kept — where
 * certification means a self-reported MSCP/NCMP credential in the NPPES record
 * plus a curated overlay — and the non-certified breadth is capped for bundle
 * size. Self-reported MSCP/NCMP is rare in NPPES, so real certified coverage is
 * sparse (the Menopause Society feed remains the path to dense coverage); the
 * non-certified rows give the directory national breadth for general browsing.
 */
const PROVIDER_DIRECTORY: ProviderRecord[] =
  (generatedProviderDirectory as ProviderRecord[]).length > 0
    ? (generatedProviderDirectory as ProviderRecord[])
    : FALLBACK_DIRECTORY;

const USING_GENERATED_DIRECTORY =
  (generatedProviderDirectory as ProviderRecord[]).length > 0;

/**
 * Build metadata for the generated directory — what's reported in
 * `provenance.dataset` so callers (the agent, customers reading the
 * Experience API responses) can answer "how fresh is this directory?".
 *
 * `sourceDate` is the dataset's freshness (the NPPES dissemination zip's
 * mtime); `generatedAt` is the wall-clock build time. Both are written by
 * `provider_ingest/scripts/refresh_national.sh`. When the generated file is
 * empty (sparse checkout / unbuilt dataset), we surface `null` so consumers
 * know they're on the curated fallback.
 */
type DirectoryMeta = {
  generatedAt?: string;
  sourceDate?: string | null;
  sanctionsOverlay?: string | null;
  providers?: {
    total?: number;
    certified?: number;
    states?: number;
    zip3Prefixes?: number;
    sanctionedFiltered?: number;
  };
};
const DIRECTORY_META = generatedProviderDirectoryMeta as DirectoryMeta;
const DIRECTORY_DATASET_PROVENANCE = USING_GENERATED_DIRECTORY
  ? {
      generatedAt: DIRECTORY_META.generatedAt ?? null,
      sourceDate: DIRECTORY_META.sourceDate ?? null,
      total: DIRECTORY_META.providers?.total ?? PROVIDER_DIRECTORY.length,
      certified:
        DIRECTORY_META.providers?.certified ??
        PROVIDER_DIRECTORY.filter((r) => r.menopauseCertified).length,
      states: DIRECTORY_META.providers?.states,
      zip3Prefixes: DIRECTORY_META.providers?.zip3Prefixes,
      // Counts how many candidate providers were filtered out by the
      // sanctions overlay during the most recent build. Zero is the healthy,
      // expected default — surfacing it confirms the safety filter ran.
      sanctionedFiltered: DIRECTORY_META.providers?.sanctionedFiltered ?? 0,
      sanctionsOverlayUsed: DIRECTORY_META.sanctionsOverlay ?? null
    }
  : null;

/**
 * Which tier of the search answered, so callers (and the agent) can present
 * results honestly:
 *   - `certified-local`     menopause-certified provider(s) in the ZIP-3 area.
 *   - `relevant-local`      no local certified provider, so nearby
 *                           menopause-RELEVANT but NON-certified providers
 *                           (e.g. OB/GYN) — only with `fallback`.
 *   - `certified-remote`    no local provider at all, so telehealth-capable
 *                           certified providers nationally — only with `fallback`.
 *   - `certified-national`  menopause-certified, no ZIP given.
 *   - `local` / `all`       general (non-menopause) browse, with/without ZIP.
 *   - `none`                nothing matched.
 */
export type ProviderMatchType =
  | "certified-local"
  | "relevant-local"
  | "certified-remote"
  | "certified-national"
  | "local"
  | "all"
  | "none";

export function queryProviderDirectory(opts: {
  zip?: string;
  menopauseOnly?: boolean;
  limit?: number;
  /**
   * Graceful fallback for menopause-certified searches with no certified
   * provider in the ZIP-3 area. When true and the certified-local tier is empty,
   * the directory broadens — first to nearby menopause-relevant (non-certified)
   * providers, then to telehealth-capable certified providers nationally — and
   * reports the tier via `matchType`. OFF by default so the Care Router and the
   * demo's strict certified-local invariant are preserved; the agent-facing
   * Experience API (`/api/mulesoft/providers`) opts in.
   */
  fallback?: boolean;
  /**
   * (lat, lng) of the patient's ZIP. When supplied, providers are stamped
   * with `distanceMiles` (Haversine) and sorted by distance ascending within
   * the resolved tier — graphScore descending becomes the tiebreak. Pass
   * `null` (or omit) and the directory keeps the original score-only ranking;
   * the ZIP-prefix tier ladder is unchanged either way.
   */
  zipCentroid?: { latitude: number; longitude: number } | null;
  /**
   * Filter to providers whose `insuranceAccepted` list contains this plan
   * token. Case-insensitive; common synonyms are normalized (e.g. "United"
   * → "uhc", "Blue Cross" → "bcbs") via `normalizeInsurancePlan` so the
   * filter accepts user-typed names. Applied BEFORE the tier ladder so all
   * tiers (certified-local, relevant-local, certified-remote, etc.) honor
   * it consistently. Omit (or null) to skip the filter.
   */
  insurance?: string | null;
}) {
  const { zip, menopauseOnly, limit, fallback, zipCentroid, insurance } = opts;
  const prefix = zip && zip.length >= 3 ? zip.slice(0, 3) : undefined;
  const inArea = (r: ProviderRecord) => !prefix || r.zip.startsWith(prefix);

  // Insurance filter narrows the candidate pool BEFORE the tier ladder so
  // every tier honors it (a "relevant-local Aetna provider" stays relevant-
  // local; we never silently broaden insurance just because the strict tier
  // is empty — that would defeat the patient's filter intent).
  const planQuery = normalizeInsurancePlan(insurance ?? null);
  const acceptsPlan = (r: ProviderRecord) =>
    !planQuery || (r.insuranceAccepted ?? []).includes(planQuery);
  const POOL = PROVIDER_DIRECTORY.filter(acceptsPlan);

  let rows: ProviderRecord[];
  let matchType: ProviderMatchType;

  if (!menopauseOnly) {
    rows = POOL.filter(inArea);
    matchType = prefix ? "local" : "all";
  } else {
    const certified = POOL.filter((r) => r.menopauseCertified);
    if (!prefix) {
      rows = certified;
      matchType = "certified-national";
    } else {
      const certifiedLocal = certified.filter(inArea);
      if (certifiedLocal.length > 0 || !fallback) {
        // Strict default (and the happy path): certified providers in-area.
        rows = certifiedLocal;
        matchType = "certified-local";
      } else {
        const relevantLocal = POOL.filter(
          (r) => !r.menopauseCertified && inArea(r)
        );
        if (relevantLocal.length > 0) {
          // Prefer a nearby (non-certified) menopause-relevant clinician over a
          // distant certified one — the patient can be seen locally.
          rows = relevantLocal;
          matchType = "relevant-local";
        } else {
          // Nothing local at all: offer telehealth-capable certified specialists
          // who can see the patient remotely (any certified if none do telehealth).
          const certifiedTelehealth = certified.filter((r) => r.telehealth);
          rows = certifiedTelehealth.length > 0 ? certifiedTelehealth : certified;
          matchType = "certified-remote";
        }
      }
    }
  }

  // Stamp distance when the patient ZIP centroid is known and the provider
  // has its own centroid. Anything unstamped just falls through to score-only
  // ranking — no errors, no zero-distance lies.
  const canRankByDistance =
    !!zipCentroid && rows.some((r) => r.latitude != null && r.longitude != null);
  const ranked: ProviderRecordRanked[] = canRankByDistance
    ? sortByCentroid(rows, zipCentroid!)
    : rows
        .slice()
        .sort((a, b) => b.graphScore - a.graphScore)
        .map((r) => ({ ...r, distanceMiles: null }));
  const sort: "distance" | "score" = canRankByDistance ? "distance" : "score";

  const total = ranked.length;
  const sliced = limit && limit > 0 ? ranked.slice(0, limit) : ranked;
  if (total === 0) matchType = "none";

  return {
    query: {
      zip: zip ?? null,
      menopauseOnly: !!menopauseOnly,
      limit: limit ?? null,
      fallback: !!fallback,
      insurance: planQuery ?? null
    },
    matchType,
    sort,
    total,
    returned: sliced.length,
    providers: sliced,
    provenance: {
      sources: USING_GENERATED_DIRECTORY
        ? [
            "CMS NPPES (taxonomy-filtered via provider_ingest)",
            "Self-reported MSCP/NCMP credentials + curated overlay",
            ...(sort === "distance"
              ? ["Census 2020 ZCTA centroids (Haversine distance)"]
              : []),
            // Make it explicit in every response that insuranceAccepted is
            // synthesized today — surfaces in the agent context too.
            "Insurance acceptance is synthetically derived per-NPI (no public payer feed; replace with a real partner feed when available)"
          ]
        : ["CMS NPPES (synthetic slice)", "MSCP credential list (synthetic)"],
      experienceApi: "pause-provider-directory-experience-api@0.9",
      dataset: DIRECTORY_DATASET_PROVENANCE
    }
  };
}

// Canonical insurance plan tokens — kept in lockstep with insurance.PLANS in
// the Python module. Listed here so the frontend can validate / render
// without round-tripping to the Python build output. If you add a plan,
// update both lists.
const INSURANCE_PLANS = [
  "medicare",
  "medicaid",
  "aetna",
  "bcbs",
  "uhc",
  "cigna",
  "humana",
  "kaiser"
] as const;

const INSURANCE_PLAN_ALIASES: Record<string, string> = {
  "blue cross": "bcbs",
  "blue cross blue shield": "bcbs",
  "blue shield": "bcbs",
  united: "uhc",
  "united healthcare": "uhc",
  unitedhealthcare: "uhc",
  "kaiser permanente": "kaiser"
};

/**
 * Normalize a user-typed insurance plan string into the canonical token
 * used by `insuranceAccepted`. Lowercases + trims + maps common synonyms;
 * unknown plans pass through lowercased so the filter is honest about
 * yielding zero results rather than silently no-op-ing.
 */
export function normalizeInsurancePlan(plan: string | null | undefined): string | null {
  if (!plan) return null;
  const p = plan.trim().toLowerCase();
  if (!p) return null;
  return INSURANCE_PLAN_ALIASES[p] ?? p;
}

export type InsurancePlan = (typeof INSURANCE_PLANS)[number];

/**
 * Annotate `distanceMiles` on each provider and sort distance-asc / score-desc.
 * Providers without a centroid get `distanceMiles: null` and slide to the end.
 * Pure function — extracted so tests can target the ranking surgically without
 * having to construct a full tier-ladder query.
 */
function sortByCentroid(
  rows: ProviderRecord[],
  centroid: { latitude: number; longitude: number }
): ProviderRecordRanked[] {
  const ranked: ProviderRecordRanked[] = rows.map((r) => ({
    ...r,
    distanceMiles:
      r.latitude != null && r.longitude != null
        ? haversineMiles(centroid.latitude, centroid.longitude, r.latitude, r.longitude)
        : null
  }));
  ranked.sort((a, b) => {
    const da = a.distanceMiles ?? Number.POSITIVE_INFINITY;
    const db = b.distanceMiles ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return b.graphScore - a.graphScore;
  });
  return ranked;
}

/** @internal — exported only for tests. Same semantics as the inlined ranker. */
export const sortByCentroidForTest = sortByCentroid;

/**
 * Great-circle distance in miles between two (lat, lng) points.
 *
 * Earth radius is 3,958.7613 miles (mean radius); good to <0.5% over the
 * ranges this directory cares about — far better than the precision the
 * patient ZIP centroid itself carries (a centroid is the area's middle, not
 * the patient's actual address). Pure scalar math; no I/O.
 */
function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Round to 0.1 mi — beyond that is false precision given centroid sourcing.
  return Math.round(R * c * 10) / 10;
}
