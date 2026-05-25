import { NextResponse } from "next/server";

/**
 * Mocked Pause-Health.ai Experience-tier endpoint.
 *
 * In production, this URL is served by the MuleSoft Experience API
 * `pause-patient-bundle-process-api` running on the customer's
 * Anypoint Runtime Fabric or CloudHub 2.0. The Pause clinician web
 * app and the Pause backend both call it instead of talking to
 * JupyterHealth Exchange or the DBDP feature worker directly.
 *
 * The response is a FHIR R5 Bundle containing:
 *   - 1 Patient resource (synthetic; no PHI)
 *   - 3 raw wearable Observations (heart rate, sleep duration, HRV
 *     RR-interval) ingested via the omh-shim path
 *   - 1 DBDP-computed feature Observation (sliding-window RMSSD)
 *     with a `derivedFrom` reference pointing back to the raw HRV
 *     Observation it was computed from -- this is the full audit
 *     trail described in docs/jupyterhealth-integration.md.
 *
 * This route is intentionally a stub: there is no live MuleSoft
 * runtime behind it. Its purpose is to let prospects, partners, and
 * reviewers `curl https://pause-health.ai/api/mulesoft/health` and
 * see the exact shape the production Experience API will return.
 *
 * Cache for 5 minutes -- the payload is deterministic, no need to
 * recompute on every request.
 */

const PATIENT_ID = "pause-demo-patient-001";
const RAW_HRV_ID = "obs-hrv-raw-001";

const FHIR_BUNDLE = {
  resourceType: "Bundle",
  type: "searchset",
  meta: {
    lastUpdated: "2026-05-25T18:00:00Z",
    source: "urn:pause-health:mulesoft:pause-patient-bundle-process-api"
  },
  entry: [
    {
      fullUrl: `urn:uuid:${PATIENT_ID}`,
      resource: {
        resourceType: "Patient",
        id: PATIENT_ID,
        meta: {
          profile: ["http://hl7.org/fhir/StructureDefinition/Patient"]
        },
        identifier: [
          {
            system: "urn:pause-health:demo-cohort",
            value: PATIENT_ID
          }
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
        subject: { reference: `Patient/${PATIENT_ID}` },
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
        subject: { reference: `Patient/${PATIENT_ID}` },
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
        subject: { reference: `Patient/${PATIENT_ID}` },
        effectivePeriod: {
          start: "2026-05-25T02:00:00Z",
          end: "2026-05-25T02:03:00Z"
        },
        component: Array.from({ length: 6 }, (_, idx) => ({
          code: {
            text: `RR interval ${idx + 1}`
          },
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
        subject: { reference: `Patient/${PATIENT_ID}` },
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

const META = {
  _note:
    "This endpoint is a mocked Pause-Health.ai Experience API. In production, an equivalent endpoint is served by the MuleSoft pause-patient-bundle-process-api running on the customer's Anypoint Runtime Fabric or CloudHub 2.0. See docs/mulesoft-integration.md for the full architecture.",
  _generatedBy: "next.js mock @ /api/mulesoft/health",
  _bundleEntries: FHIR_BUNDLE.entry.length
};

export async function GET() {
  return NextResponse.json(
    { meta: META, bundle: FHIR_BUNDLE },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600"
      }
    }
  );
}
