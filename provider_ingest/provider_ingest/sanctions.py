"""Sanction overlay — suspended / ineligible providers.

Two distinct public-data shapes are supported:

  1. NPI-keyed overlays — California's Medi-Cal Suspended & Ineligible List
     (CHHS) is a free CSV that packs NPIs into a free-text column. Easy: lift
     the NPIs out, drop matching directory candidates.

  2. (State, License-Number)-keyed overlays — New York's Office of Professional
     Medical Conduct disciplinary actions (data.ny.gov, 17,950+ rows since
     1990) carries name + license number + license type, but NO NPI. We
     cross-walk against NPPES's `Provider License Number_<i>` /
     `Provider License Number State Code_<i>` columns: a directory candidate
     listing license `(NY, 114313)` matches the NY action for license 114313.

A single `SanctionOverlay` carries both kinds of evidence. `is_sanctioned_npi`
checks the NPI set; `is_sanctioned_license_set(licenses)` takes the candidate's
own (state, number) pairs and returns True if any one matches. Build-side code
calls both, drops candidates where either fires, and counts each filter source
separately so the sidecar metadata can report `caFiltered` / `nyFiltered`
distinctly.

CA today, NY today, NJ TBD (no public structured feed; NJ DCA disciplinary
actions are PDFs scraped per-action — not the right shape for an honest
overlay). New states land additively behind the same class.

Source CSVs are downloaded out-of-band (see scripts/refresh_national.sh and
the runbook); we don't fetch them during the build to keep the pipeline
hermetic and the build wall-clock predictable.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

# A "Provider Number" cell often packs several IDs comma-separated; NPIs are
# the only 10-digit numeric tokens in the column. CMS NPIs are exactly 10
# digits with a Luhn check, so a 10-digit \b match is a high-precision hit
# in this column (state license numbers in CA carry alpha prefixes —
# "PHA410230", "CGP14678" — and don't collide).
_NPI_TOKEN = re.compile(r"\b\d{10}\b")


def _normalize_license(license_num: str) -> str:
    """Canonicalize license numbers for stable comparison.

    NY records license 114313 in NPPES ("Provider License Number_1") and
    "114313" in OPMC. CA can write CG-12345, CG12345, or CG 12345 across
    sources. We strip whitespace + interior dashes/spaces, uppercase, and
    drop a leading zero-pad so the cross-walk is robust to formatting drift.
    """
    s = (license_num or "").strip().upper().replace(" ", "").replace("-", "")
    return s.lstrip("0") if s else s


def _normalize_state(state: str) -> str:
    return (state or "").strip().upper()


class SanctionOverlay:
    """A unified suspended/ineligible lookup combining NPI-keyed and
    (state, license_num)-keyed evidence.

    The overlay is membership-only; the build calls
    `is_sanctioned_npi(npi)` and `is_sanctioned_license_set(licenses)` and
    drops candidates that match either. Per-source counts (CA vs. NY etc.)
    are surfaced via separate overlay instances merged with `merge`, so the
    build can report each source's filter contribution.
    """

    def __init__(
        self,
        npis: set[str] | None = None,
        license_pairs: set[tuple[str, str]] | None = None,
    ):
        self._npis = {n.strip() for n in (npis or set()) if n and n.strip()}
        # license_pairs items are (canonical_state, canonical_license_num).
        self._license_pairs = {
            (_normalize_state(s), _normalize_license(n))
            for (s, n) in (license_pairs or set())
            if n and n.strip()
        }

    @classmethod
    def empty(cls) -> "SanctionOverlay":
        return cls()

    @classmethod
    def from_chhs_csv(cls, path: str | Path) -> "SanctionOverlay":
        """Load the CA Medi-Cal Suspended & Ineligible List CSV.

        Schema (CHHS, observed): Last Name, First Name, Middle Name,
        A/K/A-Also Known As / D/B/A-Doing Business as, Address(es),
        Provider Type, License Number, Provider Number, Date of Suspension,
        Active Period. We only consume `Provider Number` (free-text, regex
        for 10-digit NPIs) — the rest is human context.
        """
        npis: set[str] = set()
        # CHHS exports the CSV with a UTF-8 BOM; utf-8-sig strips it.
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                cell = row.get("Provider Number") or ""
                for m in _NPI_TOKEN.findall(cell):
                    npis.add(m)
        return cls(npis=npis)

    @classmethod
    def from_ny_opmc_csv(cls, path: str | Path) -> "SanctionOverlay":
        """Load NY's Professional Medical Conduct Board Actions CSV.

        Schema (data.ny.gov ebmi-8ctw, observed): Last Name, First Name,
        Middle Name, Name Suffix, Address, License Number, License Type,
        Year of Birth, Effective Date, Action, Misconduct Description,
        Date Updated. We consume `License Number` + the implicit state
        ("NY" — every row in this dataset is a NY action). Rows where the
        license number is blank or "000000" are skipped (NY redacts pre-
        license-issuance orders to "000000"; matching them would be a
        false-positive across every blank-license NPPES record).

        Why state license numbers, not NPIs: this dataset doesn't carry
        NPIs. We cross-walk by intersecting (NY, license_num) against
        the candidate's own license list during the directory build.
        """
        license_pairs: set[tuple[str, str]] = set()
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                ln = (row.get("License Number") or "").strip()
                if not ln or ln in {"000000", "0"}:
                    # Sentinel for redacted / pre-issuance — would match every
                    # blank-license NPPES record if we kept it.
                    continue
                license_pairs.add(("NY", ln))
        return cls(license_pairs=license_pairs)

    def is_sanctioned_npi(self, npi: str) -> bool:
        return npi.strip() in self._npis

    def is_sanctioned_license_set(self, licenses: list[tuple[str, str]]) -> bool:
        """True if any (state, license_num) on the candidate matches an overlay
        entry. License lists arrive from NPPES's `Provider License Number_<i>`
        columns; we normalize both sides so formatting drift doesn't miss.
        """
        if not self._license_pairs:
            return False
        for state, num in licenses:
            key = (_normalize_state(state), _normalize_license(num))
            if key[1] and key in self._license_pairs:
                return True
        return False

    @classmethod
    def merge(cls, *overlays: "SanctionOverlay") -> "SanctionOverlay":
        """Union multiple overlays into one. Used when the build runs with
        more than one source (e.g. CA + NY simultaneously)."""
        npis: set[str] = set()
        license_pairs: set[tuple[str, str]] = set()
        for o in overlays:
            npis |= o._npis
            license_pairs |= o._license_pairs
        return cls(npis=npis, license_pairs=license_pairs)

    def npi_count(self) -> int:
        return len(self._npis)

    def license_count(self) -> int:
        return len(self._license_pairs)

    def __len__(self) -> int:
        return self.npi_count() + self.license_count()

    # Back-compat shim for callers built when SanctionOverlay only carried
    # NPIs. New code should call `is_sanctioned_npi` directly; old callers
    # (and tests) keep working.
    def is_sanctioned(self, npi: str) -> bool:
        return self.is_sanctioned_npi(npi)
