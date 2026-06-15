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
from datetime import datetime, timezone
from pathlib import Path

from .centroids import LatLng, default_centroids
from .mscp import MscpOverlay
from .nppes import iter_nppes_rows, normalize_row
from .records import ProviderRecord

PathLike = str | Path


def build_directory(
    nppes_paths: PathLike | Iterable[PathLike],
    overlay: MscpOverlay,
    *,
    limit: int | None = None,
    keep_all_certified: bool = False,
    centroids: dict[str, LatLng] | None = None,
) -> list[ProviderRecord]:
    """Stream one or more NPPES files → filtered, scored, sorted ProviderRecords.

    Accepts a single path or an iterable of paths. Multiple inputs are merged and
    de-duplicated by NPI; on collision the **later-listed input wins**, so a
    national `npidata_pfile` can be combined with the bundled demo fixture in one
    run — list the curated/demo file LAST and its rows always win, keeping the
    demo personas green even if their (real-format) NPIs also exist nationally.
    (Listing a weekly incremental after the monthly file likewise lets the newer
    record win.)
    """
    if isinstance(nppes_paths, (str, Path)):
        nppes_paths = [nppes_paths]

    # Load the bundled ZCTA centroid map exactly once. Callers can pass an
    # explicit dict (tests, alternate datasets); `{}` opts distance-stamping
    # off entirely, which keeps the pipeline working even when the data file
    # isn't on disk.
    if centroids is None:
        centroids = default_centroids()

    by_npi: dict[str, ProviderRecord] = {}
    for path in nppes_paths:
        for row in iter_nppes_rows(path):
            rec = normalize_row(row, overlay, centroids=centroids)
            if rec is None:
                continue
            by_npi[rec.npi] = rec

    records = list(by_npi.values())
    # Sort by graphScore desc, tie-break on NPI for determinism.
    records.sort(key=lambda r: (-r.graphScore, r.npi))
    if limit is not None and limit > 0:
        if keep_all_certified:
            # The agent queries menopause=true (certified-only), so never drop a
            # certified provider — the limit caps only the non-certified breadth.
            certified = [r for r in records if r.menopauseCertified]
            non_certified = [r for r in records if not r.menopauseCertified][:limit]
            records = certified + non_certified
            records.sort(key=lambda r: (-r.graphScore, r.npi))
        else:
            records = records[:limit]
    return records


def write_directory(records: list[ProviderRecord], out_path: str | Path) -> None:
    payload = [r.to_dict() for r in records]
    Path(out_path).write_text(json.dumps(payload, indent=2) + "\n")


def build_metadata(
    *,
    records: list[ProviderRecord],
    nppes_paths: Iterable[PathLike],
    mscp_path: str | Path | None,
    limit: int | None,
    keep_all_certified: bool,
    source_date: str | None = None,
) -> dict:
    """Sidecar metadata for the generated directory.

    Writes alongside the bare-array JSON so the existing contract is unchanged.
    `source_date` is the dataset's freshness (typically the NPPES file's
    mtime ISO 8601 in UTC) — that's what the directory actually reflects, not
    "when the script ran". `generatedAt` is the wall-clock build timestamp.
    """
    nppes_list = [str(p) for p in nppes_paths]
    certified = sum(1 for r in records if r.menopauseCertified)
    states = {r.state for r in records if r.state}
    zip3 = {r.zip[:3] for r in records if r.zip}
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sourceDate": source_date,
        "nppesInputs": nppes_list,
        "mscpOverlay": str(mscp_path) if mscp_path else None,
        "limit": limit,
        "keepAllCertified": keep_all_certified,
        "providers": {
            "total": len(records),
            "certified": certified,
            "states": len(states),
            "zip3Prefixes": len(zip3),
        },
        "schemaVersion": 1,
    }


def write_metadata(meta: dict, out_path: str | Path) -> None:
    Path(out_path).write_text(json.dumps(meta, indent=2) + "\n")


def _largest_input_mtime_iso(nppes_paths: Iterable[PathLike]) -> str | None:
    """ISO 8601 (UTC) mtime of the largest input — proxy for "what dataset is this".

    Used as the default `sourceDate` on the sidecar metadata: when an NPPES
    monthly file is the dominant input, its mtime closely tracks CMS's
    publication date, which is the honest answer to "how fresh is this
    directory?". Returns None when no input is a real file (e.g. when the
    pipeline is fed via a FIFO; the harness passes --source-date explicitly).
    """
    largest_path: Path | None = None
    largest_size = -1
    for p in nppes_paths:
        path = Path(p)
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if not path.is_file():
            continue
        if size > largest_size:
            largest_size = size
            largest_path = path
    if largest_path is None:
        return None
    mtime = datetime.fromtimestamp(largest_path.stat().st_mtime, tz=timezone.utc)
    return mtime.isoformat(timespec="seconds")


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
    parser.add_argument(
        "--keep-all-certified",
        action="store_true",
        help=(
            "Never drop a menopause-certified provider; --limit then caps only "
            "the non-certified breadth. Recommended for national runs so the "
            "agent's menopause=true queries get full certified coverage."
        ),
    )
    parser.add_argument(
        "--meta",
        default=None,
        help=(
            "Optional sidecar JSON path for build metadata (runDate, sourceDate, "
            "input paths, counts). The bare-array directory contract on --out is "
            "unchanged; consumers opt in to read this. Default: <out>.meta.json."
        ),
    )
    parser.add_argument(
        "--source-date",
        default=None,
        help=(
            "ISO 8601 date for the dataset's freshness (the NPPES drop date). "
            "Defaults to the largest input file's mtime; pass explicitly when "
            "the input is a FIFO so the date reflects the underlying source."
        ),
    )
    args = parser.parse_args(argv)

    overlay = MscpOverlay.from_file(args.mscp) if args.mscp else MscpOverlay.empty()
    records = build_directory(
        args.nppes, overlay, limit=args.limit, keep_all_certified=args.keep_all_certified
    )
    write_directory(records, args.out)

    source_date = args.source_date or _largest_input_mtime_iso(args.nppes)
    meta = build_metadata(
        records=records,
        nppes_paths=args.nppes,
        mscp_path=args.mscp,
        limit=args.limit,
        keep_all_certified=args.keep_all_certified,
        source_date=source_date,
    )
    meta_path = Path(args.meta) if args.meta else Path(args.out).with_suffix(".meta.json")
    write_metadata(meta, meta_path)

    certified = sum(1 for r in records if r.menopauseCertified)
    print(
        f"Wrote {len(records)} providers ({certified} MSCP-certified) "
        f"from {', '.join(str(p) for p in args.nppes)} → {args.out} "
        f"(meta → {meta_path})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
