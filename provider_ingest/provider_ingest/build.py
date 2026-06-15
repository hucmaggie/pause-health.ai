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
from collections.abc import Iterable
from pathlib import Path

from .mscp import MscpOverlay
from .nppes import iter_nppes_rows, normalize_row
from .records import ProviderRecord

PathLike = str | Path


def build_directory(
    nppes_paths: PathLike | Iterable[PathLike],
    overlay: MscpOverlay,
    *,
    limit: int | None = None,
) -> list[ProviderRecord]:
    """Stream one or more NPPES files → filtered, scored, sorted ProviderRecords.

    Accepts a single path or an iterable of paths. Multiple inputs are merged and
    de-duplicated by NPI (highest graphScore wins on collision), so a national
    `npidata_pfile` can be combined with the bundled demo fixture in one run —
    keeping the demo personas green while adding national coverage.
    """
    if isinstance(nppes_paths, (str, Path)):
        nppes_paths = [nppes_paths]

    by_npi: dict[str, ProviderRecord] = {}
    for path in nppes_paths:
        for row in iter_nppes_rows(path):
            rec = normalize_row(row, overlay)
            if rec is None:
                continue
            existing = by_npi.get(rec.npi)
            if existing is None or rec.graphScore > existing.graphScore:
                by_npi[rec.npi] = rec

    records = list(by_npi.values())
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
        action="append",
        metavar="PATH",
        help=(
            "Path to an NPPES CSV (fixture or full npidata_pfile_*.csv). Repeat "
            "to merge multiple files, e.g. the national file + the demo fixture "
            "(de-duplicated by NPI)."
        ),
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
        f"from {', '.join(str(p) for p in args.nppes)} → {args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
