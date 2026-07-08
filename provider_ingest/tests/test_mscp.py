"""Tests for the MSCP credential overlay loader.

mscp.py is small but load-bearing: it's the sole source of the
`menopauseCertified` overlay flag, it's constructed in nearly every build test,
and it accepts two on-disk shapes (bare list or {"npis": [...]}). Pinning the
parsing + normalization here keeps the certified-provider join honest.
"""

import json

from provider_ingest.mscp import MscpOverlay


def test_from_file_accepts_bare_list(tmp_path):
    p = tmp_path / "npis.json"
    p.write_text(json.dumps(["1234567890", "1987654321"]))
    overlay = MscpOverlay.from_file(p)
    assert len(overlay) == 2
    assert overlay.is_certified("1234567890")
    assert not overlay.is_certified("0000000000")


def test_from_file_accepts_wrapped_object(tmp_path):
    p = tmp_path / "npis.json"
    p.write_text(json.dumps({"npis": ["1234567890"]}))
    overlay = MscpOverlay.from_file(p)
    assert len(overlay) == 1
    assert overlay.is_certified("1234567890")


def test_from_file_coerces_numeric_npis_to_strings(tmp_path):
    p = tmp_path / "npis.json"
    # JSON numbers (not strings) must still match the string NPI on a record.
    p.write_text(json.dumps([1234567890]))
    overlay = MscpOverlay.from_file(p)
    assert overlay.is_certified("1234567890")


def test_constructor_normalizes_whitespace_and_drops_blanks():
    overlay = MscpOverlay({" 1234567890 ", "", "   ", "1987654321"})
    assert len(overlay) == 2
    # Membership check also trims the query side.
    assert overlay.is_certified("1234567890")
    assert overlay.is_certified(" 1234567890 ")


def test_empty_overlay_certifies_nobody():
    overlay = MscpOverlay.empty()
    assert len(overlay) == 0
    assert not overlay.is_certified("1234567890")
