"""Tests for the ZIP → (lat, lng) centroid lookup that powers distance ranking.

centroids.py had no direct coverage. The interesting behavior is all in the
Census-Gazetteer parsing edge cases (malformed GEOID rows, the stray-whitespace
INTPTLONG header the real file ships with), the write/load round-trip and its
6-dp rounding contract, and the missing-file fallback that keeps a sparse
checkout from erroring.
"""

from pathlib import Path

from provider_ingest import centroids as C


def _gazetteer(tmp_path: Path, rows: list[list[str]], long_header: str = "INTPTLONG") -> Path:
    # The real Census header ships with trailing whitespace on the last column;
    # long_header lets a test reproduce that exactly.
    header = ["GEOID", "ALAND", "AWATER", "ALAND_SQMI", "AWATER_SQMI", "INTPTLAT", long_header]
    lines = ["\t".join(header)] + ["\t".join(r) for r in rows]
    p = tmp_path / "gaz.txt"
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return p


def test_parse_gazetteer_parses_valid_rows(tmp_path):
    gaz = _gazetteer(
        tmp_path,
        [
            ["90012", "1", "0", "1", "0", "34.061", "-118.238"],
            ["00601", "1", "0", "1", "0", "18.180", "-66.749"],
        ],
    )
    out = C.parse_gazetteer(gaz)
    assert out["90012"] == (34.061, -118.238)
    assert out["00601"] == (18.180, -66.749)


def test_parse_gazetteer_skips_malformed_geoids(tmp_path):
    gaz = _gazetteer(
        tmp_path,
        [
            ["90012", "1", "0", "1", "0", "34.061", "-118.238"],  # valid
            ["ABCDE", "1", "0", "1", "0", "1.0", "2.0"],           # non-digit
            ["1234", "1", "0", "1", "0", "1.0", "2.0"],            # too short
            ["001234", "1", "0", "1", "0", "1.0", "2.0"],          # too long
        ],
    )
    out = C.parse_gazetteer(gaz)
    assert set(out.keys()) == {"90012"}


def test_parse_gazetteer_handles_stray_whitespace_long_header(tmp_path):
    # The Gazetteer's INTPTLONG column header carries trailing spaces; the
    # parser must still find the value by the stripped column name.
    gaz = _gazetteer(
        tmp_path,
        [["90012", "1", "0", "1", "0", "34.061", "-118.238"]],
        long_header="INTPTLONG   ",
    )
    out = C.parse_gazetteer(gaz)
    assert out["90012"] == (34.061, -118.238)


def test_parse_gazetteer_skips_unparseable_coordinates(tmp_path):
    gaz = _gazetteer(
        tmp_path,
        [
            ["90012", "1", "0", "1", "0", "34.061", "-118.238"],
            ["10001", "1", "0", "1", "0", "not-a-float", "-73.99"],
        ],
    )
    out = C.parse_gazetteer(gaz)
    assert "90012" in out
    assert "10001" not in out


def test_write_then_load_round_trips_with_6dp_rounding(tmp_path):
    src = {"90012": (34.0611119, -118.2379999), "00601": (18.18, -66.749)}
    out_path = tmp_path / "centroids.json"
    C.write_centroids(src, out_path)
    loaded = C.load_centroids(out_path)
    # Values are rounded to 6 decimals on write.
    assert loaded["90012"] == (round(34.0611119, 6), round(-118.2379999, 6))
    assert loaded["00601"] == (18.18, -66.749)
    # load returns float tuples.
    lat, lng = loaded["90012"]
    assert isinstance(lat, float) and isinstance(lng, float)


def test_write_centroids_sorts_keys(tmp_path):
    import json

    out_path = tmp_path / "c.json"
    C.write_centroids({"90012": (1.0, 2.0), "00601": (3.0, 4.0)}, out_path)
    payload = json.loads(out_path.read_text())
    assert list(payload.keys()) == ["00601", "90012"]


def test_default_centroids_returns_empty_when_file_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(C, "DEFAULT_CENTROIDS_PATH", tmp_path / "does-not-exist.json")
    assert C.default_centroids() == {}


def test_default_centroids_loads_bundled_map():
    # The bundled ~1MB map ships in the wheel; a real ZIP resolves to a point.
    data = C.default_centroids()
    assert isinstance(data, dict)
    assert len(data) > 10_000
    lat, lng = data["90012"]
    # Los Angeles is roughly (34, -118).
    assert 33 < lat < 35
    assert -119 < lng < -117


def test_regenerate_main_round_trips_gazetteer_to_json(tmp_path):
    gaz = _gazetteer(
        tmp_path,
        [
            ["90012", "1", "0", "1", "0", "34.061", "-118.238"],
            ["00601", "1", "0", "1", "0", "18.180", "-66.749"],
        ],
    )
    out_path = tmp_path / "regen.json"
    rc = C.regenerate_main(["--gazetteer", str(gaz), "--out", str(out_path)])
    assert rc == 0
    loaded = C.load_centroids(out_path)
    assert loaded["90012"] == (34.061, -118.238)
