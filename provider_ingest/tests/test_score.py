from provider_ingest.score import MSCP_BOOST, graph_score


def _base(**kw):
    args = dict(
        relevance=1.0,
        accepting_new_patients=True,
        telehealth=True,
        has_location=True,
        menopause_certified=False,
    )
    args.update(kw)
    return graph_score(**args)


def test_perfect_uncertified_is_one():
    assert _base() == 1.0


def test_score_in_unit_range_and_clamped():
    # Certified perfect provider would exceed 1.0 before clamping.
    assert _base(menopause_certified=True) == 1.0


def test_certification_boosts_score():
    uncertified = _base(relevance=0.5)
    certified = _base(relevance=0.5, menopause_certified=True)
    assert certified > uncertified
    assert round(certified, 4) == round(uncertified * (1.0 + MSCP_BOOST), 4)


def test_higher_relevance_ranks_higher():
    assert _base(relevance=1.0) > _base(relevance=0.5)


def test_accepting_and_telehealth_increase_score():
    full = _base()
    no_access = _base(accepting_new_patients=False, telehealth=False)
    assert full > no_access


def test_missing_location_lowers_score():
    assert _base(has_location=False) < _base(has_location=True)
