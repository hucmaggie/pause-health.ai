from pathlib import Path

from provider_ingest.build import build_directory, write_directory
from provider_ingest.mscp import MscpOverlay
from provider_ingest.records import ProviderRecord

FIXTURES = Path(__file__).resolve().parent.parent / "examples" / "fixtures"
NPPES = FIXTURES / "nppes_sample.csv"
MSCP = FIXTURES / "mscp_npis.json"


def _build():
    return build_directory(NPPES, MscpOverlay.from_file(MSCP))


def test_build_filters_orgs_and_irrelevant():
    records = _build()
    # 14 fixture rows: 1 org + 1 orthopaedist filtered → 12 kept.
    assert len(records) == 12
    npis = {r.npi for r in records}
    assert "1790123456" not in npis  # org (Entity Type 2)
    assert "1689012345" not in npis  # orthopaedic surgeon


def test_build_sorted_by_score_desc():
    records = _build()
    scores = [r.graphScore for r in records]
    assert scores == sorted(scores, reverse=True)


def test_certified_count_matches_overlay():
    records = _build()
    certified = [r for r in records if r.menopauseCertified]
    # 7 NPIs in the MSCP list; all 7 survive the taxonomy filter.
    assert len(certified) == 7
    assert all("MSCP" in r.credentials for r in certified)


def test_record_shape_matches_contract():
    rec = _build()[0]
    assert isinstance(rec, ProviderRecord)
    d = rec.to_dict()
    assert set(d.keys()) == {
        "npi",
        "name",
        "credentials",
        "specialty",
        "menopauseCertified",
        "city",
        "state",
        "zip",
        "acceptingNewPatients",
        "telehealth",
        "graphScore",
    }


def test_limit_caps_output():
    records = build_directory(NPPES, MscpOverlay.from_file(MSCP), limit=3)
    assert len(records) == 3


def test_write_directory_roundtrip(tmp_path):
    import json

    out = tmp_path / "dir.json"
    write_directory(_build(), out)
    data = json.loads(out.read_text())
    assert isinstance(data, list)
    assert data[0]["npi"]
    # Top provider should be a certified OB/GYN (relevance 1.0 + boost).
    assert data[0]["menopauseCertified"] is True
