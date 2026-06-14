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
