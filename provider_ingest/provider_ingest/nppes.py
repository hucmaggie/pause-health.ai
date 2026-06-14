"""Stream the CMS NPPES bulk file → menopause-relevant ProviderRecords.

The NPPES "npidata_pfile" monthly dump is a ~10 GB, ~8.5M-row CSV with one row
per NPI and up to 15 taxonomy columns each. We stream it row-by-row (never
loading it whole), keep only individual providers (Entity Type Code 1) whose
taxonomy set intersects the curated menopause-relevant codes, and normalize
each survivor into the frozen ProviderRecord contract.

Two ProviderRecord fields have no NPPES source — `acceptingNewPatients` and
`telehealth`. NPPES doesn't publish them. We derive them deterministically
from the NPI so the demo directory is stable and reproducible; a production
feed (or a service-line overlay, Phase 2) supplies the real values. This is
called out so the synthetic-ness is never mistaken for ground truth.
"""

from __future__ import annotations

import csv
from collections.abc import Iterator
from pathlib import Path

from .mscp import MscpOverlay
from .records import ProviderRecord
from .score import graph_score
from .taxonomy import best_relevant

# Exact NPPES column headers (npidata_pfile_* layout).
COL_NPI = "NPI"
COL_ENTITY_TYPE = "Entity Type Code"
COL_LAST_NAME = "Provider Last Name (Legal Name)"
COL_FIRST_NAME = "Provider First Name"
COL_PREFIX = "Provider Name Prefix Text"
COL_CREDENTIAL = "Provider Credential Text"
COL_CITY = "Provider Business Practice Location Address City Name"
COL_STATE = "Provider Business Practice Location Address State Name"
COL_POSTAL = "Provider Business Practice Location Address Postal Code"

ENTITY_TYPE_INDIVIDUAL = "1"
NUM_TAXONOMY_SLOTS = 15


def iter_nppes_rows(path: str | Path) -> Iterator[dict]:
    """Yield raw NPPES rows as dicts, streaming (constant memory)."""
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        yield from reader


def _taxonomy_codes(row: dict) -> list[str]:
    """Pull the populated taxonomy codes, primary first."""
    primary: list[str] = []
    others: list[str] = []
    for i in range(1, NUM_TAXONOMY_SLOTS + 1):
        code = (row.get(f"Healthcare Provider Taxonomy Code_{i}") or "").strip()
        if not code:
            continue
        switch = (row.get(f"Healthcare Provider Primary Taxonomy Switch_{i}") or "").strip().upper()
        (primary if switch == "Y" else others).append(code)
    return primary + others


def _parse_credentials(text: str, default: str) -> list[str]:
    """Normalize the free-text credential field into a clean list.

    NPPES credential text is messy ("M.D.", "MD, FACOG", "DO"). We strip
    punctuation/whitespace and de-dupe, falling back to the taxonomy's default
    credential when the field is blank.
    """
    raw = [c.strip().replace(".", "").upper() for c in (text or "").replace(";", ",").split(",")]
    creds = [c for c in raw if c]
    if not creds:
        creds = [default]
    # Stable de-dupe preserving order.
    seen: set[str] = set()
    out: list[str] = []
    for c in creds:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _derive_access(npi: str) -> tuple[bool, bool]:
    """Deterministically derive (acceptingNewPatients, telehealth) from NPI.

    NPPES has no such fields; this keeps the demo directory stable. ~70% accept
    new patients, ~60% offer telehealth, decorrelated via different digits.
    """
    digits = [int(d) for d in npi if d.isdigit()]
    if not digits:
        return True, True
    accepting = (sum(digits[::2]) % 10) < 7
    telehealth = (sum(digits[1::2]) % 10) < 6
    return accepting, telehealth


def _format_name(row: dict, credentials: list[str]) -> str:
    prefix = (row.get(COL_PREFIX) or "").strip().title()
    first = (row.get(COL_FIRST_NAME) or "").strip().title()
    last = (row.get(COL_LAST_NAME) or "").strip().title()
    core = " ".join(p for p in (prefix or "Dr.", first, last) if p).strip()
    cred_suffix = ", ".join(credentials)
    return f"{core}, {cred_suffix}" if cred_suffix else core


def normalize_row(row: dict, overlay: MscpOverlay) -> ProviderRecord | None:
    """Filter + normalize one NPPES row, or None if it isn't a keeper.

    Keeps individual providers whose taxonomy set intersects the curated
    menopause-relevant codes; everything else returns None.
    """
    if (row.get(COL_ENTITY_TYPE) or "").strip() != ENTITY_TYPE_INDIVIDUAL:
        return None

    npi = (row.get(COL_NPI) or "").strip()
    if not npi:
        return None

    taxonomy = best_relevant(_taxonomy_codes(row))
    if taxonomy is None:
        return None

    certified = overlay.is_certified(npi)
    credentials = _parse_credentials(row.get(COL_CREDENTIAL, ""), taxonomy.default_credential)
    if certified and "MSCP" not in credentials:
        credentials.append("MSCP")

    city = (row.get(COL_CITY) or "").strip().title()
    state = (row.get(COL_STATE) or "").strip().upper()
    zip_code = (row.get(COL_POSTAL) or "").strip()[:5]
    has_location = bool(city and state and zip_code)

    accepting, telehealth = _derive_access(npi)

    score = graph_score(
        relevance=taxonomy.relevance,
        accepting_new_patients=accepting,
        telehealth=telehealth,
        has_location=has_location,
        menopause_certified=certified,
    )

    return ProviderRecord(
        npi=npi,
        name=_format_name(row, credentials),
        credentials=credentials,
        specialty=taxonomy.specialty,
        menopauseCertified=certified,
        city=city,
        state=state,
        zip=zip_code,
        acceptingNewPatients=accepting,
        telehealth=telehealth,
        graphScore=score,
    )
