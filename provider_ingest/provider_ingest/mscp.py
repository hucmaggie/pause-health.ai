"""MSCP (Menopause Society Certified Practitioner) credential overlay.

NPPES does NOT carry the MSCP credential — it's a certification maintained by
The Menopause Society (menopause.org), separate from the NPI registry. So the
`menopauseCertified` flag on a ProviderRecord comes from an overlay: a set of
NPIs known to hold MSCP, joined in after the NPPES taxonomy filter.

Today that list is a curated/synthetic JSON file
(`examples/fixtures/mscp_npis.json`). The production source is either the
Menopause Society "Find a Menopause Practitioner" directory (see the
`/proposal/menopause-society` partnership surface) or a licensed credential
feed. The join logic here is identical regardless of the list's provenance.
"""

from __future__ import annotations

import json
from pathlib import Path


class MscpOverlay:
    """An NPI → MSCP-credentialed lookup loaded from a JSON list of NPIs."""

    def __init__(self, npis: set[str]):
        self._npis = {n.strip() for n in npis if n and n.strip()}

    @classmethod
    def from_file(cls, path: str | Path) -> "MscpOverlay":
        data = json.loads(Path(path).read_text())
        # Accept either a bare list of NPIs or {"npis": [...]}.
        npis = data["npis"] if isinstance(data, dict) else data
        return cls(set(str(n) for n in npis))

    @classmethod
    def empty(cls) -> "MscpOverlay":
        return cls(set())

    def is_certified(self, npi: str) -> bool:
        return npi.strip() in self._npis

    def __len__(self) -> int:
        return len(self._npis)
