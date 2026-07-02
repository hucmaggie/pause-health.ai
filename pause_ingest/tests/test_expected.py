"""Tests for the expected-CI-value recomputation used by the verify script.

These pin that the Python-side aggregation matches the CI SQL formulas and the
cohort's structure, so the verifier compares the live org against the right
numbers.
"""

from __future__ import annotations

from datetime import datetime, timezone

from pause_ingest.cohort import COHORT, generate_cohort_records
from pause_ingest.expected import (
    HRV_Z_MEAN_MS,
    HRV_Z_SD_MS,
    expected_ci_values,
)

BASE = datetime(2026, 6, 13, 12, 0, tzinfo=timezone.utc)


def _expected():
    return expected_ci_values(generate_cohort_records(base=BASE))


def _by_persona(persona_id: str):
    contact_id = next(p.contact_id for p in COHORT if p.persona_id == persona_id)
    return _expected()[contact_id]


def test_covers_all_six_personas_by_contact_id():
    exp = _expected()
    assert set(exp) == {p.contact_id for p in COHORT}


def test_window_days_is_30_for_every_patient():
    # Every persona pushes exactly 30 daily HRV rows → COUNT(value_num) = 30.
    assert all(e.window_days == 30 for e in _expected().values())


def test_flash_count_matches_vasomotor_score_times_two():
    # n_events = round(vasomotor_score * 2) in cohort.py; COUNT(*) in the CI.
    expected_counts = {
        "anika-patel": 14,   # score 7
        "brianna-okafor": 10,  # score 5
        "carmen-diaz": 4,    # score 2
        "deepa-krishnan": 18,  # score 9
        "elena-rossi": 6,    # score 3
        "fatima-khan": 8,    # score 4
    }
    for persona_id, count in expected_counts.items():
        assert _by_persona(persona_id).flash_count_30d == count


def test_z_score_follows_the_ci_anchor():
    for e in _expected().values():
        assert abs(e.z_score - (e.hrv_rmssd_ms - HRV_Z_MEAN_MS) / HRV_Z_SD_MS) < 1e-9


def test_burden_is_severity_sum_over_30_times_100():
    # severity is 1-3 per event, so burden >= flash_count * (100/30).
    for e in _expected().values():
        assert e.burden_score_0_100 >= e.flash_count_30d * (100.0 / 30.0) - 1e-9
        assert e.burden_score_0_100 <= e.flash_count_30d * 3 * (100.0 / 30.0) + 1e-9


def test_disruption_index_is_disrupted_nights_over_7():
    for e in _expected().values():
        assert abs(e.disruption_index_0_1 - e.disrupted_nights / 7) < 1e-9
        assert 0 <= e.disrupted_nights <= 7


def test_higher_vasomotor_persona_has_lower_hrv_z_score():
    # Deepa (vasomotor 9) should sit below Carmen (vasomotor 2) on HRV z-score.
    assert _by_persona("deepa-krishnan").z_score < _by_persona("carmen-diaz").z_score


def test_values_vary_across_patients_so_a_constant_would_be_caught():
    exp = _expected()
    assert len({e.flash_count_30d for e in exp.values()}) > 1
    assert len({round(e.z_score, 4) for e in exp.values()}) > 1
