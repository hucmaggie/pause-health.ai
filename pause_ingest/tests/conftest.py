"""Pytest wiring for the pause_ingest test suite.

Two opt-in modes:

  * **Default (mock mode).** ``pytest`` runs the wire-level contract tests
    in ``test_exchange_integration.py`` against the in-process
    ``JheMockServer``. ``test_exchange_real_jhe.py`` is skipped.
  * **Real JHE mode.** Set ``PAUSE_USE_REAL_JHE=1`` and ``pytest`` runs
    the same contract assertions in ``test_exchange_real_jhe.py``
    against a live JupyterHealth Exchange Django instance configured
    via ``IngestConfig.from_env()`` (i.e. ``pause_ingest/.env``). The
    in-process mock tests are skipped because their fixture would
    point at the mock URL.

The two modes are intentionally mutually exclusive: a single pytest
invocation either exercises the mock or the real instance, never both.
This keeps the per-mode test run deterministic and obvious to read in CI
logs.

See ``docs/JHE_SETUP_RUNBOOK.md`` Phase 3 Path B for the runbook.
"""

from __future__ import annotations

import os

import pytest


def _real_jhe_enabled() -> bool:
    """Truthy values for PAUSE_USE_REAL_JHE.

    Mirrors the dotenv / shell convention: ``1``, ``true``, ``yes``, ``on``
    (case-insensitive) all turn the mode on. Anything else — including
    the variable being unset — leaves it off.
    """
    raw = os.environ.get("PAUSE_USE_REAL_JHE", "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "real_jhe: opt-in test that requires a live JupyterHealth Exchange "
        "instance configured via .env. Enable with PAUSE_USE_REAL_JHE=1.",
    )


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    real = _real_jhe_enabled()
    skip_real = pytest.mark.skip(
        reason="set PAUSE_USE_REAL_JHE=1 to run against a live JHE instance"
    )
    skip_mock = pytest.mark.skip(
        reason="PAUSE_USE_REAL_JHE=1 is set; mock-only tests are skipped",
    )
    for item in items:
        if "real_jhe" in item.keywords:
            if not real:
                item.add_marker(skip_real)
        else:
            # Only the mock-driven exchange test module collides with
            # real-JHE mode (its fixture boots a JheMockServer). Other
            # unit tests (features, convert, cohort, data_cloud) have no
            # dependence on JHE and run in both modes.
            if real and item.module.__name__.endswith(
                "test_exchange_integration"
            ):
                item.add_marker(skip_mock)
