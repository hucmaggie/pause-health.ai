from provider_ingest.insurance import (
    PLANS,
    derive_insurance_accepted,
    normalize_plan_query,
)


def test_every_npi_gets_at_least_one_plan():
    """Medicare floor — never an empty chip row, even for digit-degenerate NPIs."""
    for npi in ("0000000000", "1730155570", "9999999999", ""):
        out = derive_insurance_accepted(npi)
        assert len(out) >= 1
        # Every returned token is from the canonical PLANS tuple.
        assert all(p in PLANS for p in out)


def test_derivation_is_deterministic():
    """Same NPI always yields same plan list — directory is reproducible."""
    a = derive_insurance_accepted("1730155570")
    b = derive_insurance_accepted("1730155570")
    assert a == b


def test_returned_order_matches_canonical_plans():
    """Order is stable so consumers can render without sorting."""
    out = derive_insurance_accepted("1730155570")
    indexes = [PLANS.index(p) for p in out]
    assert indexes == sorted(indexes)


def _varied_test_npis(n: int) -> list[str]:
    """Synthesize n distinct 10-digit NPIs that exercise the hash uniformly."""
    out = []
    for i in range(n):
        # Convert i to a 10-digit zero-padded string. Distinct, deterministic.
        out.append(f"{i:010d}")
    return out


def test_distribution_varies_by_npi():
    """Different NPIs map to different plan lists — derivation isn't stuck."""
    samples = {tuple(derive_insurance_accepted(npi)) for npi in _varied_test_npis(100)}
    assert len(samples) > 5, f"100 varied NPIs collapsed to {len(samples)} plan lists"


def test_distribution_is_realistic_for_medicare():
    """Sanity-check the Medicare derivation: ~80% of providers should accept."""
    npis = _varied_test_npis(1000)
    accepted = sum(1 for npi in npis if "medicare" in derive_insurance_accepted(npi))
    # Loose bound — real-world Medicare is ~85%; our digit-modulo cap is ~80%.
    assert 700 <= accepted <= 900, f"Medicare share {accepted}/1000 out of range"


def test_normalize_plan_query_aliases():
    assert normalize_plan_query("Aetna") == "aetna"
    assert normalize_plan_query("  BCBS  ") == "bcbs"
    assert normalize_plan_query("Blue Cross") == "bcbs"
    assert normalize_plan_query("blue cross blue shield") == "bcbs"
    assert normalize_plan_query("United") == "uhc"
    assert normalize_plan_query("UnitedHealthcare") == "uhc"
    assert normalize_plan_query("Kaiser Permanente") == "kaiser"
    # Unknown plans pass through lowercased so the filter is honest about no-match.
    assert normalize_plan_query("Wellcare") == "wellcare"
    assert normalize_plan_query("") is None
    assert normalize_plan_query(None) is None
