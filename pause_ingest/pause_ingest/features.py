"""Feature engineering layer.

Sits between omh-shim normalization and Pause-Health inference. Computes
sliding-window features from raw wearable data so the provider read-path
doesn't have to. Persists features alongside the raw OMH payload inside
JupyterHealth Exchange as additional FHIR Observations so every feature is
traceable to a specific window of raw input.

Two HRV implementations are exposed:

    * ``hrv_features_flirt``: thin wrapper over the FLIRT toolkit
      (https://github.com/im-ethz/flirt). Sliding-window across time, time +
      frequency + statistical domains. Used as the default in production.

    * ``hrv_time_domain_fallback``: a small dependency-light HRV calculator
      ported from the DBDP Heart-Rate-Variability project. Validated
      against Kubios for time-domain metrics. Used when FLIRT is not
      available, when input is too small for a meaningful window, or when
      we need a deterministic reference value in tests.

Both implementations consume the same input: a sequence of inter-beat
intervals (IBI) or RR intervals in MILLISECONDS.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


class InvalidIbiSeries(ValueError):
    """Raised when an IBI input series is not usable for HRV computation."""


def _validate_ibi_ms(ibi_ms: Iterable[float], *, min_samples: int = 5) -> np.ndarray:
    """Validate an IBI series and return it as a 1-D float numpy array.

    Args:
        ibi_ms: inter-beat intervals in milliseconds.
        min_samples: minimum count required to compute anything meaningful.

    Raises:
        InvalidIbiSeries: when the series is empty, too short, or contains
            non-physiological values.
    """
    arr = np.asarray(list(ibi_ms), dtype=float)

    if arr.size == 0:
        raise InvalidIbiSeries("IBI series is empty")
    if arr.size < min_samples:
        raise InvalidIbiSeries(
            f"IBI series has only {arr.size} sample(s); need >= {min_samples}"
        )
    if np.any(np.isnan(arr)):
        raise InvalidIbiSeries("IBI series contains NaN")
    if np.any(arr <= 0):
        raise InvalidIbiSeries("IBI series contains non-positive intervals")
    # Sanity bounds: human HR ~30-220 bpm -> IBI ~270-2000 ms. We allow some
    # slack but anything wildly outside is almost certainly a unit confusion
    # (seconds passed instead of milliseconds, for example).
    if arr.max() > 5000 or arr.min() < 100:
        raise InvalidIbiSeries(
            "IBI values outside the plausible physiological range 100-5000 ms; "
            "did you accidentally pass seconds or a different unit?"
        )
    return arr


# ---------------------------------------------------------------------------
# Fallback time-domain HRV (DBDP-style, validated against Kubios)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HrvTimeDomain:
    """Time-domain HRV metrics. All units explicit in the field names.

    These are the standard time-domain HRV metrics reported in clinical
    literature (Task Force of the European Society of Cardiology et al.,
    Circulation 1996; replicated by DBDP's Kubios validation).
    """

    mean_nn_ms: float
    sdnn_ms: float
    rmssd_ms: float
    nn50_count: int
    pnn50_pct: float
    mean_hr_bpm: float
    sample_count: int


def hrv_time_domain_fallback(ibi_ms: Iterable[float]) -> HrvTimeDomain:
    """Compute time-domain HRV metrics from a series of IBIs (in ms).

    This is a self-contained, dependency-light implementation intended to:

        * Run when FLIRT is unavailable.
        * Provide a deterministic reference for tests.
        * Document precisely how each metric is computed.

    Definitions follow the Task Force (1996) standard:

        * SDNN  = standard deviation of NN intervals
        * RMSSD = root mean square of successive differences
        * NN50  = count of successive differences > 50 ms
        * pNN50 = NN50 / (N - 1)  expressed as a percent

    Args:
        ibi_ms: inter-beat / RR intervals in milliseconds.

    Returns:
        HrvTimeDomain dataclass with the computed metrics.

    Raises:
        InvalidIbiSeries: see ``_validate_ibi_ms``.
    """
    nn = _validate_ibi_ms(ibi_ms)
    diffs = np.diff(nn)

    rmssd = math.sqrt(float(np.mean(diffs * diffs))) if diffs.size > 0 else 0.0
    sdnn = float(np.std(nn, ddof=1))  # ddof=1 to match Kubios (sample stdev)
    nn50_count = int(np.sum(np.abs(diffs) > 50.0))
    pnn50_pct = (nn50_count / diffs.size * 100.0) if diffs.size > 0 else 0.0
    mean_nn = float(np.mean(nn))
    mean_hr = 60000.0 / mean_nn if mean_nn > 0 else 0.0

    return HrvTimeDomain(
        mean_nn_ms=mean_nn,
        sdnn_ms=sdnn,
        rmssd_ms=rmssd,
        nn50_count=nn50_count,
        pnn50_pct=pnn50_pct,
        mean_hr_bpm=mean_hr,
        sample_count=int(nn.size),
    )


# ---------------------------------------------------------------------------
# FLIRT-backed sliding-window HRV
# ---------------------------------------------------------------------------


def hrv_features_flirt(
    ibi_ms: Iterable[float],
    *,
    window_length_sec: int = 180,
    window_step_size_sec: int = 60,
    domains: list[str] | None = None,
    threshold: float = 0.2,
) -> pd.DataFrame:
    """Compute sliding-window HRV features via FLIRT.

    Each row in the returned DataFrame is one window of HRV features. This
    is what we persist to JupyterHealth Exchange alongside the raw IBI
    observations — one FHIR Observation per window per metric, indexed by
    window start time.

    Args:
        ibi_ms: inter-beat intervals in milliseconds. Will be converted to
            the pandas Series shape FLIRT expects (datetime index, ms values).
        window_length_sec: width of the sliding window in seconds.
            FLIRT default is 180.
        window_step_size_sec: hop size of the sliding window in seconds.
            FLIRT default is 1; we use 60 by default to keep the output
            tractable.
        domains: which feature domains to compute. Defaults to time + freq +
            stat. Pass ``["td"]`` for time-domain only (fastest, smallest).
        threshold: fraction of expected IBIs that must be present per window
            before FLIRT processes it. Below this the window is dropped.

    Returns:
        pandas.DataFrame indexed by window start time, columns = feature names.
        Empty DataFrame if the series is too short to fill one window.

    Raises:
        InvalidIbiSeries: see ``_validate_ibi_ms``.
        RuntimeError: if FLIRT is not installed.
    """
    arr = _validate_ibi_ms(ibi_ms, min_samples=2)

    try:
        import flirt.hrv  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "flirt is not installed. Either install with `pip install flirt` "
            "or use hrv_time_domain_fallback instead."
        ) from exc

    # FLIRT wants a pd.Series indexed by datetime. Build a cumulative-time
    # index from the IBIs themselves so the windows align with elapsed time.
    cum_ms = np.cumsum(arr)
    index = pd.to_datetime(cum_ms, unit="ms", origin="unix")
    series = pd.Series(arr, index=index, name="ibi")

    return flirt.hrv.get_hrv_features(
        series,
        window_length=window_length_sec,
        window_step_size=window_step_size_sec,
        domains=list(domains) if domains else ["td", "fd", "stat"],
        threshold=threshold,
        clean_data=True,
        num_cores=1,  # deterministic for tests and small-scale ingest
    )
