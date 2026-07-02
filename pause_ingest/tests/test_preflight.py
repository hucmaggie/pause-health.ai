"""Tests for the pure classifier behind examples/data_cloud_preflight.py.

The live probes are I/O; here we pin the mapping from probe results to per-step
statuses and the ready-to-verify gate.
"""

from __future__ import annotations

from examples.data_cloud_preflight import assess, ready_to_verify

CIS = {"Pause_HRV_RMSSD_30d__cio": "rows",
       "Pause_Vasomotor_Burden_30d__cio": "rows",
       "Pause_Sleep_Disruption_7d__cio": "rows"}


def _fully_wired():
    return assess(
        auth_ok=True, auth_detail="https://tenant.c360a.salesforce.com",
        dmo_state="data", dmo_detail="",
        ci_states=dict(CIS),
    )


def test_auth_failure_blocks_everything_downstream():
    checks = assess(
        auth_ok=False, auth_detail="400 empty body",
        dmo_state="error", dmo_detail="",
        ci_states={},
    )
    assert checks[0].ok is False
    assert all(c.ok is None for c in checks[1:])
    assert not ready_to_verify(checks)


def test_fully_wired_is_ready_to_verify():
    checks = _fully_wired()
    assert all(c.ok is True for c in checks)
    assert ready_to_verify(checks)


def test_missing_dmo_marks_steps_2_3_todo_and_blocks_push():
    checks = assess(
        auth_ok=True, auth_detail="t",
        dmo_state="error", dmo_detail="object not found",
        ci_states=dict(CIS),
    )
    by_step = {c.step.split(":")[0]: c for c in checks}
    assert by_step["Steps 2-3"].ok is False
    assert by_step["Step 4"].ok is None  # blocked on the DMO
    assert not ready_to_verify(checks)


def test_empty_dmo_marks_push_todo():
    checks = assess(
        auth_ok=True, auth_detail="t",
        dmo_state="empty", dmo_detail="",
        ci_states=dict(CIS),
    )
    step4 = next(c for c in checks if c.step.startswith("Step 4"))
    assert step4.ok is False
    assert "data_cloud_push" in step4.detail
    assert not ready_to_verify(checks)


def test_missing_ci_is_flagged_by_name():
    ci_states = dict(CIS)
    ci_states["Pause_Sleep_Disruption_7d__cio"] = "missing"
    checks = assess(
        auth_ok=True, auth_detail="t",
        dmo_state="data", dmo_detail="",
        ci_states=ci_states,
    )
    step5 = next(c for c in checks if c.step.startswith("Step 5"))
    assert step5.ok is False
    assert "Pause_Sleep_Disruption_7d__cio" in step5.detail
    assert not ready_to_verify(checks)


def test_reachable_but_empty_cis_still_pass_step5_with_a_note():
    ci_states = {k: "empty" for k in CIS}
    checks = assess(
        auth_ok=True, auth_detail="t",
        dmo_state="data", dmo_detail="",
        ci_states=ci_states,
    )
    step5 = next(c for c in checks if c.step.startswith("Step 5"))
    assert step5.ok is True
    assert "No row yet" in step5.detail
