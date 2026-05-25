"""Offline tests for the convert + FHIR wrapper layer.

These tests do not touch a JupyterHealth Exchange — they exercise the
parts of the pipeline that should be deterministic and unit-testable.

Sample shapes here are validated against the actual ``omh-shim`` v1.0.1
converter implementations, not the README. The README documents an
aspirational ergonomic surface that v1.0.1 does not yet match.
"""

from __future__ import annotations

import base64
import json
from zoneinfo import ZoneInfo

import pytest

from pause_ingest.convert import UnsupportedConversion, convert_sample
from pause_ingest.fhir import omh_to_fhir_observation


def test_convert_oura_heart_rate_includes_header():
    omh = convert_sample(
        source="oura_raw",
        data_type="heart_rate",
        sample={"bpm": 72, "timestamp": "2026-04-09T08:00:00Z"},
        default_tz=ZoneInfo("UTC"),
    )
    assert "header" in omh, "Pause-Health requires IEEE 1752.1 headers on all records"
    assert omh["header"]["schema_id"]["name"] == "heart-rate"
    assert omh["body"]["heart_rate"]["value"] == 72.0
    assert omh["body"]["heart_rate"]["unit"] == "beats/min"


def test_convert_oura_sleep_duration():
    """oura_raw sleep_duration expects total_sleep_duration (sec) + bedtime bounds."""
    omh = convert_sample(
        source="oura_raw",
        data_type="sleep_duration",
        sample={
            "total_sleep_duration": 25200,
            "bedtime_start": "2026-04-09T23:00:00-07:00",
            "bedtime_end": "2026-04-10T06:00:00-07:00",
        },
        default_tz=ZoneInfo("America/Los_Angeles"),
    )
    assert omh["header"]["schema_id"]["name"] == "sleep-duration"
    assert omh["body"]["sleep_duration"]["value"] == 25200
    assert omh["body"]["sleep_duration"]["unit"] == "sec"


def test_convert_rejects_unsupported_source():
    with pytest.raises(UnsupportedConversion):
        convert_sample(
            source="fitbit_raw",
            data_type="heart_rate",
            sample={"bpm": 60, "timestamp": "2026-04-09T08:00:00Z"},
            default_tz=ZoneInfo("UTC"),
        )


def test_convert_rejects_unsupported_data_type():
    """oura_raw does not currently ship an oxygen_saturation converter."""
    with pytest.raises(UnsupportedConversion):
        convert_sample(
            source="oura_raw",
            data_type="oxygen_saturation",
            sample={"percentage": 97.5, "timestamp": "2026-04-09T08:00:00Z"},
            default_tz=ZoneInfo("UTC"),
        )


def test_convert_rejects_data_type_not_in_omh_shim_at_all():
    """skin_temperature isn't in omh-shim v1.0.1; we plan to upstream it."""
    with pytest.raises(UnsupportedConversion):
        convert_sample(
            source="oura_raw",
            data_type="skin_temperature",
            sample={"celsius": 36.4, "timestamp": "2026-04-09T08:00:00Z"},
            default_tz=ZoneInfo("UTC"),
        )


def test_fhir_envelope_round_trips_omh_payload():
    """The base64 valueAttachment should decode back to the OMH record verbatim."""
    omh = convert_sample(
        source="oura_raw",
        data_type="heart_rate",
        sample={"bpm": 72, "timestamp": "2026-04-09T08:00:00Z"},
        default_tz=ZoneInfo("UTC"),
    )

    observation = omh_to_fhir_observation(
        omh_record=omh,
        patient_fhir_id="patient-abc",
        data_source_id="device-oura-001",
    )

    assert observation["resourceType"] == "Observation"
    assert observation["subject"] == {"reference": "Patient/patient-abc"}
    assert observation["device"] == {"reference": "Device/device-oura-001"}

    encoded = observation["valueAttachment"]["data"]
    decoded = json.loads(base64.b64decode(encoded).decode("utf-8"))
    assert decoded == omh, "FHIR valueAttachment must round-trip the OMH record"


def test_fhir_envelope_sets_effective_time_from_omh_body():
    omh = convert_sample(
        source="oura_raw",
        data_type="heart_rate",
        sample={"bpm": 72, "timestamp": "2026-04-09T08:00:00Z"},
        default_tz=ZoneInfo("UTC"),
    )
    observation = omh_to_fhir_observation(
        omh_record=omh,
        patient_fhir_id="patient-abc",
        data_source_id="device-oura-001",
    )
    assert observation["effectiveDateTime"].startswith("2026-04-09T08:00:00")


def test_fhir_envelope_sets_observation_status_final():
    omh = convert_sample(
        source="oura_raw",
        data_type="heart_rate",
        sample={"bpm": 72, "timestamp": "2026-04-09T08:00:00Z"},
        default_tz=ZoneInfo("UTC"),
    )
    observation = omh_to_fhir_observation(
        omh_record=omh,
        patient_fhir_id="patient-abc",
        data_source_id="device-oura-001",
    )
    assert observation["status"] == "final"
    assert observation["category"][0]["coding"][0]["code"] == "vital-signs"
