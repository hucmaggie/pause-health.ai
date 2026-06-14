from provider_ingest.mscp import MscpOverlay
from provider_ingest.nppes import (
    _derive_access,
    _parse_credentials,
    normalize_row,
)


def _row(**over):
    base = {
        "NPI": "1730155570",
        "Entity Type Code": "1",
        "Provider Last Name (Legal Name)": "Anand",
        "Provider First Name": "Priya",
        "Provider Name Prefix Text": "Dr.",
        "Provider Credential Text": "MD, FACOG",
        "Provider Business Practice Location Address City Name": "Irvine",
        "Provider Business Practice Location Address State Name": "CA",
        "Provider Business Practice Location Address Postal Code": "92614-2201",
        "Healthcare Provider Taxonomy Code_1": "207V00000X",
        "Healthcare Provider Primary Taxonomy Switch_1": "Y",
    }
    base.update(over)
    return base


def test_normalize_keeps_relevant_individual():
    rec = normalize_row(_row(), MscpOverlay({"1730155570"}))
    assert rec is not None
    assert rec.npi == "1730155570"
    assert rec.specialty == "Obstetrics & Gynecology"
    assert rec.menopauseCertified is True
    assert "MSCP" in rec.credentials
    assert rec.zip == "92614"  # postal truncated to 5
    assert rec.state == "CA"


def test_org_entity_is_filtered():
    assert normalize_row(_row(**{"Entity Type Code": "2"}), MscpOverlay.empty()) is None


def test_irrelevant_taxonomy_is_filtered():
    row = _row(**{"Healthcare Provider Taxonomy Code_1": "207X00000X"})
    assert normalize_row(row, MscpOverlay.empty()) is None


def test_uncertified_provider_has_no_mscp():
    rec = normalize_row(_row(), MscpOverlay.empty())
    assert rec is not None
    assert rec.menopauseCertified is False
    assert "MSCP" not in rec.credentials


def test_primary_taxonomy_preferred_over_secondary():
    row = _row(
        **{
            "Healthcare Provider Taxonomy Code_1": "207R00000X",
            "Healthcare Provider Primary Taxonomy Switch_1": "N",
            "Healthcare Provider Taxonomy Code_2": "207V00000X",
            "Healthcare Provider Primary Taxonomy Switch_2": "Y",
        }
    )
    rec = normalize_row(row, MscpOverlay.empty())
    assert rec is not None
    # Primary (OB/GYN) listed first → best_relevant still picks the most central.
    assert rec.specialty == "Obstetrics & Gynecology"


def test_parse_credentials_cleans_and_dedupes():
    assert _parse_credentials("M.D., FACOG", "MD") == ["MD", "FACOG"]
    assert _parse_credentials("MD; MD", "MD") == ["MD"]
    assert _parse_credentials("", "NP") == ["NP"]


def test_derive_access_is_deterministic():
    assert _derive_access("1730155570") == _derive_access("1730155570")
