"""Verify the activated Calculated Insights return real per-patient values.

The read-back companion to ``examples/data_cloud_push.py`` and Step 6 of the
org-side activation runbook (``docs/PHASE_2_INGESTION_API_RUNBOOK.md``). After
the push + CI refresh, this queries each of the three Calculated Insights for
every demo persona and asserts the returned columns match what the cohort
generator produces (``pause_ingest.expected``) — turning "did the flip work?"
into a deterministic PASS/FAIL instead of the eyeball check.

    # Verify only (CIs already activated + refreshed):
    python -m examples.data_cloud_verify

    # Push first, then verify (allow the CI refresh to run in between):
    python -m examples.data_cloud_verify --push

Reads SF_* from .env exactly like the push. Requires the ``cdp_query_api``
scope on the Connected App (the read path already relies on it). Exit code
0 = every patient matches; 1 = a mismatch, OR the mock is still active (every
patient returns an identical value); 2 = not configured.
"""

from __future__ import annotations

import argparse
import sys

from pause_ingest.cohort import generate_cohort_records
from pause_ingest.data_cloud import (
    DataCloudConfigError,
    DataCloudIngestClient,
    DataCloudIngestConfig,
    DataCloudQueryClient,
    chunked,
)
from pause_ingest.expected import HRV_Z_SD_MS, ExpectedCI, expected_ci_values

# CI API names (Data Cloud appends __cio) — must match the frontend constants
# in frontend/lib/salesforce/data-cloud.ts.
CI_HRV = "Pause_HRV_RMSSD_30d__cio"
CI_VASO = "Pause_Vasomotor_Burden_30d__cio"
CI_SLEEP = "Pause_Sleep_Disruption_7d__cio"


def _first(rows: list[dict]) -> dict | None:
    return rows[0] if rows else None


def _num(row: dict | None, col: str) -> float | None:
    if not row:
        return None
    v = row.get(col)
    return None if v is None else float(v)


def _int(row: dict | None, col: str) -> int | None:
    v = _num(row, col)
    return None if v is None else int(round(v))


def _check_float(
    problems: list[str], uid: str, col: str, actual: float | None, expected: float, tol: float
) -> None:
    if actual is None:
        problems.append(f"{uid}: {col} missing from CI response")
    elif abs(actual - expected) > tol:
        problems.append(
            f"{uid}: {col} = {actual:.4g}, expected ~{expected:.4g} (tol {tol:g})"
        )


def _check_int(
    problems: list[str], uid: str, col: str, actual: int | None, expected: int
) -> None:
    if actual is None:
        problems.append(f"{uid}: {col} missing from CI response")
    elif actual != expected:
        problems.append(f"{uid}: {col} = {actual}, expected {expected}")


def compare_patient(
    exp: ExpectedCI,
    hrv_row: dict | None,
    vaso_row: dict | None,
    sleep_row: dict | None,
    *,
    ms_tol: float = 0.5,
    score_tol: float = 0.5,
) -> list[str]:
    """Diff one patient's live CI rows against the expected aggregates.

    Returns a list of human-readable mismatch strings (empty = all match).
    Counts (window_days, flash_count, disrupted_nights) must match exactly;
    the averaged / derived metrics match within a tolerance because Data Cloud
    computes them in its own float engine.
    """
    problems: list[str] = []

    if hrv_row is None:
        problems.append(f"{exp.unified_id}: no HRV CI row returned")
    else:
        _check_float(problems, exp.unified_id, "hrv_rmssd_ms__c",
                     _num(hrv_row, "hrv_rmssd_ms__c"), exp.hrv_rmssd_ms, ms_tol)
        _check_float(problems, exp.unified_id, "z_score__c",
                     _num(hrv_row, "z_score__c"), exp.z_score, ms_tol / HRV_Z_SD_MS)
        _check_int(problems, exp.unified_id, "window_days__c",
                   _int(hrv_row, "window_days__c"), exp.window_days)

    if vaso_row is None:
        problems.append(f"{exp.unified_id}: no vasomotor CI row returned")
    else:
        _check_float(problems, exp.unified_id, "burden_score_0_100__c",
                     _num(vaso_row, "burden_score_0_100__c"), exp.burden_score_0_100, score_tol)
        _check_int(problems, exp.unified_id, "flash_count_30d__c",
                   _int(vaso_row, "flash_count_30d__c"), exp.flash_count_30d)

    if sleep_row is None:
        problems.append(f"{exp.unified_id}: no sleep CI row returned")
    else:
        _check_float(problems, exp.unified_id, "disruption_index_0_1__c",
                     _num(sleep_row, "disruption_index_0_1__c"), exp.disruption_index_0_1, 0.02)
        _check_int(problems, exp.unified_id, "disrupted_nights__c",
                   _int(sleep_row, "disrupted_nights__c"), exp.disrupted_nights)

    return problems


def constant_mock_warnings(z_scores: list[float], flash_counts: list[int]) -> list[str]:
    """Flag the specific "mock CI still active" failure mode.

    If every patient reports an identical HRV z-score or vasomotor flash count,
    the CI is almost certainly still the ``MAX(constant)`` mock — these vary by
    persona in the real path by construction.
    """
    out: list[str] = []
    if len(z_scores) > 1 and len(set(z_scores)) == 1:
        out.append(
            "All patients returned an identical HRV z-score — the MAX(constant) "
            "mock CI is likely still active (re-do runbook Step 5 for "
            f"{CI_HRV})."
        )
    if len(flash_counts) > 1 and len(set(flash_counts)) == 1:
        out.append(
            "All patients returned an identical vasomotor flash count — the mock "
            f"CI is likely still active ({CI_VASO})."
        )
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--push", action="store_true",
        help="Push the cohort before verifying (allow time for the CI refresh).",
    )
    parser.add_argument("--ms-tol", type=float, default=0.5,
                        help="Absolute tolerance for RMSSD ms (default 0.5).")
    parser.add_argument("--score-tol", type=float, default=0.5,
                        help="Absolute tolerance for burden score (default 0.5).")
    args = parser.parse_args(argv)

    records = generate_cohort_records()
    expected = expected_ci_values(records)

    try:
        config = DataCloudIngestConfig.from_env()
    except DataCloudConfigError as exc:
        print(f"Not configured for a live verify: {exc}", file=sys.stderr)
        return 2

    if args.push:
        ingest = DataCloudIngestClient(config)
        total = 0
        for batch in chunked(records, size=200):
            total += ingest.ingest(batch).get("accepted", 0)
        print(
            f"Pushed {total} records. NOTE: the CIs refresh on a schedule — run a "
            "manual refresh (or wait) before trusting the read-back below.\n"
        )

    q = DataCloudQueryClient(config)
    problems: list[str] = []
    z_scores: list[float] = []
    flash_counts: list[int] = []

    print(f"Verifying {len(expected)} patients against 3 Calculated Insights\n")
    print(f"{'unified_id':<22} {'hrv_z':>8} {'burden':>8} {'flashes':>8} {'disr_n':>7}  status")
    print("-" * 68)

    for uid, exp in expected.items():
        f = f"[unified_id__c={uid}]"
        hrv = _first(q.query_calculated_insight(CI_HRV, f))
        vaso = _first(q.query_calculated_insight(CI_VASO, f))
        sleep = _first(q.query_calculated_insight(CI_SLEEP, f))

        patient_problems = compare_patient(
            exp, hrv, vaso, sleep, ms_tol=args.ms_tol, score_tol=args.score_tol
        )
        problems += patient_problems

        z = _num(hrv, "z_score__c")
        flash = _int(vaso, "flash_count_30d__c")
        if z is not None:
            z_scores.append(z)
        if flash is not None:
            flash_counts.append(flash)

        z_disp = f"{z:.2f}" if z is not None else "—"
        b_disp = _num(vaso, "burden_score_0_100__c")
        b_disp = f"{b_disp:.1f}" if b_disp is not None else "—"
        f_disp = str(flash) if flash is not None else "—"
        d_disp = _int(sleep, "disrupted_nights__c")
        d_disp = str(d_disp) if d_disp is not None else "—"
        print(
            f"{uid:<22} {z_disp:>8} {b_disp:>8} {f_disp:>8} {d_disp:>7}  "
            f"{'OK' if not patient_problems else 'FAIL'}"
        )

    problems += constant_mock_warnings(z_scores, flash_counts)

    if problems:
        print("\nFAILURES:")
        for p in problems:
            print(f"  - {p}")
        print(f"\n{len(problems)} problem(s) — the CI activation is NOT verified.")
        return 1

    print(
        "\nAll patients match the expected DBDP-derived values. The Calculated "
        "Insights are real, not the MAX(constant) mock."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
