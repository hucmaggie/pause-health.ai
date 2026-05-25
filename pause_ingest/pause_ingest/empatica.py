"""Empatica E4 ingestion.

Empatica E4 is the most common research-grade wearable in academic
menopause and women's health studies. The DBDP ``Pre-process`` repo and
the ``devicely`` package both implement Empatica E4 reading; FLIRT also
exposes a one-line helper:

    >>> features = flirt.with_.empatica("./1234567890_A12345.zip")

This module exists to make Empatica E4 a first-class data source in
Pause-Health's ingest. It is intentionally a STUB at this stage — see the
status note below.

Status (2026-05):
    * FLIRT supports Empatica .zip archives directly via ``flirt.with_.empatica``,
      and that path works on Python 3.13. We will wire it up here in Phase 2.
    * The ``devicely`` package (used by DBDP for Empatica de-identification)
      pins ``numpy < 2.0`` and ``pandas < 2.0``, which is incompatible with the
      modern Python 3.13 scientific stack the rest of pause_ingest runs on.
      Empatica de-identification will live behind an isolated subprocess /
      worker once devicely is updated, or once we vendor the bits we need.

Until both pieces are in place, callers should use ``flirt.with_.empatica``
directly. This module raises a clear ``NotImplementedError`` so the gap is
visible at runtime rather than silent.
"""

from __future__ import annotations

from pathlib import Path


class EmpaticaIngestNotImplemented(NotImplementedError):
    """Raised to flag the Empatica path as Phase 2 of the DBDP integration."""


def ingest_empatica_e4_zip(zip_path: str | Path) -> None:
    """Ingest an Empatica E4 .zip archive (Phase 2).

    Args:
        zip_path: path to the Empatica E4 archive file.

    Raises:
        EmpaticaIngestNotImplemented: always — see module docstring.
    """
    raise EmpaticaIngestNotImplemented(
        f"Empatica E4 ingestion ({zip_path!r}) is Phase 2 of the DBDP integration. "
        "Use `flirt.with_.empatica(...)` directly until this module is wired up. "
        "See docs/jupyterhealth-integration.md for the gating constraints."
    )
