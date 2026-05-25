"""Wrap an Open mHealth record as a FHIR R5 Observation resource.

JupyterHealth Exchange stores OMH payloads as ``valueAttachment`` on a FHIR
``Observation``, base64-encoded JSON. This module produces exactly that
shape so the uploader can POST it without further massaging.

We do NOT try to translate OMH semantics into FHIR codings here — that's
work for the provider-side read path. At ingest, we just preserve the OMH
payload verbatim and reference the right Patient and Device.
"""

from __future__ import annotations

import base64
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
                    "system": f"https://w3id.org/openmhealth/schemas/{schema_namespace}",
                    "code": schema_name,
                    "display": schema_name.replace("-", " ").title(),
                    "version": str(schema_version),
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
