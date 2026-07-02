"""Tests for the pure comparison core of examples/data_cloud_verify.py.

The live query is exercised via the query-client tests; here we pin the
diff logic that decides PASS/FAIL, including the "mock still active" guard.
"""

from __future__ import annotations

from examples.data_cloud_verify import (
    compare_patient,
    constant_mock_warnings,
)
from pause_ingest.expected import ExpectedCI


def _expected() -> ExpectedCI:
    return ExpectedCI(
        unified_id="003X",
        hrv_rmssd_ms=45.0,
        z_score=0.25,
        window_days=30,
        burden_score_0_100=46.7,
        flash_count_30d=14,
        disruption_index_0_1=3 / 7,
        disrupted_nights=3,
    )


def _rows(overrides: dict | None = None):
    hrv = {"hrv_rmssd_ms__c": 45.0, "z_score__c": 0.25, "window_days__c": 30}
    vaso = {"burden_score_0_100__c": 46.7, "flash_count_30d__c": 14}
    sleep = {"disruption_index_0_1__c": 3 / 7, "disrupted_nights__c": 3}
    rows = {"hrv": hrv, "vaso": vaso, "sleep": sleep}
    if overrides:
        for key, patch in overrides.items():
            rows[key] = {**rows[key], **patch} if patch is not None else None
    return rows


def test_matching_rows_produce_no_problems():
    r = _rows()
    assert compare_patient(_expected(), r["hrv"], r["vaso"], r["sleep"]) == []


def test_float_within_tolerance_passes():
    # Data Cloud returns a slightly different average — within tolerance.
    r = _rows({"hrv": {"hrv_rmssd_ms__c": 45.3, "z_score__c": 0.275}})
    assert compare_patient(_expected(), r["hrv"], r["vaso"], r["sleep"], ms_tol=0.5) == []


def test_count_mismatch_is_flagged_exactly():
    r = _rows({"vaso": {"flash_count_30d__c": 13}})
    problems = compare_patient(_expected(), r["hrv"], r["vaso"], r["sleep"])
    assert any("flash_count_30d__c" in p for p in problems)


def test_float_outside_tolerance_is_flagged():
    r = _rows({"hrv": {"hrv_rmssd_ms__c": 60.0}})
    problems = compare_patient(_expected(), r["hrv"], r["vaso"], r["sleep"], ms_tol=0.5)
    assert any("hrv_rmssd_ms__c" in p for p in problems)


def test_missing_ci_row_is_flagged():
    problems = compare_patient(_expected(), None, None, None)
    assert len(problems) == 3
    assert any("no HRV CI row" in p for p in problems)


def test_constant_mock_warning_triggers_when_all_identical():
    warnings = constant_mock_warnings([0.5, 0.5, 0.5], [10, 10, 10])
    assert len(warnings) == 2
    assert any("HRV z-score" in w for w in warnings)
    assert any("flash count" in w for w in warnings)


def test_no_constant_warning_when_values_vary():
    assert constant_mock_warnings([0.1, 0.9, -0.3], [4, 14, 8]) == []


def test_no_constant_warning_for_single_patient():
    # A one-patient run can't distinguish constant from real; don't false-alarm.
    assert constant_mock_warnings([0.5], [10]) == []
