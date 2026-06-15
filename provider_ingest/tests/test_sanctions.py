from pathlib import Path

from provider_ingest.build import build_directory_with_stats
from provider_ingest.mscp import MscpOverlay
from provider_ingest.sanctions import SanctionOverlay

FIXTURES = Path(__file__).resolve().parent.parent / "examples" / "fixtures"
NPPES = FIXTURES / "nppes_sample.csv"
MSCP = FIXTURES / "mscp_npis.json"
SANCTIONS = FIXTURES / "ca_sanctions_sample.csv"
SANCTIONS_NY = FIXTURES / "ny_opmc_sample.csv"


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


# ---------- NY OPMC overlay (license-number-keyed) -------------------------


def test_ny_overlay_loads_real_license_numbers_only():
    """NY rows where License Number is blank or '000000' (pre-issuance
    sentinel) must NOT enter the overlay — keeping them would match every
    blank-license NPPES record across the country."""
    overlay = SanctionOverlay.from_ny_opmc_csv(SANCTIONS_NY)
    # Levin (999111) and Mancini-Real (114313) made it in.
    assert overlay.license_count() == 2
    # The "000000" sentinel did NOT.
    assert not overlay.is_sanctioned_license_set([("NY", "000000")])
    # Real licenses do.
    assert overlay.is_sanctioned_license_set([("NY", "999111")])
    assert overlay.is_sanctioned_license_set([("NY", "114313")])


def test_ny_overlay_normalizes_license_formats():
    """License number formatting drift across sources (whitespace,
    dashes, leading zeros) shouldn't miss a real match."""
    overlay = SanctionOverlay.from_ny_opmc_csv(SANCTIONS_NY)
    # Same license, different surface forms.
    assert overlay.is_sanctioned_license_set([("NY", " 999111 ")])
    assert overlay.is_sanctioned_license_set([("ny", "999111")])  # lowercase state
    assert overlay.is_sanctioned_license_set([("NY", "0999111")])  # leading zero


def test_ny_state_isolation():
    """A license number that matches NY's overlay but is recorded against
    a different state on NPPES must NOT trigger — same number in CA is
    a different person."""
    overlay = SanctionOverlay.from_ny_opmc_csv(SANCTIONS_NY)
    assert not overlay.is_sanctioned_license_set([("CA", "999111")])
    assert not overlay.is_sanctioned_license_set([("TX", "114313")])


def test_build_filters_ny_sanctioned_provider_via_license_crosswalk():
    """Levin (NPI 1922450088) lists NY license 999111 in NPPES, which is
    on the NY OPMC overlay. He must be filtered, and the count attributed
    to license_drops (not npi_drops)."""
    mscp = MscpOverlay.from_file(MSCP)
    sanctions = SanctionOverlay.from_ny_opmc_csv(SANCTIONS_NY)

    baseline, _ = build_directory_with_stats(NPPES, mscp)
    assert any(r.npi == "1922450088" for r in baseline), (
        "fixture sanity: Levin survives the baseline build"
    )

    filtered, stats = build_directory_with_stats(NPPES, mscp, sanctions=sanctions)
    assert not any(r.npi == "1922450088" for r in filtered)
    assert stats.license_drops == 1
    assert stats.npi_drops == 0
    assert stats.sanction_drops == 1
    assert len(filtered) == len(baseline) - 1


def test_overlay_merge_runs_both_filters_in_one_pass():
    """CA + NY overlays merge into one SanctionOverlay; the build pass
    counts each source's drops separately. Both Reyes (CA-NPI) and
    Levin (NY-license) get filtered."""
    mscp = MscpOverlay.from_file(MSCP)
    ca = SanctionOverlay.from_chhs_csv(SANCTIONS)
    ny = SanctionOverlay.from_ny_opmc_csv(SANCTIONS_NY)
    merged = SanctionOverlay.merge(ca, ny)

    filtered, stats = build_directory_with_stats(NPPES, mscp, sanctions=merged)
    assert stats.npi_drops == 1  # Reyes
    assert stats.license_drops == 1  # Levin
    assert stats.sanction_drops == 2
    npis = {r.npi for r in filtered}
    assert "1881903422" not in npis  # Reyes (CA)
    assert "1922450088" not in npis  # Levin (NY)


def test_overlay_merge_preserves_membership_disjointly():
    """Merging two overlays unions their NPI sets and license-pair sets
    independently — no cross-contamination."""
    a = SanctionOverlay({"1111111111"}, license_pairs={("NY", "AA1")})
    b = SanctionOverlay({"2222222222"}, license_pairs={("CA", "BB2")})
    merged = SanctionOverlay.merge(a, b)
    assert merged.is_sanctioned_npi("1111111111")
    assert merged.is_sanctioned_npi("2222222222")
    assert merged.is_sanctioned_license_set([("NY", "AA1")])
    assert merged.is_sanctioned_license_set([("CA", "BB2")])
    # Cross-state false-positive guard: NY-AA1 doesn't match CA-AA1.
    assert not merged.is_sanctioned_license_set([("CA", "AA1")])
