"""Build the provider directory dataset from an NPPES file.

Streams the NPPES bulk file through the taxonomy filter + MSCP overlay +
graphScore, then emits a JSON array of ProviderRecords sorted by graphScore.
That JSON is what the frontend loads behind the frozen provider contract
(`frontend/lib/provider-directory.generated.json`).

For the committed demo dataset we run this over a small NPPES-format fixture
(real schema + real taxonomy codes, synthetic rows) so the pipeline is real
and the output is reproducible without the 10 GB national file. Point
`--nppes` at the real `npidata_pfile_*.csv` to produce the full ~80K-row slice.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .mscp import MscpOverlay
from .nppes import iter_nppes_rows, normalize_row
from .records import ProviderRecord


def build_directory(
    nppes_path: str | Path,
    overlay: MscpOverlay,
    *,
    limit: int | None = None,
) -> list[ProviderRecord]:
    """Stream NPPES → filtered, scored, sorted ProviderRecords."""
    records: list[ProviderRecord] = []
    for row in iter_nppes_rows(nppes_path):
        rec = normalize_row(row, overlay)
        if rec is not None:
            records.append(rec)
    # Sort by graphScore desc, tie-break on NPI for determinism.
    records.sort(key=lambda r: (-r.graphScore, r.npi))
    if limit is not None and limit > 0:
        records = records[:limit]
    return records


def write_directory(records: list[ProviderRecord], out_path: str | Path) -> None:
    payload = [r.to_dict() for r in records]
    Path(out_path).write_text(json.dumps(payload, indent=2) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the Pause provider directory from NPPES.")
    parser.add_argument(
        "--nppes",
        required=True,
        help="Path to the NPPES CSV (fixture or full npidata_pfile_*.csv).",
    )
    parser.add_argument(
        "--mscp",
        default=None,
        help="Path to the MSCP NPI list JSON. Omit for no certification overlay.",
    )
    parser.add_argument(
        "--out",
        required=True,
        help="Where to write the generated provider-directory JSON.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap the number of providers emitted (top-N by graphScore).",
    )
    args = parser.parse_args(argv)

    overlay = MscpOverlay.from_file(args.mscp) if args.mscp else MscpOverlay.empty()
    records = build_directory(args.nppes, overlay, limit=args.limit)
    write_directory(records, args.out)

    certified = sum(1 for r in records if r.menopauseCertified)
    print(
        f"Wrote {len(records)} providers ({certified} MSCP-certified) "
        f"from {args.nppes} → {args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
