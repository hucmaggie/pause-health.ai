"""Expected Calculated Insight read-back values for the demo cohort.

Independently recomputes, in Python, the per-patient aggregates the three
activated Calculated Insights should return — using the SAME formulas as the
committed CI SQL (``data-cloud/Pause_*.sql``). ``examples/data_cloud_verify.py``
reads the live CIs back and asserts they match these, proving the activation
swapped the ``MAX(constant)`` mock for real DBDP-derived math.

This is deliberately a THIRD, independent encoding of the CI formulas (the
others being the CI SQL and the frontend read path). The verifier's entire job
is to catch a mismatch between what the org computes and what the math says it
should — so do NOT try to "DRY" this against the SQL; the redundancy is the
check.

Formula sources (keep in lockstep with the SQL):
  - Pause_HRV_RMSSD_30d.sql        hrv_rmssd_ms = AVG(value_num);
                                   z_score = (hrv_rmssd_ms - 42.0) / 12.0;
                                   window_days = COUNT(value_num)
  - Pause_Vasomotor_Burden_30d.sql burden = SUM(severity) / 30 * 100;
                                   flash_count_30d = COUNT(*)
  - Pause_Sleep_Disruption_7d.sql  disrupted = COUNT(efficiency < 0.80);
                                   disruption_index = disrupted / 7
"""

from __future__ import annotations

from dataclasses import dataclass

from .cohort import SLEEP_WINDOW_NIGHTS, VASOMOTOR_WINDOW_DAYS
from .data_cloud import WearableFeatureRecord

# z-score anchor — must match data-cloud/Pause_HRV_RMSSD_30d.sql.
HRV_Z_MEAN_MS = 42.0
HRV_Z_SD_MS = 12.0
# disruption threshold — must match data-cloud/Pause_Sleep_Disruption_7d.sql.
SLEEP_DISRUPTION_EFFICIENCY = 0.80


@dataclass(frozen=True)
class ExpectedCI:
    """The columns the three CIs emit for one patient (keyed by unified_id__c)."""

    unified_id: str
    # Pause_HRV_RMSSD_30d
    hrv_rmssd_ms: float
    z_score: float
    window_days: int
    # Pause_Vasomotor_Burden_30d
    burden_score_0_100: float
    flash_count_30d: int
    # Pause_Sleep_Disruption_7d
    disruption_index_0_1: float
    disrupted_nights: int


def expected_ci_values(
    records: list[WearableFeatureRecord],
) -> dict[str, ExpectedCI]:
    """Aggregate pushed rows into expected CI outputs, per ``unified_id``.

    Mirrors each CI's ``GROUP BY unified_id__c`` aggregation exactly. The push
    owns the window (slot-stable rows), so — like the CIs — this applies no
    date filter; it just aggregates whatever rows the cohort emits.
    """
    by_patient: dict[str, list[WearableFeatureRecord]] = {}
    for r in records:
        by_patient.setdefault(r.unified_id, []).append(r)

    out: dict[str, ExpectedCI] = {}
    for uid, rows in by_patient.items():
        hrv = [r.value_num for r in rows if r.observation_type == "hrv_rmssd"]
        sleep = [r.value_num for r in rows if r.observation_type == "sleep_session"]
        vaso = [
            r.value_num
            for r in rows
            if r.observation_type in ("hot_flash", "night_sweat")
        ]

        hrv_mean = sum(hrv) / len(hrv) if hrv else 0.0
        disrupted = sum(1 for e in sleep if e < SLEEP_DISRUPTION_EFFICIENCY)
        severity_sum = sum(vaso)

        out[uid] = ExpectedCI(
            unified_id=uid,
            hrv_rmssd_ms=hrv_mean,
            z_score=(hrv_mean - HRV_Z_MEAN_MS) / HRV_Z_SD_MS,
            window_days=len(hrv),
            burden_score_0_100=severity_sum / VASOMOTOR_WINDOW_DAYS * 100.0,
            flash_count_30d=len(vaso),
            disruption_index_0_1=disrupted / SLEEP_WINDOW_NIGHTS,
            disrupted_nights=disrupted,
        )
    return out
