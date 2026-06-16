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


def test_foreign_zip_is_filtered():
    # Canadian postal code (alphanumeric) → not a placeable US ZIP → dropped.
    postal = "Provider Business Practice Location Address Postal Code"
    assert normalize_row(_row(**{postal: "A1B 2C3"}), MscpOverlay.empty()) is None


def test_truncated_zip_is_filtered():
    # Garbage / truncated postal value (fewer than 5 digits) → dropped.
    postal = "Provider Business Practice Location Address Postal Code"
    assert normalize_row(_row(**{postal: "44"}), MscpOverlay.empty()) is None


def test_zip_plus_four_is_kept_and_truncated():
    # A valid US ZIP+4 is kept, truncated to its 5-digit prefix.
    postal = "Provider Business Practice Location Address Postal Code"
    rec = normalize_row(_row(**{postal: "92614-2201"}), MscpOverlay.empty())
    assert rec is not None
    assert rec.zip == "92614"


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


def test_self_reported_mscp_credential_is_certified():
    # No overlay, but the provider self-reports MSCP in the NPPES credential field.
    rec = normalize_row(_row(**{"Provider Credential Text": "MD, MSCP"}), MscpOverlay.empty())
    assert rec is not None
    assert rec.menopauseCertified is True
    assert "MSCP" in rec.credentials
    # Not double-appended.
    assert rec.credentials.count("MSCP") == 1


def test_self_reported_ncmp_credential_is_certified():
    # NCMP is the former name of the credential and still self-reported.
    rec = normalize_row(_row(**{"Provider Credential Text": "DO, NCMP"}), MscpOverlay.empty())
    assert rec is not None
    assert rec.menopauseCertified is True
    assert "NCMP" in rec.credentials
    # Self-reporters keep their own token; we don't tack on a duplicate MSCP.
    assert "MSCP" not in rec.credentials


def test_credential_detection_is_case_insensitive():
    rec = normalize_row(_row(**{"Provider Credential Text": "md, mscp"}), MscpOverlay.empty())
    assert rec is not None
    assert rec.menopauseCertified is True


def test_overlay_certified_without_self_reported_gets_mscp_badge():
    rec = normalize_row(_row(**{"Provider Credential Text": "MD, FACOG"}), MscpOverlay({"1730155570"}))
    assert rec is not None
    assert rec.menopauseCertified is True
    assert "MSCP" in rec.credentials


def test_parse_credentials_cleans_and_dedupes():
    assert _parse_credentials("M.D., FACOG", "MD") == ["MD", "FACOG"]
    assert _parse_credentials("MD; MD", "MD") == ["MD"]
    assert _parse_credentials("", "NP") == ["NP"]


def test_derive_access_is_deterministic():
    assert _derive_access("1730155570") == _derive_access("1730155570")
