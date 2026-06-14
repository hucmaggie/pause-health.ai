"""Sleep-architecture feature engineering.

Companion to ``features.py`` (HRV). Computes sleep efficiency and a
menopause-oriented sleep-disruption index from staged sleep sessions.

The Care Router treats sleep disruption as a triage signal: perimenopausal
sleep fragmentation (driven by night sweats / vasomotor events) is one of
the most common drivers of a "needs clinical contact soon" routing
decision. This module turns nightly sleep staging into the
``Pause_Sleep_Disruption_7d`` Calculated Insight inputs.

Definitions (clinical sleep-medicine standard):

    * Sleep efficiency = total sleep time / time in bed, expressed as a
      fraction in [0, 1]. Healthy adults run ~0.85+; below ~0.80 is the
      conventional threshold for "poor" sleep.
    * A *disrupted night* is one whose efficiency falls below a threshold
      (default 0.80). The disruption index over a window is the fraction of
      nights that were disrupted.

Inputs are explicit minute counts per stage so the computation is
device-agnostic — Oura, Apple Watch, and Empatica all reduce to
time-in-bed + asleep/awake minutes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

# Conventional sleep-medicine threshold for "poor" sleep efficiency.
DEFAULT_EFFICIENCY_THRESHOLD = 0.80


class InvalidSleepSession(ValueError):
    """Raised when a sleep session's minute counts are not physiologically usable."""


@dataclass(frozen=True)
class SleepEfficiency:
    """Per-night sleep efficiency. All durations in minutes.

    ``efficiency`` is the fraction of time-in-bed actually spent asleep
    (light + deep + REM). ``awakenings`` is the count of wake episodes if
    the source device reports it (0 when unknown).
    """

    time_in_bed_min: float
    total_sleep_min: float
    awake_min: float
    efficiency: float  # 0..1
    awakenings: int


def sleep_efficiency_from_stages(
    *,
    light_min: float,
    deep_min: float,
    rem_min: float,
    awake_min: float,
    awakenings: int = 0,
) -> SleepEfficiency:
    """Compute sleep efficiency from per-stage minute counts.

    Args:
        light_min / deep_min / rem_min: minutes in each asleep stage.
        awake_min: minutes awake while in bed.
        awakenings: optional count of distinct wake episodes.

    Returns:
        SleepEfficiency with ``efficiency`` in [0, 1].

    Raises:
        InvalidSleepSession: on negative inputs, an empty session, or a
            time-in-bed so short it can't represent a real night.
    """
    stages = {
        "light_min": light_min,
        "deep_min": deep_min,
        "rem_min": rem_min,
        "awake_min": awake_min,
    }
    for name, value in stages.items():
        if value < 0:
            raise InvalidSleepSession(f"{name} is negative ({value})")
    if awakenings < 0:
        raise InvalidSleepSession(f"awakenings is negative ({awakenings})")

    total_sleep = float(light_min + deep_min + rem_min)
    time_in_bed = total_sleep + float(awake_min)

    if time_in_bed <= 0:
        raise InvalidSleepSession("time in bed is zero — no session to score")
    # A real overnight session is at least ~1 hour in bed. Anything shorter
    # is almost certainly a nap or a truncated/garbage record; scoring it as
    # a "night" would pollute the disruption index.
    if time_in_bed < 60:
        raise InvalidSleepSession(
            f"time in bed {time_in_bed:.0f} min < 60 min; not a scorable night "
            "(nap or truncated record?)"
        )

    efficiency = total_sleep / time_in_bed

    return SleepEfficiency(
        time_in_bed_min=time_in_bed,
        total_sleep_min=total_sleep,
        awake_min=float(awake_min),
        efficiency=efficiency,
        awakenings=int(awakenings),
    )


def is_disrupted_night(
    efficiency: float,
    *,
    threshold: float = DEFAULT_EFFICIENCY_THRESHOLD,
) -> bool:
    """True when a night's efficiency falls below the disruption threshold."""
    if not 0.0 <= efficiency <= 1.0:
        raise InvalidSleepSession(
            f"efficiency {efficiency} is outside [0, 1] — wrong units?"
        )
    return efficiency < threshold


@dataclass(frozen=True)
class SleepDisruption:
    """Windowed sleep-disruption summary — the Pause_Sleep_Disruption_7d inputs.

    ``disruption_index`` is ``disrupted_nights / window_nights`` clamped to
    [0, 1]. It is the primary metric the Care Router reads; ``disrupted_nights``
    is the human-readable count surfaced in the rationale.
    """

    window_nights: int
    nights_observed: int
    disrupted_nights: int
    disruption_index: float  # 0..1


def sleep_disruption_index(
    efficiencies: Iterable[float],
    *,
    threshold: float = DEFAULT_EFFICIENCY_THRESHOLD,
    window_nights: int = 7,
) -> SleepDisruption:
    """Summarize a window of nightly efficiencies into a disruption index.

    The index denominator is ``window_nights`` (not the number of nights
    actually observed) so a patient who only synced 3 of 7 nights doesn't
    look artificially disrupted — missing nights count as non-disrupted.
    This matches the Calculated Insight ``SUM(... < 0.80) / 7.0``.

    Args:
        efficiencies: nightly sleep-efficiency fractions in [0, 1].
        threshold: efficiency below which a night counts as disrupted.
        window_nights: the routing window (7 for the 7-day CI).

    Returns:
        SleepDisruption.

    Raises:
        InvalidSleepSession: if ``window_nights`` is non-positive or more
            nights were supplied than the window can hold.
    """
    if window_nights <= 0:
        raise InvalidSleepSession(f"window_nights must be positive (got {window_nights})")

    effs = list(efficiencies)
    if len(effs) > window_nights:
        raise InvalidSleepSession(
            f"got {len(effs)} nights but window is only {window_nights}"
        )

    disrupted = sum(1 for e in effs if is_disrupted_night(e, threshold=threshold))
    index = disrupted / window_nights

    return SleepDisruption(
        window_nights=window_nights,
        nights_observed=len(effs),
        disrupted_nights=disrupted,
        disruption_index=index,
    )
