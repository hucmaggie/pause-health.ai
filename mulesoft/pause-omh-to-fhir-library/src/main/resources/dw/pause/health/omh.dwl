%dw 2.0
/*
  Pause-Health.ai  -  dw::pause::health::omh
  Open mHealth (IEEE 1752.1) -> FHIR R5 Observation

  Shared DataWeave library published to Anypoint Exchange as
  `pause-omh-to-fhir-library`. Consumed by any Pause Mule app (today:
  pause-mulesoft-health-v1; later: pause-ingest-process-api +
  customer-side Process APIs) so the OMH<->FHIR mapping is single-sourced.

  Input: single OMH IEEE 1752.1 envelope (one element from an OMH array).
  Output: FHIR R5 Observation as a Bundle entry (fullUrl + resource).

  Supported schema_id.name values:
    heart-rate                   -> LOINC 8867-4
    heart-rate-variability-rmssd -> LOINC 80404-7
    sleep-duration               -> LOINC 93832-4

  Anything else falls through to an "unmapped-omh" coding rather than
  failing the flow, so one unsupported sample never blocks ingest.

  Usage:
    import dw::pause::health::omh
    ---
    omh::omhToObservation(payload, "Patient/pause-demo-patient-001", 0)
*/

fun omhToObservation(sample: Object, patientRef: String, idx: Number) = do {
  var dataType  = sample.header.schema_id.name default "unknown"
  var uuid      = sample.header.uuid default ("obs-" ++ (idx as String))
  var source    = sample.header.acquisition_provenance.source_name default "Unknown wearable"
  var createdAt = sample.header.creation_date_time default now() as String
  var timeFrame = sample.body.effective_time_frame default {}
  ---
  {
    fullUrl: "urn:uuid:" ++ uuid,
    resource: {
      resourceType: "Observation",
      id: uuid,
      status: "final",
      meta: {
        source: "urn:pause-health:mulesoft:pause-ingest-process-api"
      },
      identifier: [{ system: "urn:openmhealth:header:uuid", value: uuid }],
      category: [{
        coding: [{
          system: "http://terminology.hl7.org/CodeSystem/observation-category",
          code: if (dataType == "sleep-duration") "survey" else "vital-signs",
          display: if (dataType == "sleep-duration") "Survey" else "Vital Signs"
        }]
      }],
      code: if (dataType == "heart-rate") {
        coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }]
      } else if (dataType == "heart-rate-variability-rmssd") {
        coding: [{ system: "http://loinc.org", code: "80404-7", display: "R-R interval by EKG" }]
      } else if (dataType == "sleep-duration") {
        coding: [{ system: "http://loinc.org", code: "93832-4", display: "Sleep duration" }]
      } else {
        coding: [{ system: "urn:pause-health:code:unmapped-omh", code: dataType, display: "Unmapped OMH type" }]
      },
      subject: { reference: patientRef },
      (effectiveDateTime: timeFrame.date_time) if (timeFrame.date_time != null),
      (effectivePeriod: {
        start: timeFrame.time_interval.start_date_time,
        end: timeFrame.time_interval.end_date_time
      }) if (timeFrame.time_interval != null),
      valueQuantity: if (dataType == "heart-rate") {
        value: sample.body.heart_rate.value,
        unit: "/min",
        system: "http://unitsofmeasure.org",
        code: "/min"
      } else if (dataType == "heart-rate-variability-rmssd") {
        value: sample.body.rmssd.value,
        unit: "ms",
        system: "http://unitsofmeasure.org",
        code: "ms"
      } else if (dataType == "sleep-duration") {
        value: sample.body.sleep_duration.value,
        unit: sample.body.sleep_duration.unit default "min",
        system: "http://unitsofmeasure.org",
        code: sample.body.sleep_duration.unit default "min"
      } else null,
      device: { display: source },
      extension: [{
        url: "urn:pause-health:extension:mulesoft-pipeline-version",
        valueString: "pause-ingest-process-api@1.0"
      }]
    }
  }
}
