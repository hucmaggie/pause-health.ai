"""provider_ingest — CMS NPPES → Pause provider directory (Provider-graph Phase 1).

Streams the CMS NPPES bulk file, filters to menopause-relevant NUCC
taxonomies, overlays the MSCP credential list, computes a deterministic
graphScore, and emits the ProviderRecord dataset the frontend serves behind
the frozen `/api/mulesoft/providers` Experience-API contract.

Modules:
    taxonomy  — curated NUCC menopause taxonomy codes + relevance weights
    records   — the ProviderRecord dataclass (mirrors the TS/OAS contract)
    mscp      — MSCP (Menopause Society Certified Practitioner) overlay
    score     — graphScore composition
    nppes     — streaming NPPES reader / filter / normalizer
    build     — pipeline orchestration + JSON writer
"""

from __future__ import annotations

from .build import BuildStats, build_directory, build_directory_with_stats, write_directory
from .mscp import MscpOverlay
from .nppes import normalize_row
from .records import ProviderRecord
from .sanctions import SanctionOverlay
from .score import graph_score
from .taxonomy import MENOPAUSE_TAXONOMIES, Taxonomy, best_relevant, is_menopause_relevant

__all__ = [
    "build_directory",
    "build_directory_with_stats",
    "BuildStats",
    "write_directory",
    "MscpOverlay",
    "SanctionOverlay",
    "normalize_row",
    "ProviderRecord",
    "graph_score",
    "MENOPAUSE_TAXONOMIES",
    "Taxonomy",
    "best_relevant",
    "is_menopause_relevant",
]
