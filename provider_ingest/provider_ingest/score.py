"""graphScore — the Pause provider-relevance ranking signal.

Replaces the hand-assigned static `graphScore` floats in the mock directory
with a deterministic, explainable score in [0, 1]. The directory sorts
descending by this value, so it controls who surfaces first for a patient.

Composition (weights sum to 1.0 before the certification multiplier):

    relevance       0.55  — taxonomy centrality to menopause care (taxonomy.py)
    accepting       0.20  — accepting new patients (actionable today)
    telehealth      0.15  — telehealth (access for remote / rural patients)
    completeness    0.10  — has city/state/zip (a proxy for a usable record)

    × (1.0 + 0.15 if MSCP-certified)  then clamp to 1.0

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


def graph_score(
    *,
    relevance: float,
    accepting_new_patients: bool,
    telehealth: bool,
    has_location: bool,
    menopause_certified: bool,
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
    return round(min(1.0, base), 4)


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))
