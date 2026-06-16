"""Wrap an Open mHealth record (or a derived feature set) as a FHIR R5 Observation.

JupyterHealth Exchange stores OMH payloads as ``valueAttachment`` on a FHIR
``Observation``, base64-encoded JSON. This module produces exactly that
shape so the uploader can POST it without further massaging.

We do NOT try to translate OMH semantics into FHIR codings here — that's
work for the provider-side read path. At ingest, we just preserve the OMH
payload verbatim and reference the right Patient and Device.

Two public helpers:

  * ``omh_to_fhir_observation`` — for **raw** OMH samples that came out of
    omh-shim. The valueAttachment carries the IEEE 1752.1-headered OMH
    payload verbatim.
  * ``hrv_features_to_fhir_observation`` — for **derived** HRV feature
    observations computed by ``pause_ingest.features``. The
    valueAttachment carries the feature-set payload with a derivation
    pointer back to the raw observations it was computed from.

Both produce Observation resources that JHE's FHIR validator accepts, and
both carry a derivable schema code so the provider-side read path can tell
them apart.
"""

from __future__ import annotations

import base64
import dataclasses
import json
import uuid
from datetime import datetime, timezone
from typing import Any


def omh_to_fhir_observation(
    *,
    omh_record: dict[str, Any],
    patient_fhir_id: str,
    data_source_id: str,
) -> dict[str, Any]:
    """Build a FHIR R5 Observation with the OMH record as valueAttachment.

    Args:
        omh_record: IEEE 1752.1-headered Open mHealth data point.
        patient_fhir_id: FHIR Patient resource id (the JHE-issued id, not MRN).
        data_source_id: FHIR Device resource id registered as a Data Source in JHE.

    Returns:
        Dict shaped as a FHIR R5 Observation, ready to POST to /fhir/r5/Observation.
    """
    header = omh_record.get("header", {})
    schema_id = header.get("schema_id", {})
    schema_name = schema_id.get("name", "unknown")
    schema_version = schema_id.get("version", "0")
    schema_namespace = schema_id.get("namespace", "omh")

    encoded = base64.b64encode(
        json.dumps(omh_record, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")

    effective_time = (
        omh_record.get("body", {})
        .get("effective_time_frame", {})
        .get("date_time")
        or header.get("source_creation_date_time")
        or datetime.now(timezone.utc).isoformat()
    )

    return {
        "resourceType": "Observation",
        "id": str(uuid.uuid4()),
        "status": "final",
        "category": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "vital-signs",
                        "display": "Vital Signs",
                    }
                ]
            }
        ],
        "code": {
            "coding": [
                {
                    "system": "https://w3id.org/openmhealth",
                    "code": f"{schema_namespace}:{schema_name}:{schema_version}",
                    "display": schema_name.replace("-", " ").title(),
                }
            ],
            "text": schema_name.replace("-", " "),
        },
        "subject": {"reference": f"Patient/{patient_fhir_id}"},
        "device": {"reference": f"Device/{data_source_id}"},
        "effectiveDateTime": effective_time,
        "valueAttachment": {
            "contentType": "application/json",
            "data": encoded,
            "title": f"open-mhealth-{schema_name}-v{schema_version}",
        },
    }


def hrv_features_to_fhir_observation(
    *,
    hrv: Any,  # pause_ingest.features.HrvTimeDomain
    patient_fhir_id: str,
    data_source_id: str,
    derived_from_observation_ids: list[str] | None = None,
    window_start: str | None = None,
    window_end: str | None = None,
) -> dict[str, Any]:
    """Wrap a computed HRV feature set as a FHIR R5 Observation.

    These derived observations sit alongside the raw OMH observations in
    JHE, with a ``derivedFrom`` pointer back to the raw observations
    the features were computed from. The provider-side read path can
    then fetch features directly (much smaller payload) and pull the
    raw timeline only when an explanation is needed.

    Schema code: ``pause-derived:hrv-time-domain:1.0``. The
    ``pause-derived`` namespace is Pause-private; we plan to upstream a
    schema proposal to the Open mHealth registry once we have field
    coverage validated against a real provider cohort.

    Args:
        hrv: An ``HrvTimeDomain`` dataclass instance (or any dataclass
            with the same field shape -- duck-typed for test friendliness).
        patient_fhir_id: JHE-issued FHIR Patient id.
        data_source_id: JHE-registered Data Source / Device id.
        derived_from_observation_ids: server-assigned observation ids of
            the raw observations this feature set was computed from.
            Optional but recommended -- enables drill-back from feature
            to raw timeline on the provider side.
        window_start, window_end: ISO-8601 timestamps for the sliding
            window the features cover. Defaults to "now" if unspecified.

    Returns:
        FHIR R5 Observation dict, ready to POST to /fhir/r5/Observation.
    """
    if dataclasses.is_dataclass(hrv):
        feature_payload: dict[str, Any] = dataclasses.asdict(hrv)
    elif isinstance(hrv, dict):
        feature_payload = dict(hrv)
    else:
        raise TypeError(
            f"hrv must be a dataclass instance or dict, got {type(hrv).__name__}"
        )

    now = datetime.now(timezone.utc).isoformat()
    encoded = base64.b64encode(
        json.dumps(
            {
                "header": {
                    "uuid": str(uuid.uuid4()),
                    "schema_id": {
                        "namespace": "pause-derived",
                        "name": "hrv-time-domain",
                        "version": "1.0",
                    },
                    "creation_date_time": now,
                    "modality": "derived",
                },
                "body": feature_payload,
            },
            separators=(",", ":"),
        ).encode("utf-8")
    ).decode("ascii")

    observation: dict[str, Any] = {
        "resourceType": "Observation",
        "id": str(uuid.uuid4()),
        "status": "final",
        "category": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "vital-signs",
                        "display": "Vital Signs",
                    }
                ]
            }
        ],
        "code": {
            "coding": [
                {
                    "system": "https://pause-health.ai/schemas/derived",
                    "code": "hrv-time-domain",
                    "display": "HRV time-domain features (Task Force 1996)",
                    "version": "1.0",
                }
            ],
            "text": "HRV time-domain features",
        },
        "subject": {"reference": f"Patient/{patient_fhir_id}"},
        "device": {"reference": f"Device/{data_source_id}"},
        "effectiveDateTime": window_end or window_start or now,
        "valueAttachment": {
            "contentType": "application/json",
            "data": encoded,
            "title": "pause-derived-hrv-time-domain-v1.0",
        },
    }

    if window_start and window_end:
        observation["effectivePeriod"] = {
            "start": window_start,
            "end": window_end,
        }
        # FHIR R5 requires either effectiveDateTime OR effectivePeriod,
        # not both. Drop the dateTime when we have a Period.
        observation.pop("effectiveDateTime", None)

    if derived_from_observation_ids:
        observation["derivedFrom"] = [
            {"reference": f"Observation/{oid}"}
            for oid in derived_from_observation_ids
        ]

    return observation
