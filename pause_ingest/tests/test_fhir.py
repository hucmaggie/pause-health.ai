"""Tests for the OMH → FHIR R5 Observation wrappers.

fhir.py had no direct coverage. These are the resources the uploader POSTs to
JupyterHealth Exchange, so the contract that matters is: the OMH payload is
preserved verbatim (base64 round-trips), the schema code is derived from the
OMH header (with sane defaults), the derived-HRV path carries the private
pause-derived schema + derivedFrom pointers, and the FHIR R5 rule that an
Observation carries effectiveDateTime XOR effectivePeriod (never both).
"""

import base64
import json
from dataclasses import dataclass

import pytest

from pause_ingest.fhir import (
    hrv_features_to_fhir_observation,
    omh_to_fhir_observation,
)


def _decode_attachment(observation: dict) -> dict:
    return json.loads(base64.b64decode(observation["valueAttachment"]["data"]))


OMH_RECORD = {
    "header": {
        "schema_id": {"namespace": "omh", "name": "heart-rate", "version": "3.1"},
        "source_creation_date_time": "2026-01-02T03:04:05Z",
    },
    "body": {
        "heart_rate": {"value": 62, "unit": "beats/min"},
        "effective_time_frame": {"date_time": "2026-01-02T03:00:00Z"},
    },
}


class TestOmhToFhir:
    def test_basic_observation_shape(self):
        obs = omh_to_fhir_observation(
            omh_record=OMH_RECORD, patient_fhir_id="pat-1", data_source_id="dev-9"
        )
        assert obs["resourceType"] == "Observation"
        assert obs["status"] == "final"
        assert obs["category"][0]["coding"][0]["code"] == "vital-signs"
        assert obs["subject"]["reference"] == "Patient/pat-1"
        assert obs["device"]["reference"] == "Device/dev-9"

    def test_schema_code_derived_from_header(self):
        obs = omh_to_fhir_observation(
            omh_record=OMH_RECORD, patient_fhir_id="p", data_source_id="d"
        )
        assert obs["code"]["coding"][0]["code"] == "omh:heart-rate:3.1"
        assert obs["valueAttachment"]["title"] == "open-mhealth-heart-rate-v3.1"

    def test_payload_is_preserved_verbatim(self):
        obs = omh_to_fhir_observation(
            omh_record=OMH_RECORD, patient_fhir_id="p", data_source_id="d"
        )
        assert _decode_attachment(obs) == OMH_RECORD

    def test_effective_time_prefers_body_effective_time_frame(self):
        obs = omh_to_fhir_observation(
            omh_record=OMH_RECORD, patient_fhir_id="p", data_source_id="d"
        )
        assert obs["effectiveDateTime"] == "2026-01-02T03:00:00Z"

    def test_effective_time_falls_back_to_header_creation(self):
        record = {
            "header": {
                "schema_id": {"namespace": "omh", "name": "hr", "version": "1"},
                "source_creation_date_time": "2026-05-05T00:00:00Z",
            },
            "body": {},
        }
        obs = omh_to_fhir_observation(
            omh_record=record, patient_fhir_id="p", data_source_id="d"
        )
        assert obs["effectiveDateTime"] == "2026-05-05T00:00:00Z"

    def test_missing_header_uses_safe_defaults(self):
        obs = omh_to_fhir_observation(
            omh_record={"body": {}}, patient_fhir_id="p", data_source_id="d"
        )
        # namespace "omh", name "unknown", version "0".
        assert obs["code"]["coding"][0]["code"] == "omh:unknown:0"
        # effectiveDateTime defaults to a real ISO timestamp (now).
        assert isinstance(obs["effectiveDateTime"], str)
        assert obs["effectiveDateTime"]


@dataclass
class _Hrv:
    rmssd_ms: float
    sdnn_ms: float
    mean_rr_ms: float


class TestHrvFeaturesToFhir:
    def test_accepts_dataclass_and_carries_derived_schema(self):
        obs = hrv_features_to_fhir_observation(
            hrv=_Hrv(rmssd_ms=42.0, sdnn_ms=55.0, mean_rr_ms=880.0),
            patient_fhir_id="pat-1",
            data_source_id="dev-9",
        )
        body = _decode_attachment(obs)
        assert body["header"]["schema_id"]["namespace"] == "pause-derived"
        assert body["header"]["schema_id"]["name"] == "hrv-time-domain"
        assert body["body"] == {"rmssd_ms": 42.0, "sdnn_ms": 55.0, "mean_rr_ms": 880.0}
        assert obs["code"]["coding"][0]["system"] == (
            "https://pause-health.ai/schemas/derived"
        )

    def test_accepts_plain_dict(self):
        obs = hrv_features_to_fhir_observation(
            hrv={"rmssd_ms": 30.0},
            patient_fhir_id="p",
            data_source_id="d",
        )
        assert _decode_attachment(obs)["body"] == {"rmssd_ms": 30.0}

    def test_rejects_non_dataclass_non_dict(self):
        with pytest.raises(TypeError):
            hrv_features_to_fhir_observation(
                hrv=[1, 2, 3], patient_fhir_id="p", data_source_id="d"
            )

    def test_window_produces_effective_period_and_drops_datetime(self):
        obs = hrv_features_to_fhir_observation(
            hrv={"rmssd_ms": 1.0},
            patient_fhir_id="p",
            data_source_id="d",
            window_start="2026-01-01T00:00:00Z",
            window_end="2026-01-02T00:00:00Z",
        )
        # FHIR R5: effectiveDateTime XOR effectivePeriod — never both.
        assert "effectiveDateTime" not in obs
        assert obs["effectivePeriod"] == {
            "start": "2026-01-01T00:00:00Z",
            "end": "2026-01-02T00:00:00Z",
        }

    def test_single_window_bound_stays_datetime(self):
        obs = hrv_features_to_fhir_observation(
            hrv={"rmssd_ms": 1.0},
            patient_fhir_id="p",
            data_source_id="d",
            window_end="2026-01-02T00:00:00Z",
        )
        assert "effectivePeriod" not in obs
        assert obs["effectiveDateTime"] == "2026-01-02T00:00:00Z"

    def test_derived_from_references_when_ids_given(self):
        obs = hrv_features_to_fhir_observation(
            hrv={"rmssd_ms": 1.0},
            patient_fhir_id="p",
            data_source_id="d",
            derived_from_observation_ids=["obs-1", "obs-2"],
        )
        assert obs["derivedFrom"] == [
            {"reference": "Observation/obs-1"},
            {"reference": "Observation/obs-2"},
        ]

    def test_no_derived_from_key_when_ids_absent(self):
        obs = hrv_features_to_fhir_observation(
            hrv={"rmssd_ms": 1.0}, patient_fhir_id="p", data_source_id="d"
        )
        assert "derivedFrom" not in obs
