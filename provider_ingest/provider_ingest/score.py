"""graphScore — the Pause provider-relevance ranking signal.

Replaces the hand-assigned static `graphScore` floats in the mock directory
with a deterministic, explainable score in [0, 1]. The directory sorts
descending by this value, so it controls who surfaces first for a patient.

Composition (weights sum to 1.0 before the multiplicative boosts):

    relevance       0.55  — taxonomy centrality to menopause care (taxonomy.py)
    accepting       0.20  — accepting new patients (actionable today)
    telehealth      0.15  — telehealth (access for remote / rural patients)
    completeness    0.10  — has city/state/zip (a proxy for a usable record)

Multiplicative boosts (applied in order, then clamp to 1.0):

    × (1.0 + 0.15)                    if MSCP-certified
    × (1.0 + 0.02 × signals)          per service-line signal, capped at +5%

The signal boost is bounded so a non-certified provider with a long signal
list still falls behind a certified provider with the same baseline — the
binary credential is the stronger evidence; signals are corroborating.

NPPES has no "accepting new patients" or "telehealth" field, so those two are
derived deterministically from the NPI (documented in nppes.py). On a real
feed with those attributes, pass the true booleans and the score is real.
"""

from __future__ import annotations

W_RELEVANCE = 0.55
W_ACCEPTING = 0.20
W_TELEHEALTH = 0.15
W_COMPLETENESS = 0.10

MSCP_BOOST = 0.15
SIGNAL_BOOST_PER = 0.02
SIGNAL_BOOST_MAX = 0.05


def graph_score(
    *,
    relevance: float,
    accepting_new_patients: bool,
    telehealth: bool,
    has_location: bool,
    menopause_certified: bool,
    service_signal_count: int = 0,
) -> float:
    """Compute the provider-relevance score in [0, 1]."""
    base = (
        W_RELEVANCE * _clamp01(relevance)
        + W_ACCEPTING * (1.0 if accepting_new_patients else 0.0)
        + W_TELEHEALTH * (1.0 if telehealth else 0.0)
        + W_COMPLETENESS * (1.0 if has_location else 0.0)
    )
    if menopause_certified:
        base *= 1.0 + MSCP_BOOST
    if service_signal_count > 0:
        base *= 1.0 + min(SIGNAL_BOOST_MAX, SIGNAL_BOOST_PER * service_signal_count)
    return round(min(1.0, base), 4)


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))
