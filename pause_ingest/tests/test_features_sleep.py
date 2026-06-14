"""Tests for sleep-architecture feature engineering."""

from __future__ import annotations

import pytest

from pause_ingest.features_sleep import (
    InvalidSleepSession,
    sleep_disruption_index,
    sleep_efficiency_from_stages,
    is_disrupted_night,
)


def test_efficiency_basic():
    # 7h asleep (light 240 + deep 90 + rem 90 = 420) of 480 min in bed = 0.875.
    eff = sleep_efficiency_from_stages(
        light_min=240, deep_min=90, rem_min=90, awake_min=60, awakenings=3
    )
    assert eff.time_in_bed_min == pytest.approx(480.0)
    assert eff.total_sleep_min == pytest.approx(420.0)
    assert eff.efficiency == pytest.approx(0.875)
    assert eff.awakenings == 3


def test_efficiency_perfect_when_no_awake_time():
    eff = sleep_efficiency_from_stages(
        light_min=200, deep_min=100, rem_min=100, awake_min=0
    )
    assert eff.efficiency == pytest.approx(1.0)


def test_efficiency_rejects_negative_stage():
    with pytest.raises(InvalidSleepSession):
        sleep_efficiency_from_stages(light_min=-1, deep_min=90, rem_min=90, awake_min=60)


def test_efficiency_rejects_subhour_session():
    # 30 min total in bed is a nap, not a scorable night.
    with pytest.raises(InvalidSleepSession):
        sleep_efficiency_from_stages(light_min=20, deep_min=5, rem_min=0, awake_min=5)


def test_efficiency_rejects_empty_session():
    with pytest.raises(InvalidSleepSession):
        sleep_efficiency_from_stages(light_min=0, deep_min=0, rem_min=0, awake_min=0)


def test_is_disrupted_night_threshold():
    assert is_disrupted_night(0.79) is True
    assert is_disrupted_night(0.80) is False  # threshold is exclusive
    assert is_disrupted_night(0.95) is False


def test_is_disrupted_night_rejects_out_of_range():
    with pytest.raises(InvalidSleepSession):
        is_disrupted_night(1.5)


def test_disruption_index_counts_below_threshold():
    # 3 of 7 nights below 0.80.
    effs = [0.92, 0.71, 0.88, 0.65, 0.95, 0.78, 0.90]
    d = sleep_disruption_index(effs)
    assert d.window_nights == 7
    assert d.nights_observed == 7
    assert d.disrupted_nights == 3
    assert d.disruption_index == pytest.approx(3 / 7)


def test_disruption_index_missing_nights_count_as_non_disrupted():
    # Only 3 nights synced; denominator stays at the 7-night window.
    effs = [0.60, 0.70, 0.95]
    d = sleep_disruption_index(effs)
    assert d.nights_observed == 3
    assert d.disrupted_nights == 2
    assert d.disruption_index == pytest.approx(2 / 7)


def test_disruption_index_rejects_overfull_window():
    with pytest.raises(InvalidSleepSession):
        sleep_disruption_index([0.9] * 8, window_nights=7)


def test_disruption_index_rejects_bad_window():
    with pytest.raises(InvalidSleepSession):
        sleep_disruption_index([0.9], window_nights=0)
