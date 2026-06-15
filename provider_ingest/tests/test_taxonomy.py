from provider_ingest.taxonomy import (
    MENOPAUSE_TAXONOMIES,
    best_relevant,
    is_menopause_relevant,
    lookup,
)


def test_known_menopause_codes_are_relevant():
    assert is_menopause_relevant("207V00000X")  # OB/GYN
    assert is_menopause_relevant("207RE0101X")  # Endocrinology
    assert is_menopause_relevant("363LW0102X")  # NP Women's Health


def test_unrelated_code_is_not_relevant():
    assert not is_menopause_relevant("207X00000X")  # Orthopaedic Surgery
    assert not is_menopause_relevant("")


def test_lookup_is_case_and_whitespace_insensitive():
    assert lookup("  207v00000x ") is MENOPAUSE_TAXONOMIES["207V00000X"]
    assert lookup("nope") is None


def test_best_relevant_picks_most_central_specialty():
    # OB/GYN (1.00) should win over Internal Medicine (0.72).
    best = best_relevant(["207R00000X", "207V00000X"])
    assert best is not None
    assert best.specialty == "Obstetrics & Gynecology"


def test_best_relevant_none_when_no_match():
    assert best_relevant(["207X00000X", ""]) is None


def test_relevance_weights_in_unit_range():
    for tax in MENOPAUSE_TAXONOMIES.values():
        assert 0.0 < tax.relevance <= 1.0


def test_phase2_broader_taxonomies_present():
    # Phase 2 broadening: urogynecology + gerontology / adult-health
    # subspecialties that surface menopause-relevant clinicians outside the
    # OB/GYN-dense metros. Verify the codes exist and renders the right
    # specialty + relevance band.
    urogyn = lookup("207VF0040X")
    assert urogyn is not None
    assert "Urogynecology" in urogyn.specialty
    assert urogyn.relevance >= 0.9  # GSM/pelvic-floor → near-OB/GYN relevance

    gyn_onc = lookup("207VX0201X")
    assert gyn_onc is not None
    assert gyn_onc.specialty == "Gynecologic Oncology"

    np_geri = lookup("363LG0600X")
    assert np_geri is not None
    assert "Gerontology" in np_geri.specialty

    np_adult = lookup("363LA2200X")
    assert np_adult is not None

    im_geri = lookup("207RG0300X")
    assert im_geri is not None
    assert "Geriatric" in im_geri.specialty

    cns_geri = lookup("364SG0600X")
    assert cns_geri is not None


def test_obgyn_still_outranks_phase2_broadeners():
    # OB/GYN must remain the highest-relevance code so the certified-local /
    # relevant-local tiers still prefer OB/GYNs over the new broader codes
    # at the same baseline.
    obgyn = MENOPAUSE_TAXONOMIES["207V00000X"]
    for code in ("207VF0040X", "207VX0201X", "207RG0300X", "363LG0600X", "363LA2200X", "364SG0600X"):
        assert obgyn.relevance >= MENOPAUSE_TAXONOMIES[code].relevance
