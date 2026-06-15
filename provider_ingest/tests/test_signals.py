from provider_ingest.signals import (
    credential_signals,
    detect_signals,
    multi_taxonomy_signal,
)


def test_credential_signals_pulls_known_tokens():
    assert credential_signals(["MD", "FACOG"]) == ["facog"]
    assert credential_signals(["DO", "FAAFP"]) == ["faafp"]
    assert credential_signals(["NP", "WHNP-BC"]) == ["whnp"]
    assert credential_signals(["CNM"]) == ["cnm"]


def test_credential_signals_dedupes_facog_and_facoog():
    # Both tokens map to the same signal; we want it once.
    assert credential_signals(["MD", "FACOG", "FACOOG"]) == ["facog"]


def test_credential_signals_ignores_unrelated_tokens():
    assert credential_signals(["MD"]) == []
    assert credential_signals(["MPH", "PhD"]) == []


def test_credential_signals_is_case_insensitive():
    assert credential_signals(["facog"]) == ["facog"]
    assert credential_signals(["whnp-bc"]) == ["whnp"]


def test_multi_taxonomy_signal_requires_two_relevant_codes():
    # OB/GYN + Reproductive Endo: two relevant codes → True.
    assert multi_taxonomy_signal(["207V00000X", "207VE0102X"]) is True
    # OB/GYN alone: one relevant code → False.
    assert multi_taxonomy_signal(["207V00000X"]) is False
    # OB/GYN + an unrelated code (orthopaedics) → False.
    assert multi_taxonomy_signal(["207V00000X", "207X00000X"]) is False


def test_detect_signals_combines_both_sources_in_stable_order():
    sigs = detect_signals(["MD", "FACOG"], ["207V00000X", "207VE0102X"])
    # Credentials first, then multi-taxonomy.
    assert sigs == ["facog", "multi-taxonomy"]


def test_detect_signals_returns_empty_when_none_match():
    assert detect_signals(["MD"], ["207V00000X"]) == []
