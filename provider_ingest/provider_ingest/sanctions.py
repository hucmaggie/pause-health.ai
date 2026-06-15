"""Sanction overlay — suspended / ineligible providers.

The California Health and Human Services Agency (CHHS) publishes a free,
public-domain "Provider Suspended and Ineligible List" (the Medi-Cal S&I
list) as a CSV at data.chhs.ca.gov, refreshed monthly. It enumerates every
provider barred from Medi-Cal participation — physicians, RNs, pharmacies,
clinics — usually due to license revocation, conviction, or fraud. Each row
carries a "Provider Number" free-text field that contains one or more NPIs
(plus state license numbers and other identifiers).

The pipeline drops every directory candidate whose NPI appears in this
overlay. It's the right default: a suspended provider must NEVER surface in
a recommendation, and the agent isn't the right place to second-guess that.
The build prints how many rows it dropped; the count rides on the sidecar
metadata so consumers can see the filter was applied.

This is CA-only today — Phase 2 starts where the demo cohort lives. Other
states publish similar lists in heterogeneous formats (NJ has CSV, TX has
PDFs, NY has search-only forms); each state will get its own loader behind
the same `SanctionOverlay` interface.

The CSV file is downloaded out-of-band (see scripts/refresh_sanctions.sh
and the runbook); we don't fetch it during the build to keep the pipeline
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


class SanctionOverlay:
    """An NPI → suspended/ineligible lookup loaded from one or more CSVs.

    The overlay is membership-only — `is_sanctioned(npi)` is the entire API.
    Tracking which list a provider came from would be useful for a future
    "why was this dropped?" UI; today we keep it simple.
    """

    def __init__(self, npis: set[str]):
        self._npis = {n.strip() for n in npis if n and n.strip()}

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
        return cls(npis)

    @classmethod
    def empty(cls) -> "SanctionOverlay":
        return cls(set())

    def is_sanctioned(self, npi: str) -> bool:
        return npi.strip() in self._npis

    def __len__(self) -> int:
        return len(self._npis)
