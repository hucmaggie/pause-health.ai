"""Tests for the demo-cohort wearable feature generator.

Verifies determinism, the persona→Contact.Id spine, and that the generated
rows aggregate (via the same arithmetic the Calculated Insights use) into
clinically-ordered, in-range values consistent with each persona's profile.
"""

from __future__ import annotations

from datetime import datetime, timezone

from pause_ingest.cohort import (
    COHORT,
    HRV_WINDOW_DAYS,
    SLEEP_WINDOW_NIGHTS,
    generate_cohort_records,
    generate_persona_records,
)

BASE = datetime(2026, 6, 13, 12, 0, tzinfo=timezone.utc)


def _persona(persona_id: str):
    return next(p for p in COHORT if p.persona_id == persona_id)


def test_cohort_has_six_personas_with_distinct_contact_ids():
    ids = [p.contact_id for p in COHORT]
    assert len(COHORT) == 6
    assert len(set(ids)) == 6
    # Mirrors data-cloud/_mock_path.sql.
    assert _persona("anika-patel").contact_id == "003Hp00003b9bdqIAA"


def test_generation_is_deterministic():
    a = generate_persona_records(_persona("deepa-krishnan"), base=BASE)
    b = generate_persona_records(_persona("deepa-krishnan"), base=BASE)
    assert [r.to_ingest_dict() for r in a] == [r.to_ingest_dict() for r in b]


def test_record_ids_unique():
    records = generate_cohort_records(base=BASE)
    ids = [r.record_id for r in records]
    assert len(ids) == len(set(ids))


def test_every_record_has_known_type_and_patient():
    records = generate_cohort_records(base=BASE)
    valid_types = {"hrv_rmssd", "sleep_session", "hot_flash", "night_sweat"}
    valid_ids = {p.contact_id for p in COHORT}
    for r in records:
        assert r.observation_type in valid_types
        assert r.unified_id in valid_ids
        assert r.value_num >= 0


def test_hrv_window_size_and_range():
    records = generate_persona_records(_persona("anika-patel"), base=BASE)
    hrv = [r for r in records if r.observation_type == "hrv_rmssd"]
    assert len(hrv) == HRV_WINDOW_DAYS
    # Real RMSSD values land in a plausible physiological band.
    assert all(15.0 <= r.value_num <= 90.0 for r in hrv)


def test_sleep_window_size_and_fraction():
    records = generate_persona_records(_persona("brianna-okafor"), base=BASE)
    sleep = [r for r in records if r.observation_type == "sleep_session"]
    assert len(sleep) == SLEEP_WINDOW_NIGHTS
    assert all(0.0 <= r.value_num <= 1.0 for r in sleep)


def _avg_hrv(records) -> float:
    vals = [r.value_num for r in records if r.observation_type == "hrv_rmssd"]
    return sum(vals) / len(vals)


def test_higher_vasomotor_persona_has_lower_hrv():
    # Deepa (vasomotor 9) should have lower average RMSSD than Carmen (vasomotor 2).
    deepa = generate_persona_records(_persona("deepa-krishnan"), base=BASE)
    carmen = generate_persona_records(_persona("carmen-diaz"), base=BASE)
    assert _avg_hrv(deepa) < _avg_hrv(carmen)


def _disrupted_nights(records) -> int:
    return sum(
        1
        for r in records
        if r.observation_type == "sleep_session" and r.value_num < 0.80
    )


def test_higher_sleep_score_persona_has_more_disrupted_nights():
    # Brianna (sleep 8) should have >= disrupted nights vs Carmen (sleep 3).
    brianna = generate_persona_records(_persona("brianna-okafor"), base=BASE)
    carmen = generate_persona_records(_persona("carmen-diaz"), base=BASE)
    assert _disrupted_nights(brianna) >= _disrupted_nights(carmen)


def _vasomotor_event_count(records) -> int:
    return sum(
        1 for r in records if r.observation_type in ("hot_flash", "night_sweat")
    )


def test_vasomotor_event_count_scales_with_score():
    # Anika vasomotor score 7 → ~14 events (matches the prior mock constant).
    anika = generate_persona_records(_persona("anika-patel"), base=BASE)
    assert _vasomotor_event_count(anika) == 14
    # Carmen score 2 → 4 events.
    carmen = generate_persona_records(_persona("carmen-diaz"), base=BASE)
    assert _vasomotor_event_count(carmen) == 4


def test_effective_dates_are_offset_aware_iso():
    records = generate_cohort_records(base=BASE)
    # Every effective_date carries a timezone offset (Data Cloud requires it).
    assert all(("+" in r.effective_date or "Z" in r.effective_date) for r in records)
