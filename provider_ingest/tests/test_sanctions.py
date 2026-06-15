from pathlib import Path

from provider_ingest.build import build_directory_with_stats
from provider_ingest.mscp import MscpOverlay
from provider_ingest.sanctions import SanctionOverlay

FIXTURES = Path(__file__).resolve().parent.parent / "examples" / "fixtures"
NPPES = FIXTURES / "nppes_sample.csv"
MSCP = FIXTURES / "mscp_npis.json"
SANCTIONS = FIXTURES / "ca_sanctions_sample.csv"


def test_overlay_extracts_npis_from_provider_number_column():
    """The S&I CSV packs NPIs into a free-text column; the loader pulls them
    out via the 10-digit-token regex without false-positives on state license
    IDs (which carry alpha prefixes like 'PHA999999')."""
    overlay = SanctionOverlay.from_chhs_csv(SANCTIONS)
    # Reyes (a real-shaped fixture NPI) and the synthetic 9999999999.
    assert overlay.is_sanctioned("1881903422") is True
    assert overlay.is_sanctioned("9999999999") is True
    # State license alpha-prefixed numbers must NOT be parsed as NPIs.
    assert not overlay.is_sanctioned("A99999")
    assert not overlay.is_sanctioned("PHA999999")
    assert len(overlay) == 2


def test_overlay_empty_when_no_path():
    o = SanctionOverlay.empty()
    assert len(o) == 0
    assert o.is_sanctioned("1881903422") is False


def test_build_filters_sanctioned_provider():
    """Reyes is in the fixture and would normally show up in the directory;
    with the sanctions overlay applied, she's dropped and the stat reports it."""
    overlay = MscpOverlay.from_file(MSCP)
    sanctions = SanctionOverlay.from_chhs_csv(SANCTIONS)

    baseline, _ = build_directory_with_stats(NPPES, overlay)
    assert any(r.npi == "1881903422" for r in baseline), (
        "fixture sanity: Reyes survives the baseline build"
    )

    filtered, stats = build_directory_with_stats(NPPES, overlay, sanctions=sanctions)
    assert not any(r.npi == "1881903422" for r in filtered)
    assert stats.sanction_drops == 1
    assert len(filtered) == len(baseline) - 1


def test_build_with_no_sanction_match_reports_zero_drops():
    """A sanctions overlay with no overlap leaves the directory size + stats
    consistent — the filter ran (count is reported) but had nothing to do."""
    overlay = MscpOverlay.from_file(MSCP)
    empty = SanctionOverlay({"0000000000"})  # a fake NPI nobody uses
    filtered, stats = build_directory_with_stats(NPPES, overlay, sanctions=empty)
    assert stats.sanction_drops == 0
    # Build size unchanged from baseline.
    baseline, _ = build_directory_with_stats(NPPES, overlay)
    assert len(filtered) == len(baseline)


def test_default_license_status_is_active():
    """Build path with no sanctions overlay → every record carries
    licenseStatus='active' so the contract is honest about what was checked."""
    overlay = MscpOverlay.from_file(MSCP)
    records, _ = build_directory_with_stats(NPPES, overlay)
    assert all(r.licenseStatus == "active" for r in records)
