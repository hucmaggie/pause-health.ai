"""Vasomotor-symptom (hot flash / night sweat) feature engineering.

Companion to ``features.py`` (HRV) and ``features_sleep.py``. Detects
thermoregulatory events from wearable signals and rolls them into the
``Pause_Vasomotor_Burden_30d`` Calculated Insight inputs.

IMPORTANT — this is a documented *proxy* detector, not a validated device
algorithm. The strongest physiological signal for a hot flash is a peripheral
skin-temperature rise (often preceded by a heart-rate surge and a sympathetic
GSR spike). omh-shim v1.0.1 does not yet carry skin temperature, so production
detection from raw Oura/Empatica streams is Phase 2 of *this* module. What's
implemented here is the detection *logic* — given the excursion features that
a wearable exposes (skin-temp delta, HR delta, time-of-day), classify and
score events — plus the windowed burden aggregation the Care Router consumes.

Detection model (literature-informed thresholds, tunable):

    * A candidate event is a co-occurring skin-temperature rise AND
      heart-rate surge above baseline. The magnitude of the temperature
      excursion sets severity (1 = mild, 2 = moderate, 3 = severe).
    * Events between 22:00 and 06:00 are classified as *night sweats*;
      daytime events are *hot flashes*. Both contribute to burden; night
      events additionally drive sleep disruption (see features_sleep).

Burden score mirrors the Calculated Insight definition exactly:

    burden_score_0_100 = min(100, SUM(severity) / window_days * 100)

so a patient averaging roughly one severity-1 event per day over the window
scores ~100, and the value composes cleanly with the intake-reported burden.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal

VasomotorKind = Literal["hot_flash", "night_sweat"]

# Excursion thresholds for a candidate thermoregulatory event.
SKIN_TEMP_RISE_C = 0.30  # peripheral skin-temp rise above rolling baseline
HR_SURGE_BPM = 8.0  # concurrent heart-rate surge above resting baseline

# Severity cut points on the skin-temperature excursion (degrees C).
_SEVERITY_MODERATE_C = 0.60
_SEVERITY_SEVERE_C = 1.00


class InvalidVasomotorInput(ValueError):
    """Raised when event inputs are not usable for burden computation."""


@dataclass(frozen=True)
class VasomotorEvent:
    """A single detected thermoregulatory event.

    ``hour_of_day`` is the local-time hour [0, 24) used to classify night
    sweats vs. hot flashes. ``severity`` is an integer 1-3.
    """

    hour_of_day: int
    kind: VasomotorKind
    severity: int
    skin_temp_delta_c: float
    hr_delta_bpm: float


def _classify_severity(skin_temp_delta_c: float) -> int:
    if skin_temp_delta_c >= _SEVERITY_SEVERE_C:
        return 3
    if skin_temp_delta_c >= _SEVERITY_MODERATE_C:
        return 2
    return 1


def _is_night(hour_of_day: int) -> bool:
    # Night window 22:00–05:59 inclusive.
    return hour_of_day >= 22 or hour_of_day < 6


def detect_vasomotor_event(
    *,
    hour_of_day: int,
    skin_temp_delta_c: float,
    hr_delta_bpm: float,
) -> VasomotorEvent | None:
    """Classify a single excursion as a vasomotor event, or None if sub-threshold.

    Args:
        hour_of_day: local-time hour in [0, 24).
        skin_temp_delta_c: peripheral skin-temperature rise above baseline (°C).
        hr_delta_bpm: concurrent heart-rate surge above resting baseline (bpm).

    Returns:
        VasomotorEvent when both the temperature and HR criteria are met,
        else None.

    Raises:
        InvalidVasomotorInput: when ``hour_of_day`` is out of range.
    """
    if not 0 <= hour_of_day < 24:
        raise InvalidVasomotorInput(f"hour_of_day {hour_of_day} not in [0, 24)")

    if skin_temp_delta_c < SKIN_TEMP_RISE_C or hr_delta_bpm < HR_SURGE_BPM:
        return None

    kind: VasomotorKind = "night_sweat" if _is_night(hour_of_day) else "hot_flash"
    return VasomotorEvent(
        hour_of_day=hour_of_day,
        kind=kind,
        severity=_classify_severity(skin_temp_delta_c),
        skin_temp_delta_c=float(skin_temp_delta_c),
        hr_delta_bpm=float(hr_delta_bpm),
    )


@dataclass(frozen=True)
class VasomotorBurden:
    """Windowed vasomotor burden — the Pause_Vasomotor_Burden_30d inputs.

    ``burden_score_0_100`` is the primary Care Router metric; ``event_count``
    (= flash_count_30d) is the human-readable count in the rationale.
    """

    window_days: int
    event_count: int
    severity_sum: float
    burden_score_0_100: float
    hot_flash_count: int
    night_sweat_count: int


def vasomotor_burden(
    events: Iterable[VasomotorEvent],
    *,
    window_days: int = 30,
) -> VasomotorBurden:
    """Aggregate detected events into a 0-100 burden score over a window.

    Score definition (matches the Calculated Insight SQL):

        burden_score_0_100 = min(100, SUM(severity) / window_days * 100)

    Args:
        events: detected VasomotorEvents within the window.
        window_days: the burden window (30 for the 30-day CI).

    Returns:
        VasomotorBurden.

    Raises:
        InvalidVasomotorInput: if ``window_days`` is non-positive.
    """
    if window_days <= 0:
        raise InvalidVasomotorInput(f"window_days must be positive (got {window_days})")

    evs = list(events)
    severity_sum = float(sum(e.severity for e in evs))
    raw_score = severity_sum / window_days * 100.0
    burden = min(100.0, raw_score)

    return VasomotorBurden(
        window_days=window_days,
        event_count=len(evs),
        severity_sum=severity_sum,
        burden_score_0_100=burden,
        hot_flash_count=sum(1 for e in evs if e.kind == "hot_flash"),
        night_sweat_count=sum(1 for e in evs if e.kind == "night_sweat"),
    )
