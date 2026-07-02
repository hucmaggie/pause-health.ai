"""Preflight "doctor" for the org-side Calculated Insight activation.

The runbook (``docs/PHASE_2_INGESTION_API_RUNBOOK.md``) is a sequence of manual
Data Cloud UI clicks. This script can't click them for you — but it probes the
org and reports which steps have actually taken effect, so you're never
clicking blind and can confirm each stage before moving on. It brackets the
manual work: run it before you start and between steps; when it says
"ready to verify", run ``examples.data_cloud_verify``.

    python -m examples.data_cloud_preflight

What it checks (maps to runbook steps):
  - Step 1     — client_credentials + a360 token exchange succeed (creds +
                 Data Cloud enabled). Can't see the cdp_ingest_api scope
                 directly; a failed push in Step 4 is what reveals that.
  - Steps 2-3  — the Pause_Wearable_Feature__dlm DMO exists and is queryable.
  - Step 4     — the DMO holds pushed rows.
  - Step 5     — all three Calculated Insights are reachable by API name.

Reads SF_* from .env like the push/verify. Requires cdp_query_api. Exit code
0 = everything wired and ready to verify; 1 = one or more steps still to do;
2 = not configured.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass

from pause_ingest.cohort import COHORT
from pause_ingest.data_cloud import (
    DataCloudConfigError,
    DataCloudIngestConfig,
    DataCloudQueryClient,
)
from examples.data_cloud_verify import CI_HRV, CI_SLEEP, CI_VASO

DMO = "Pause_Wearable_Feature__dlm"


@dataclass(frozen=True)
class StepCheck:
    """One runbook step's assessed state. ok: True=done, False=todo, None=blocked/unknown."""

    step: str
    ok: bool | None
    detail: str


def assess(
    *,
    auth_ok: bool,
    auth_detail: str,
    dmo_state: str,
    dmo_detail: str,
    ci_states: dict[str, str],
) -> list[StepCheck]:
    """Pure classification of probe results into per-step statuses.

    dmo_state ∈ {"data", "empty", "error"}; ci_states values ∈
    {"rows", "empty", "missing"}. Kept free of I/O so it's unit-testable.
    """
    if not auth_ok:
        blocked = "skipped — resolve the token exchange first."
        return [
            StepCheck(
                "Step 1: Connected App + Data Cloud token exchange",
                False,
                f"token exchange failed: {auth_detail}. Confirm the External "
                "Client App carries cdp_query_api + cdp_ingest_api and the org "
                "has Data Cloud enabled.",
            ),
            StepCheck(f"Steps 2-3: {DMO} DMO", None, blocked),
            StepCheck("Step 4: wearable feature rows pushed", None, blocked),
            StepCheck("Step 5: Calculated Insights reachable", None, blocked),
        ]

    checks = [
        StepCheck(
            "Step 1: Connected App + Data Cloud token exchange",
            True,
            "client_credentials + a360 exchange succeeded. (This can't confirm "
            "the cdp_ingest_api scope specifically — a failed push in Step 4 is "
            "what reveals a missing ingest scope.)",
        )
    ]

    if dmo_state == "error":
        checks.append(
            StepCheck(
                f"Steps 2-3: {DMO} DMO",
                False,
                f"DMO not queryable: {dmo_detail}. Create the Ingestion API data "
                "stream (Step 2) and map the DLO to " + DMO + " (Step 3).",
            )
        )
        checks.append(
            StepCheck("Step 4: wearable feature rows pushed", None,
                      "blocked — create the DMO first.")
        )
    else:
        checks.append(StepCheck(f"Steps 2-3: {DMO} DMO", True, "DMO exists and is queryable."))
        if dmo_state == "data":
            checks.append(StepCheck("Step 4: wearable feature rows pushed", True, "DMO holds rows."))
        else:  # empty
            checks.append(
                StepCheck(
                    "Step 4: wearable feature rows pushed",
                    False,
                    "DMO exists but returned 0 rows — run "
                    "`python -m examples.data_cloud_push` (Step 4); allow a few "
                    "minutes for ingestion to surface.",
                )
            )

    missing = [n for n, s in ci_states.items() if s == "missing"]
    if not ci_states:
        checks.append(StepCheck("Step 5: Calculated Insights reachable", None, "not probed."))
    elif missing:
        checks.append(
            StepCheck(
                "Step 5: Calculated Insights reachable",
                False,
                f"not reachable by API name: {', '.join(missing)}. Create + "
                "activate each CI (Step 5), keeping the Developer Names exact.",
            )
        )
    else:
        empties = [n for n, s in ci_states.items() if s == "empty"]
        detail = "all three CIs reachable."
        if empties:
            detail += (
                f" No row yet for the probe patient in: {', '.join(empties)} "
                "(push + refresh, or the CI hasn't recomputed)."
            )
        checks.append(StepCheck("Step 5: Calculated Insights reachable", True, detail))

    return checks


def ready_to_verify(checks: list[StepCheck]) -> bool:
    """True only when every step is done (so data_cloud_verify is meaningful)."""
    return all(c.ok is True for c in checks)


def _probe_dmo(q: DataCloudQueryClient) -> tuple[str, str]:
    try:
        rows = q.query(f"SELECT unified_id__c FROM {DMO} LIMIT 1")
        return ("data" if rows else "empty", "")
    except Exception as exc:  # noqa: BLE001 - report any failure as "not queryable"
        return ("error", str(exc))


def _probe_ci(q: DataCloudQueryClient, name: str, filter_expr: str) -> str:
    try:
        rows = q.query_calculated_insight(name, filter_expr)
        return "rows" if rows else "empty"
    except Exception:  # noqa: BLE001 - unreachable CI name
        return "missing"


_ICON = {True: "[x]", False: "[ ]", None: "[?]"}


def main(argv: list[str] | None = None) -> int:
    try:
        config = DataCloudIngestConfig.from_env()
    except DataCloudConfigError as exc:
        print(f"Not configured: {exc}", file=sys.stderr)
        return 2

    q = DataCloudQueryClient(config)

    try:
        tenant = q.check_auth()
        auth_ok, auth_detail = True, tenant
    except Exception as exc:  # noqa: BLE001
        auth_ok, auth_detail = False, str(exc)

    dmo_state, dmo_detail = ("error", "not probed")
    ci_states: dict[str, str] = {}
    if auth_ok:
        dmo_state, dmo_detail = _probe_dmo(q)
        probe_id = COHORT[0].contact_id
        filt = f"[unified_id__c={probe_id}]"
        for name in (CI_HRV, CI_VASO, CI_SLEEP):
            ci_states[name] = _probe_ci(q, name, filt)

    checks = assess(
        auth_ok=auth_ok,
        auth_detail=auth_detail,
        dmo_state=dmo_state,
        dmo_detail=dmo_detail,
        ci_states=ci_states,
    )

    print("Data Cloud activation preflight\n")
    for c in checks:
        print(f"{_ICON[c.ok]} {c.step}")
        print(f"      {c.detail}")

    if ready_to_verify(checks):
        print("\nAll steps wired. Next: `python -m examples.data_cloud_verify` "
              "to confirm the CIs return real per-patient values.")
        return 0
    print("\nOne or more steps remain — see the [ ] items above and "
          "docs/PHASE_2_INGESTION_API_RUNBOOK.md.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
