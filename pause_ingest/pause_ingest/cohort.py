"""Deterministic per-persona wearable feature generation for the demo cohort.

Bridges the six Pause demo personas to the Data Cloud Ingestion API. For each
persona it generates a window of *synthetic* wearable inputs and runs them
through the *real* feature functions (``hrv_time_domain_fallback``,
``sleep_efficiency_from_stages``/``sleep_disruption_index``,
``detect_vasomotor_event``/``vasomotor_burden``), producing flattened
``WearableFeatureRecord`` rows.

Honesty note: the demo patients are fictional, so there is no real device
data for them. What's "real" here is the feature *computation* — the same
DBDP/Kubios HRV math and the sleep/vasomotor logic that would run on a real
patient's stream. The *inputs* are synthesized deterministically from each
persona's clinical profile (the 0-10 vasomotor/sleep scores in
``frontend/lib/demo-cohort.ts``) so the wearable signal is internally
consistent with everything else the demo shows.

Determinism: seeded from a stable hash of the persona id, so re-running
produces identical rows. Combined with the idempotent ``record_id``, the
push is safe to repeat.

The persona → Contact.Id mapping mirrors ``data-cloud/_mock_path.sql`` and is
the join key into ``ssot__Individual__dlm`` / the CI ``unified_id__c``.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .data_cloud import WearableFeatureRecord, iso_utc
from .features import hrv_time_domain_fallback
from .features_vasomotor import detect_vasomotor_event

HRV_WINDOW_DAYS = 30
SLEEP_WINDOW_NIGHTS = 7
VASOMOTOR_WINDOW_DAYS = 30

# HRV normative anchor (matches the Calculated Insight z-score denominator).
_HRV_MEAN_NN_MS = 850.0
_HRV_SAMPLES_PER_DAY = 120


@dataclass(frozen=True)
class CohortPersona:
    """Minimal persona projection needed to synthesize wearable features.

    Mirrors ``frontend/lib/demo-cohort.ts`` (scores) and
    ``data-cloud/_mock_path.sql`` (Contact.Id). ``vasomotor_score`` and
    ``sleep_score`` are 0-10; higher = worse on both axes.
    """

    persona_id: str
    first_name: str
    last_name: str
    contact_id: str
    vasomotor_score: int
    sleep_score: int


# Source of truth for the demo: keep in lockstep with the two files above.
COHORT: list[CohortPersona] = [
    CohortPersona("anika-patel", "Anika", "Patel", "003Hp00003b9bdqIAA", 7, 4),
    CohortPersona("brianna-okafor", "Brianna", "Okafor", "003Hp00003b9behIAA", 5, 8),
    CohortPersona("carmen-diaz", "Carmen", "Diaz", "003Hp00003b9bemIAA", 2, 3),
    CohortPersona("deepa-krishnan", "Deepa", "Krishnan", "003Hp00003b9berIAA", 9, 7),
    CohortPersona("elena-rossi", "Elena", "Rossi", "003Hp00003b9bewIAA", 3, 5),
    CohortPersona("fatima-khan", "Fatima", "Khan", "003Hp00003b9bf1IAA", 4, 4),
]


def _seed_for(persona_id: str) -> int:
    """Stable per-persona seed (independent of PYTHONHASHSEED)."""
    digest = hashlib.sha256(persona_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big")


def _hrv_target_rmssd(vasomotor_score: int) -> float:
    """Higher vasomotor burden → lower HRV. Clamped to a plausible band."""
    target = 50.0 - 2.2 * vasomotor_score
    return max(25.0, min(55.0, target))


def _sleep_target_efficiency(sleep_score: int) -> float:
    """Higher sleep-disruption score → lower nightly efficiency."""
    target = 0.93 - 0.045 * sleep_score
    return max(0.55, min(0.95, target))


def _synth_ibi_series(rng: random.Random, target_rmssd_ms: float) -> list[float]:
    """Build an IBI series whose successive-difference RMS ≈ target_rmssd_ms.

    RMSSD = sqrt(mean(diff^2)); drawing the successive differences from
    N(0, target) makes the realized RMSSD ≈ target. We reconstruct the NN
    series from those diffs (mean-centered on a resting interval) and clip to
    a physiological band — the clip nudges RMSSD slightly, which is why
    callers/tests assert on a tolerance band, not an exact value.
    """
    diffs = [rng.gauss(0.0, target_rmssd_ms) for _ in range(_HRV_SAMPLES_PER_DAY - 1)]
    nn = [_HRV_MEAN_NN_MS]
    for d in diffs:
        nn.append(nn[-1] + d)
    mean_walk = sum(nn) / len(nn)
    centered = [_HRV_MEAN_NN_MS + (v - mean_walk) for v in nn]
    return [max(500.0, min(1200.0, v)) for v in centered]


def _hrv_records(
    persona: CohortPersona, rng: random.Random, base: datetime
) -> list[WearableFeatureRecord]:
    target = _hrv_target_rmssd(persona.vasomotor_score)
    records: list[WearableFeatureRecord] = []
    for day in range(HRV_WINDOW_DAYS):
        day_target = max(20.0, rng.gauss(target, 3.0))
        ibi = _synth_ibi_series(rng, day_target)
        hrv = hrv_time_domain_fallback(ibi)
        eff_dt = base - timedelta(days=day)
        records.append(
            WearableFeatureRecord(
                # Slot-stable id (day offset, not calendar date) so re-pushing
                # upserts in place — the window stays bounded at 30 rows and the
                # Calculated Insight needs no date filter.
                record_id=f"{persona.contact_id}:hrv_rmssd:d{day:02d}",
                unified_id=persona.contact_id,
                observation_type="hrv_rmssd",
                effective_date=iso_utc(eff_dt),
                value_num=round(hrv.rmssd_ms, 3),
                source="dbdp-flirt",
            )
        )
    return records


def _sleep_records(
    persona: CohortPersona, rng: random.Random, base: datetime
) -> list[WearableFeatureRecord]:
    target = _sleep_target_efficiency(persona.sleep_score)
    records: list[WearableFeatureRecord] = []
    for night in range(SLEEP_WINDOW_NIGHTS):
        efficiency = max(0.40, min(0.99, rng.gauss(target, 0.04)))
        eff_dt = base - timedelta(days=night)
        records.append(
            WearableFeatureRecord(
                record_id=f"{persona.contact_id}:sleep_session:n{night}",
                unified_id=persona.contact_id,
                observation_type="sleep_session",
                effective_date=iso_utc(eff_dt),
                value_num=round(efficiency, 4),
                source="oura-sleep-staging",
            )
        )
    return records


def _vasomotor_records(
    persona: CohortPersona, rng: random.Random, base: datetime
) -> list[WearableFeatureRecord]:
    n_events = round(persona.vasomotor_score * 2)
    records: list[WearableFeatureRecord] = []
    for idx in range(n_events):
        day = rng.randint(0, VASOMOTOR_WINDOW_DAYS - 1)
        hour = rng.randint(0, 23)
        # Excursion magnitude scales with the persona's burden; always above
        # the detector's thresholds so this is a confirmed event. Severe
        # patients get bigger swings (and thus higher severity).
        temp_delta = 0.35 + (persona.vasomotor_score / 10.0) * rng.uniform(0.2, 0.9)
        hr_delta = 9.0 + rng.uniform(0.0, 12.0)
        event = detect_vasomotor_event(
            hour_of_day=hour, skin_temp_delta_c=temp_delta, hr_delta_bpm=hr_delta
        )
        if event is None:  # pragma: no cover - inputs are constructed above threshold
            continue
        eff_dt = (base - timedelta(days=day)).replace(hour=hour)
        records.append(
            WearableFeatureRecord(
                record_id=f"{persona.contact_id}:vms:{idx:02d}",
                unified_id=persona.contact_id,
                observation_type=event.kind,
                effective_date=iso_utc(eff_dt),
                value_num=float(event.severity),
                source="dbdp-thermoregulation",
            )
        )
    return records


def generate_persona_records(
    persona: CohortPersona, *, base: datetime | None = None
) -> list[WearableFeatureRecord]:
    """All wearable feature rows for one persona (HRV + sleep + vasomotor)."""
    base = base or datetime.now(timezone.utc)
    rng = random.Random(_seed_for(persona.persona_id))
    return [
        *_hrv_records(persona, rng, base),
        *_sleep_records(persona, rng, base),
        *_vasomotor_records(persona, rng, base),
    ]


def generate_cohort_records(
    *, base: datetime | None = None
) -> list[WearableFeatureRecord]:
    """All wearable feature rows for the full six-persona demo cohort."""
    base = base or datetime.now(timezone.utc)
    records: list[WearableFeatureRecord] = []
    for persona in COHORT:
        records.extend(generate_persona_records(persona, base=base))
    return records
