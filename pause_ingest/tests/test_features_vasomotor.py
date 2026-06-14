"""Tests for vasomotor-symptom feature engineering."""

from __future__ import annotations

import pytest

from pause_ingest.features_vasomotor import (
    InvalidVasomotorInput,
    VasomotorEvent,
    detect_vasomotor_event,
    vasomotor_burden,
)


def test_detect_returns_none_below_threshold():
    # Temp rise present but HR surge too small.
    assert (
        detect_vasomotor_event(hour_of_day=14, skin_temp_delta_c=0.5, hr_delta_bpm=3.0)
        is None
    )
    # HR surge present but temp rise too small.
    assert (
        detect_vasomotor_event(hour_of_day=14, skin_temp_delta_c=0.1, hr_delta_bpm=20.0)
        is None
    )


def test_detect_daytime_is_hot_flash():
    ev = detect_vasomotor_event(hour_of_day=14, skin_temp_delta_c=0.4, hr_delta_bpm=10.0)
    assert ev is not None
    assert ev.kind == "hot_flash"
    assert ev.severity == 1  # 0.4 < moderate cut (0.60)


def test_detect_nighttime_is_night_sweat():
    ev = detect_vasomotor_event(hour_of_day=2, skin_temp_delta_c=0.7, hr_delta_bpm=12.0)
    assert ev is not None
    assert ev.kind == "night_sweat"
    assert ev.severity == 2  # 0.60 <= 0.7 < 1.00


def test_detect_severity_severe():
    ev = detect_vasomotor_event(hour_of_day=23, skin_temp_delta_c=1.2, hr_delta_bpm=15.0)
    assert ev is not None
    assert ev.severity == 3


def test_night_window_boundaries():
    # 22:00 and 05:00 are night; 06:00 and 21:00 are day.
    night = detect_vasomotor_event(hour_of_day=22, skin_temp_delta_c=0.4, hr_delta_bpm=10.0)
    early = detect_vasomotor_event(hour_of_day=5, skin_temp_delta_c=0.4, hr_delta_bpm=10.0)
    morning = detect_vasomotor_event(hour_of_day=6, skin_temp_delta_c=0.4, hr_delta_bpm=10.0)
    evening = detect_vasomotor_event(hour_of_day=21, skin_temp_delta_c=0.4, hr_delta_bpm=10.0)
    assert night.kind == "night_sweat"
    assert early.kind == "night_sweat"
    assert morning.kind == "hot_flash"
    assert evening.kind == "hot_flash"


def test_detect_rejects_bad_hour():
    with pytest.raises(InvalidVasomotorInput):
        detect_vasomotor_event(hour_of_day=24, skin_temp_delta_c=0.5, hr_delta_bpm=10.0)


def _ev(kind: str, severity: int) -> VasomotorEvent:
    hour = 2 if kind == "night_sweat" else 14
    return VasomotorEvent(
        hour_of_day=hour,
        kind=kind,  # type: ignore[arg-type]
        severity=severity,
        skin_temp_delta_c=0.5,
        hr_delta_bpm=10.0,
    )


def test_burden_matches_ci_formula():
    # 14 severity-1 events over 30 days → 14/30*100 = 46.67.
    events = [_ev("hot_flash", 1) for _ in range(14)]
    b = vasomotor_burden(events, window_days=30)
    assert b.event_count == 14
    assert b.severity_sum == pytest.approx(14.0)
    assert b.burden_score_0_100 == pytest.approx(14 / 30 * 100)
    assert b.hot_flash_count == 14
    assert b.night_sweat_count == 0


def test_burden_caps_at_100():
    # 40 severity-3 events over 30 days would be 400 → capped to 100.
    events = [_ev("night_sweat", 3) for _ in range(40)]
    b = vasomotor_burden(events, window_days=30)
    assert b.burden_score_0_100 == pytest.approx(100.0)
    assert b.night_sweat_count == 40


def test_burden_empty_is_zero():
    b = vasomotor_burden([], window_days=30)
    assert b.event_count == 0
    assert b.burden_score_0_100 == pytest.approx(0.0)


def test_burden_rejects_bad_window():
    with pytest.raises(InvalidVasomotorInput):
        vasomotor_burden([], window_days=0)
