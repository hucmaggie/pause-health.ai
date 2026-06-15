"""ZIP → (latitude, longitude) centroid lookup.

The provider directory ranks results by distance from the patient's ZIP, which
needs a centroid for both the patient ZIP and each provider's ZIP. The Census
Bureau publishes free public-domain centroids for every ZCTA (ZIP Code
Tabulation Area) in the 2020 Gazetteer file. We collapse that into a tiny JSON
map keyed by the 5-digit ZIP and consume it in two places: this Python pipeline
(stamps `latitude`/`longitude` on each ProviderRecord at build time) and the
frontend route handler (resolves the query ZIP at request time).

The same generated JSON is committed to both `provider_ingest/data/` (loaded
at build time) and `frontend/lib/` (loaded server-side at request time) — the
file is the contract; the Census source is regeneration-only.

ZCTA ≠ USPS ZIP exactly, but for ranking-by-proximity the difference is
ignorable: 99%+ of common 5-digit ZIPs have a ZCTA, and the centroid for the
ones that share a ZCTA is the same point. Misses (rare PO-box-only ZIPs, very
new ZIPs) just yield a `None` centroid and the provider falls back to
non-distance ranking — never an error.
"""

from __future__ import annotations

import csv
import json
from collections.abc import Iterable
from pathlib import Path

# Tuple is (latitude, longitude) — same order Census publishes.
LatLng = tuple[float, float]


def parse_gazetteer(path: str | Path) -> dict[str, LatLng]:
    """Census 2020 ZCTA Gazetteer (TSV) → {zip5: (lat, lng)}.

    File layout:
        GEOID  ALAND  AWATER  ALAND_SQMI  AWATER_SQMI  INTPTLAT  INTPTLONG

    GEOID is the 5-digit ZCTA — what we use as the ZIP key.
    """
    out: dict[str, LatLng] = {}
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            zip5 = (row.get("GEOID") or "").strip()
            if len(zip5) != 5 or not zip5.isdigit():
                continue
            try:
                # Census pads some headers with trailing whitespace; strip both
                # the column names AND the values defensively.
                lat = float((row.get("INTPTLAT") or row.get("INTPTLAT".rstrip()) or "").strip())
                # The Gazetteer header is "INTPTLONG\t\t..." with stray spaces
                # in a few rows; DictReader keeps the spaces as part of the key
                # so look the value up by the *stripped* version.
                lng_raw = next(
                    (v for k, v in row.items() if k and k.strip() == "INTPTLONG"),
                    "",
                )
                lng = float((lng_raw or "").strip())
            except (TypeError, ValueError):
                continue
            out[zip5] = (lat, lng)
    return out


def write_centroids(centroids: dict[str, LatLng], out_path: str | Path) -> None:
    """Write {zip: [lat, lng]} as compact JSON (one key per line is overkill at 33K)."""
    payload = {z: [round(lat, 6), round(lng, 6)] for z, (lat, lng) in sorted(centroids.items())}
    Path(out_path).write_text(json.dumps(payload, separators=(",", ":")) + "\n")


def load_centroids(path: str | Path) -> dict[str, LatLng]:
    data = json.loads(Path(path).read_text())
    return {z: (float(v[0]), float(v[1])) for z, v in data.items()}


# Default location of the bundled JSON, alongside this module. Kept tiny
# (~1 MB) so it can ride in the wheel and be loaded into memory without a fuss.
DEFAULT_CENTROIDS_PATH = Path(__file__).resolve().parent / "data" / "zip_centroids.json"


def default_centroids() -> dict[str, LatLng]:
    """Load the committed centroid map. Returns {} if the file isn't present.

    An empty dict yields an honest no-op: the build still runs, providers just
    don't get coordinates stamped on them and the directory falls back to
    non-distance ranking. That matters when the package is installed somewhere
    the data file isn't bundled (e.g. a sparse checkout for tests).
    """
    if not DEFAULT_CENTROIDS_PATH.exists():
        return {}
    return load_centroids(DEFAULT_CENTROIDS_PATH)


def regenerate_main(argv: Iterable[str] | None = None) -> int:
    """Console entry point: regenerate the bundled centroid JSON from the gazetteer.

    Used once when refreshing from a new Census release; not part of the
    per-build pipeline. The committed JSON is the contract.
    """
    import argparse

    parser = argparse.ArgumentParser(
        description="Convert the Census 2020 ZCTA Gazetteer to the bundled zip_centroids.json"
    )
    parser.add_argument(
        "--gazetteer",
        required=True,
        help="Path to 2020_Gaz_zcta_national.txt (unzipped).",
    )
    parser.add_argument(
        "--out",
        default=str(DEFAULT_CENTROIDS_PATH),
        help="Output JSON path (default: bundled data/zip_centroids.json).",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    centroids = parse_gazetteer(args.gazetteer)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    write_centroids(centroids, args.out)
    print(f"Wrote {len(centroids)} ZIP centroids → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(regenerate_main())
