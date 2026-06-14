"""Regenerate the committed demo provider directory the frontend loads.

Runs the real ingest pipeline over the bundled NPPES-format fixture
(`fixtures/nppes_sample.csv`) + MSCP overlay, and writes the result to
`frontend/lib/provider-directory.generated.json`.

This is the reproducible "synthetic inputs → real pipeline" demo dataset.
For the full national slice, run instead:

    pause-provider-build \
        --nppes /path/to/npidata_pfile_YYYYMMDD-YYYYMMDD.csv \
        --mscp /path/to/mscp_npis.json \
        --out frontend/lib/provider-directory.generated.json
"""

from __future__ import annotations

from pathlib import Path

from provider_ingest.build import build_directory, write_directory
from provider_ingest.mscp import MscpOverlay

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
FIXTURE = HERE / "fixtures" / "nppes_sample.csv"
MSCP_LIST = HERE / "fixtures" / "mscp_npis.json"
OUT = REPO_ROOT / "frontend" / "lib" / "provider-directory.generated.json"


def main() -> int:
    overlay = MscpOverlay.from_file(MSCP_LIST)
    records = build_directory(FIXTURE, overlay)
    write_directory(records, OUT)
    certified = sum(1 for r in records if r.menopauseCertified)
    print(
        f"Regenerated demo directory: {len(records)} providers "
        f"({certified} MSCP-certified) → {OUT.relative_to(REPO_ROOT)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
