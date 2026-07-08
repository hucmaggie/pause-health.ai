import json
import os
from pathlib import Path

from provider_ingest.build import (
    _largest_input_mtime_iso,
    _round_robin_by_zip3,
    build_directory,
    build_metadata,
    write_directory,
    write_metadata,
)
from provider_ingest.mscp import MscpOverlay
from provider_ingest.records import ProviderRecord


def _rec(npi: str, zip_: str, score: float, certified: bool = False) -> ProviderRecord:
    return ProviderRecord(
        npi=npi,
        name=f"Dr. {npi}",
        credentials=["MD"],
        specialty="Obstetrics & Gynecology",
        menopauseCertified=certified,
        city="Town",
        state="CA",
        zip=zip_,
        acceptingNewPatients=True,
        telehealth=True,
        graphScore=score,
    )

FIXTURES = Path(__file__).resolve().parent.parent / "examples" / "fixtures"
NPPES = FIXTURES / "nppes_sample.csv"
MSCP = FIXTURES / "mscp_npis.json"


def _build():
    return build_directory(NPPES, MscpOverlay.from_file(MSCP))


def test_build_filters_orgs_and_irrelevant():
    records = _build()
    # 15 fixture rows: 1 org + 1 orthopaedist filtered → 13 kept.
    assert len(records) == 13
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


def test_round_robin_maximizes_zip3_coverage():
    # 900-prefix has the three strongest providers; 800 and 700 have one each.
    rows = [
        _rec("a1", "90001", 0.99),
        _rec("a2", "90002", 0.98),
        _rec("a3", "90003", 0.97),
        _rec("b1", "80001", 0.50),
        _rec("c1", "70001", 0.40),
    ]
    # Global top-3 would take all three 900s (zero coverage of 800/700).
    picked = _round_robin_by_zip3(rows, 3)
    assert {r.zip[:3] for r in picked} == {"900", "800", "700"}
    # The strongest 900 provider is the one that represents 900.
    assert next(r for r in picked if r.zip[:3] == "900").npi == "a1"


def test_round_robin_then_deepens_by_score():
    rows = [
        _rec("a1", "90001", 0.99),
        _rec("a2", "90002", 0.98),
        _rec("a3", "90003", 0.97),
        _rec("b1", "80001", 0.50),
    ]
    # limit=3 (< 4 rows): cover both prefixes first (a1, b1), then deepen the
    # strongest prefix with its next provider (a2).
    picked = _round_robin_by_zip3(rows, 3)
    assert [r.npi for r in picked] == ["a1", "b1", "a2"]


def test_round_robin_noop_when_within_limit():
    rows = [_rec("a1", "90001", 0.9), _rec("b1", "80001", 0.8)]
    assert _round_robin_by_zip3(rows, 5) == rows


def test_coverage_flag_does_not_narrow_zip3_in_build():
    overlay = MscpOverlay.from_file(MSCP)
    base = build_directory(NPPES, overlay, limit=2, keep_all_certified=True)
    cov = build_directory(NPPES, overlay, limit=2, keep_all_certified=True, coverage=True)

    def noncert_zip3(recs: list[ProviderRecord]) -> set[str]:
        return {r.zip[:3] for r in recs if not r.menopauseCertified}

    # Coverage mode never covers fewer prefixes than global top-N for the same
    # budget, and certified rows are still all retained either way.
    assert len(noncert_zip3(cov)) >= len(noncert_zip3(base))
    assert sum(r.menopauseCertified for r in cov) == sum(r.menopauseCertified for r in base)


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
        "latitude",
        "longitude",
        "serviceSignals",
        "licenseStatus",
        "insuranceAccepted",
        # Mirrors the TS ProviderRecord + both OAS schemas; provenance of the
        # menopauseCertified flag. Part of the frozen contract — see records.py.
        "credentialSource",
    }
    # Build path with no sanctions overlay → every survivor is "active".
    assert rec.licenseStatus == "active"
    # Every record carries at least one accepted plan (Medicare floor).
    assert len(rec.insuranceAccepted) > 0
    # credentialSource is present on every record and its value is bound to
    # the certified flag: None when not certified, else an authoritative
    # curated-overlay or an honest self-reported provenance.
    for r in _build():
        if r.menopauseCertified:
            assert r.credentialSource in {"curated-overlay", "self-reported"}
        else:
            assert r.credentialSource is None


def test_service_signals_stamped_for_non_certified_provider():
    # Dr. Marisol Reyes lists "MD, FACOG" and is NOT on the MSCP overlay. The
    # FACOG signal should land on serviceSignals and she stays non-certified —
    # exactly the relevant-local case we want sub-ranked honestly.
    reyes = next(r for r in _build() if r.npi == "1881903422")
    assert reyes.menopauseCertified is False
    assert "facog" in reyes.serviceSignals


def test_certified_provider_can_still_carry_signals():
    # Dr. Anand is overlay-certified AND has FACOG — both should be reflected.
    anand = next(r for r in _build() if r.npi == "1730155570")
    assert anand.menopauseCertified is True
    assert "facog" in anand.serviceSignals


def test_no_service_signals_when_credentials_have_no_match():
    # Dr. Levin lists just "MD" — no signal tokens, signals stays empty.
    levin = next(r for r in _build() if r.npi == "1922450088")
    # MSCP got auto-appended because he's overlay-certified, but that token
    # doesn't appear in serviceSignals — certification has its own field.
    assert levin.menopauseCertified is True
    assert levin.serviceSignals == []


def test_centroids_stamp_lat_lng_for_known_zip():
    # The fixture has 92614 (Irvine, CA), which has a real ZCTA centroid.
    records = _build()
    irvine = next(r for r in records if r.zip == "92614")
    assert irvine.latitude is not None
    assert irvine.longitude is not None
    # Loose box around Orange County, CA — guards against accidentally swapping
    # lat/lng or pulling the wrong column.
    assert 33.0 < irvine.latitude < 34.5
    assert -118.5 < irvine.longitude < -117.0


def test_centroids_off_when_empty_dict_passed():
    # Explicit empty centroid map opts the build out of distance-stamping;
    # ProviderRecords still produce, just with null coordinates.
    records = build_directory(NPPES, MscpOverlay.from_file(MSCP), centroids={})
    assert len(records) > 0
    for r in records:
        assert r.latitude is None
        assert r.longitude is None


def test_limit_caps_output():
    records = build_directory(NPPES, MscpOverlay.from_file(MSCP), limit=3)
    assert len(records) == 3


def test_multiple_inputs_merge_and_dedupe_by_npi():
    overlay = MscpOverlay.from_file(MSCP)
    single = build_directory(NPPES, overlay)
    # Passing the same file twice must not duplicate any provider.
    merged = build_directory([NPPES, NPPES], overlay)
    assert len(merged) == len(single)
    assert len({r.npi for r in merged}) == len(merged)


def test_merge_combines_distinct_files(tmp_path):
    # A tiny second "national" file with a NEW, self-reported-MSCP provider.
    extra = tmp_path / "extra.csv"
    header = (
        "NPI,Entity Type Code,Provider Last Name (Legal Name),Provider First Name,"
        "Provider Name Prefix Text,Provider Credential Text,"
        "Provider Business Practice Location Address City Name,"
        "Provider Business Practice Location Address State Name,"
        "Provider Business Practice Location Address Postal Code,"
        "Healthcare Provider Taxonomy Code_1,Healthcare Provider Primary Taxonomy Switch_1,"
        "Healthcare Provider Taxonomy Code_2,Healthcare Provider Primary Taxonomy Switch_2"
    )
    extra.write_text(
        header
        + "\n"
        + '1999999999,1,Doe,Jane,Dr.,"MD, MSCP",Austin,TX,73301,207V00000X,Y,,\n'
    )
    overlay = MscpOverlay.from_file(MSCP)
    single = build_directory(NPPES, overlay)
    merged = build_directory([NPPES, extra], overlay)
    assert len(merged) == len(single) + 1
    new = next(r for r in merged if r.npi == "1999999999")
    assert new.menopauseCertified is True  # certified via self-reported credential
    assert new.state == "TX"


def test_later_input_wins_on_npi_collision(tmp_path):
    # Same NPI as demo OB/GYN Anand (1730155570) but a different national record.
    header = (
        "NPI,Entity Type Code,Provider Last Name (Legal Name),Provider First Name,"
        "Provider Name Prefix Text,Provider Credential Text,"
        "Provider Business Practice Location Address City Name,"
        "Provider Business Practice Location Address State Name,"
        "Provider Business Practice Location Address Postal Code,"
        "Healthcare Provider Taxonomy Code_1,Healthcare Provider Primary Taxonomy Switch_1,"
        "Healthcare Provider Taxonomy Code_2,Healthcare Provider Primary Taxonomy Switch_2"
    )
    national = tmp_path / "national.csv"
    national.write_text(
        header + "\n" + "1730155570,1,Imposter,Nathan,Dr.,MD,Reno,NV,89501,207V00000X,Y,,\n"
    )
    overlay = MscpOverlay.from_file(MSCP)
    # Curated demo fixture listed LAST → its Anand (Irvine, CA) must win.
    merged = build_directory([national, NPPES], overlay)
    anand = next(r for r in merged if r.npi == "1730155570")
    assert anand.city == "Irvine"
    assert anand.state == "CA"


def test_keep_all_certified_overrides_limit():
    overlay = MscpOverlay.from_file(MSCP)
    # limit=1 would normally cut to 1 row; with keep_all_certified all 7 certified
    # survive and the limit caps only the non-certified remainder.
    records = build_directory(NPPES, overlay, limit=1, keep_all_certified=True)
    certified = [r for r in records if r.menopauseCertified]
    non_certified = [r for r in records if not r.menopauseCertified]
    assert len(certified) == 7
    assert len(non_certified) == 1


def test_write_directory_roundtrip(tmp_path):
    out = tmp_path / "dir.json"
    write_directory(_build(), out)
    data = json.loads(out.read_text())
    assert isinstance(data, list)
    assert data[0]["npi"]
    # Top provider should be a certified OB/GYN (relevance 1.0 + boost).
    assert data[0]["menopauseCertified"] is True


def test_build_metadata_shape():
    records = _build()
    meta = build_metadata(
        records=records,
        nppes_paths=[NPPES],
        mscp_path=MSCP,
        limit=2000,
        keep_all_certified=True,
        source_date="2026-06-15T00:00:00+00:00",
    )
    assert meta["schemaVersion"] == 2
    assert meta["sourceDate"] == "2026-06-15T00:00:00+00:00"
    assert meta["mscpOverlay"] == str(MSCP)
    assert meta["limit"] == 2000
    assert meta["keepAllCertified"] is True
    # Counts are derived from the records list, so they can't drift from the
    # JSON the same build wrote out.
    assert meta["providers"]["total"] == len(records)
    assert meta["providers"]["certified"] == sum(1 for r in records if r.menopauseCertified)
    # `generatedAt` is wall-clock; just shape-check.
    assert isinstance(meta["generatedAt"], str)
    assert meta["generatedAt"].endswith("+00:00")  # UTC, ISO 8601


def test_write_metadata_writes_valid_json(tmp_path):
    out = tmp_path / "dir.meta.json"
    meta = build_metadata(
        records=_build(),
        nppes_paths=[NPPES],
        mscp_path=MSCP,
        limit=None,
        keep_all_certified=False,
    )
    write_metadata(meta, out)
    parsed = json.loads(out.read_text())
    assert parsed["schemaVersion"] == 2


def test_largest_input_mtime_is_iso_utc(tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("x" * 10)
    b = tmp_path / "b.csv"
    b.write_text("y" * 100)  # bigger → wins
    # Force b's mtime to a known value so the assertion isn't time-flaky.
    target = 1718352000  # 2024-06-14T08:00:00Z
    os.utime(b, (target, target))
    iso = _largest_input_mtime_iso([a, b])
    assert iso == "2024-06-14T08:00:00+00:00"


def test_largest_input_mtime_returns_none_when_no_real_files(tmp_path):
    # FIFOs and missing paths return None — the harness then passes
    # --source-date explicitly when streaming via a FIFO.
    fifo = tmp_path / "fifo"
    os.mkfifo(fifo)
    assert _largest_input_mtime_iso([fifo]) is None
    # The FIFO is still a path that .stat()s; make sure it's the is_file
    # check that filters it, not a hard error. Fallback when the path doesn't
    # exist at all:
    assert _largest_input_mtime_iso([tmp_path / "missing.csv"]) is None


def test_main_writes_meta_sidecar(tmp_path):
    """End-to-end: --meta sidecar contains the same counts as the data JSON."""
    out = tmp_path / "dir.json"
    meta_path = tmp_path / "dir.meta.json"
    from provider_ingest.build import main

    rc = main(
        [
            "--nppes",
            str(NPPES),
            "--mscp",
            str(MSCP),
            "--out",
            str(out),
            "--meta",
            str(meta_path),
            "--source-date",
            "2026-01-01T00:00:00+00:00",
        ]
    )
    assert rc == 0
    data = json.loads(out.read_text())
    meta = json.loads(meta_path.read_text())
    assert meta["providers"]["total"] == len(data)
    assert meta["providers"]["certified"] == sum(
        1 for r in data if r["menopauseCertified"]
    )
    assert meta["sourceDate"] == "2026-01-01T00:00:00+00:00"


def test_main_default_meta_path_is_alongside_out(tmp_path):
    """Default --meta is <out>.meta.json next to the array file."""
    out = tmp_path / "subdir" / "dir.json"
    out.parent.mkdir()
    from provider_ingest.build import main

    rc = main(
        [
            "--nppes",
            str(NPPES),
            "--out",
            str(out),
            "--source-date",
            "2026-01-01T00:00:00+00:00",
        ]
    )
    assert rc == 0
    assert (tmp_path / "subdir" / "dir.meta.json").exists()
