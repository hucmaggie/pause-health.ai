%dw 2.0

/*
  Pause-Health.ai  —  Open mHealth -> FHIR R5 Observation

  Reference DataWeave 2.0 transform. Invoked by the
  pause-ingest-process-api flow between the wearable System API
  (which produces normalized OMH) and the jhe-system-api (which
  expects FHIR R5).

  Supported OMH data types:
    - heart_rate          -> http://loinc.org / 8867-4
    - heart_rate_variability (RMSSD over a window)
                          -> http://loinc.org / 80404-7
    - sleep_duration      -> http://loinc.org / 93832-4

  Add more cases below. The fall-through emits an empty Observation
  rather than failing the flow so a single unsupported sample does
  not block ingest.

  Input shape (Open mHealth IEEE 1752.1 envelope):
    {
      "header": {
        "uuid": "...",
        "schema_id": { "namespace": "omh", "name": "heart-rate",
                       "version": "2.0" },
        "creation_date_time": "2026-05-25T08:00:00Z",
        "acquisition_provenance": { "source_name": "Oura Ring Gen3" }
      },
      "body": { ... data-type-specific ... }
    }
*/

output application/fhir+json
---
{
  resourceType: "Observation",
  status: "final",
  meta: {
    profile: ["http://hl7.org/fhir/StructureDefinition/Observation"],
    source: "urn:pause-health:mulesoft:pause-ingest-process-api"
  },
  identifier: [{
    system: "urn:openmhealth:header:uuid",
    value: payload.header.uuid
  }],
  category: [{
    coding: [{
      system: "http://terminology.hl7.org/CodeSystem/observation-category",
      code: "vital-signs",
      display: "Vital Signs"
    }]
  }],
  code: do {
    var dataType = payload.header.schema_id.name default "unknown"
    ---
    if (dataType == "heart-rate") {
      coding: [{
        system: "http://loinc.org",
        code: "8867-4",
        display: "Heart rate"
      }]
    }
    else if (dataType == "heart-rate-variability-rmssd") {
      coding: [{
        system: "http://loinc.org",
        code: "80404-7",
        display: "R-R interval by EKG"
      }]
    }
    else if (dataType == "sleep-duration") {
      coding: [{
        system: "http://loinc.org",
        code: "93832-4",
        display: "Sleep duration"
      }]
    }
    else {
      coding: [{
        system: "urn:pause-health:code:unmapped-omh",
        code: dataType,
        display: "Unmapped OMH data type"
      }]
    }
  },
  effectiveDateTime: payload.body.effective_time_frame.date_time
                     default payload.header.creation_date_time,
  valueQuantity: do {
    var dataType = payload.header.schema_id.name default "unknown"
    ---
    if (dataType == "heart-rate") {
      value: payload.body.heart_rate.value,
      unit: payload.body.heart_rate.unit default "/min",
      system: "http://unitsofmeasure.org",
      code: "/min"
    }
    else if (dataType == "heart-rate-variability-rmssd") {
      value: payload.body.rmssd.value,
      unit: "ms",
      system: "http://unitsofmeasure.org",
      code: "ms"
    }
    else if (dataType == "sleep-duration") {
      value: payload.body.sleep_duration.value,
      unit: payload.body.sleep_duration.unit default "min",
      system: "http://unitsofmeasure.org",
      code: payload.body.sleep_duration.unit default "min"
    }
    else null
  },
  /*
    Device provenance. The acquisition_provenance.source_name from the
    OMH header is the human label (e.g. "Oura Ring Gen3"); the actual
    Device resource lives in JHE and is referenced by URN if known.
  */
  device: {
    display: payload.header.acquisition_provenance.source_name
             default "Unknown wearable"
  },
  /*
    Custom extension that lets the read path quickly identify samples
    that came through the MuleSoft pipeline versus direct ingest.
  */
  extension: [{
    url: "urn:pause-health:extension:mulesoft-pipeline-version",
    valueString: "pause-ingest-process-api@1.0"
  }]
}
