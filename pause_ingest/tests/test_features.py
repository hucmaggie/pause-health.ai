"""Tests for the feature engineering layer (pause_ingest.features).

Two HRV implementations are exercised:
  * ``hrv_time_domain_fallback``: small, deterministic, math-checkable.
  * ``hrv_features_flirt``: the DBDP/FLIRT-backed sliding-window pipeline.

Plus a stub-status test for the Empatica E4 ingest path.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from pause_ingest.empatica import EmpaticaIngestNotImplemented, ingest_empatica_e4_zip
from pause_ingest.features import (
    HrvTimeDomain,
    InvalidIbiSeries,
    hrv_features_flirt,
    hrv_time_domain_fallback,
)

FIXTURES = Path(__file__).parent.parent / "examples" / "fixtures"


# ---------------------------------------------------------------------------
# Synthetic generators
# ---------------------------------------------------------------------------


def _constant_ibi(beats: int, value_ms: float) -> list[float]:
    return [float(value_ms)] * beats


def _alternating_ibi(beats: int, low: float, high: float) -> list[float]:
    """Strict alternation, useful because RMSSD has a closed-form expectation."""
    out: list[float] = []
    for i in range(beats):
        out.append(low if i % 2 == 0 else high)
    return out


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


def test_fallback_rejects_empty_series():
    with pytest.raises(InvalidIbiSeries):
        hrv_time_domain_fallback([])


def test_fallback_rejects_too_short_series():
    with pytest.raises(InvalidIbiSeries):
        hrv_time_domain_fallback([800.0, 805.0])


def test_fallback_rejects_negative_values():
    with pytest.raises(InvalidIbiSeries):
        hrv_time_domain_fallback([800, 805, -50, 810, 815])


def test_fallback_rejects_implausible_units():
    """Catches the classic 'seconds vs milliseconds' bug at the boundary."""
    with pytest.raises(InvalidIbiSeries):
        hrv_time_domain_fallback([0.8, 0.81, 0.82, 0.79, 0.78])


# ---------------------------------------------------------------------------
# Fallback HRV correctness
# ---------------------------------------------------------------------------


def test_fallback_constant_ibi_has_zero_variability():
    """A perfectly constant IBI series has SDNN = RMSSD = 0."""
    result = hrv_time_domain_fallback(_constant_ibi(60, 800))
    assert isinstance(result, HrvTimeDomain)
    assert result.sample_count == 60
    assert result.mean_nn_ms == pytest.approx(800.0)
    assert result.sdnn_ms == pytest.approx(0.0, abs=1e-9)
    assert result.rmssd_ms == pytest.approx(0.0, abs=1e-9)
    assert result.nn50_count == 0
    assert result.pnn50_pct == pytest.approx(0.0)
    assert result.mean_hr_bpm == pytest.approx(75.0)


def test_fallback_alternating_ibi_has_closed_form_rmssd():
    """For strict alternation low/high/low/high, RMSSD == |high - low|.

    All N-1 successive differences are exactly +/-(high - low), so the mean
    square is (high-low)**2 and sqrt of that is |high-low|.
    """
    diff = 100.0
    series = _alternating_ibi(40, 800.0, 800.0 + diff)
    result = hrv_time_domain_fallback(series)
    assert result.rmssd_ms == pytest.approx(diff, rel=1e-9)
    # Every consecutive diff exceeds the 50 ms NN50 threshold.
    assert result.nn50_count == 39
    assert result.pnn50_pct == pytest.approx(100.0)


def test_fallback_pnn50_counts_only_diffs_above_threshold():
    """Differences <= 50 ms must not contribute to NN50."""
    # 10 IBIs alternating by exactly 40 ms (under the 50 ms threshold).
    series = _alternating_ibi(10, 800.0, 840.0)
    result = hrv_time_domain_fallback(series)
    assert result.nn50_count == 0
    assert result.pnn50_pct == pytest.approx(0.0)


def test_fallback_mean_hr_matches_mean_ibi():
    """Mean HR (bpm) must equal 60000 / mean(IBI in ms) exactly."""
    series = _constant_ibi(30, 1000.0)
    result = hrv_time_domain_fallback(series)
    assert result.mean_hr_bpm == pytest.approx(60.0)


# ---------------------------------------------------------------------------
# DHDR-style fixture: real-shape data
# ---------------------------------------------------------------------------


def test_fallback_runs_on_dhdr_style_fixture():
    """The committed CSV fixture should produce physiologically plausible HRV."""
    df = pd.read_csv(FIXTURES / "dhdr_ibi_sample.csv")
    result = hrv_time_domain_fallback(df["ibi_ms"].tolist())

    assert result.sample_count == len(df)
    # Resting HR for a healthy adult typically falls in 50-90 bpm.
    assert 50 < result.mean_hr_bpm < 90
    # RMSSD for healthy adults is typically 15-100 ms; loose bounds are fine.
    assert 5 < result.rmssd_ms < 200
    assert result.sdnn_ms > 0


# ---------------------------------------------------------------------------
# FLIRT-backed sliding-window HRV
# ---------------------------------------------------------------------------


def test_flirt_returns_dataframe_on_long_enough_series():
    """A 5-minute synthetic series should yield at least one HRV window.

    We pad with low-amplitude noise so FLIRT's data-cleaning step doesn't
    consider every sample identical and drop windows.
    """
    rng = np.random.default_rng(seed=42)
    # ~5 min at 75 bpm => 800 ms * 375 beats ~= 300 sec.
    series = (800.0 + rng.normal(0.0, 30.0, size=400)).clip(min=400, max=1500)

    out = hrv_features_flirt(
        series.tolist(),
        window_length_sec=60,
        window_step_size_sec=60,
        domains=["td"],
        threshold=0.2,
    )
    assert isinstance(out, pd.DataFrame)
    # At least one window of features should land.
    assert len(out) >= 1
    # FLIRT 0.0.2 prefixes time-domain HRV columns with "hrv_". The docstring
    # example shows the bare names but the shipped library uses the prefix —
    # asserting against the real columns is correct.
    assert "hrv_rmssd" in out.columns
    assert "hrv_sdnn" in out.columns
    # And the values should be finite and positive for noisy real-ish data.
    assert (out["hrv_rmssd"].dropna() > 0).all()
    assert (out["hrv_sdnn"].dropna() > 0).all()


def test_flirt_raises_for_invalid_input():
    with pytest.raises(InvalidIbiSeries):
        hrv_features_flirt([])


# ---------------------------------------------------------------------------
# Empatica E4 ingestion: status-only test
# ---------------------------------------------------------------------------


def test_empatica_ingestion_raises_phase2_error():
    """Phase 2 stub must fail loud, not silent."""
    with pytest.raises(EmpaticaIngestNotImplemented):
        ingest_empatica_e4_zip("/tmp/does-not-exist.zip")
