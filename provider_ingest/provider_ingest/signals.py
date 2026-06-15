"""Service-signal detection for ProviderRecords.

Beyond the binary `menopauseCertified` flag (MSCP / NCMP), NPPES rows carry
several other public-registry signals that suggest a provider actually
delivers menopause-relevant care — not just that their primary taxonomy is in
the curated set. We surface those signals as a list (`serviceSignals`) on the
ProviderRecord and feed them into a small graphScore bump, so the
`relevant-local` tier (nearby, non-certified) can be sub-ranked honestly:

  FACOG / FACOOG  Fellow of the American College of Obstetricians and
                  Gynecologists — board-certified OB/GYN, surfaces directly
                  from the credential text.
  FAAFP           Fellow of the American Academy of Family Physicians — a
                  board-certified family physician.
  FACE            Fellow of the American College of Endocrinology — a
                  board-certified endocrinologist.
  WHNP / WHNP-BC  Women's Health Nurse Practitioner (board-certified).
  CNM             Certified Nurse-Midwife.
  multi-taxonomy  Two or more taxonomy codes from the curated menopause set
                  (e.g. OB/GYN + Reproductive Endocrinology) — a real signal
                  the practice spans menopause-adjacent specialties.

These tokens are detected directly from the public registry. Each contributes
a small, capped boost to graphScore (see `score.py`); the sum is bounded so
even a provider with all signals cannot outrank a certified provider.
"""

from __future__ import annotations

from .taxonomy import is_menopause_relevant

# Tokens to look for in NPPES "Provider Credential Text" once normalized
# (uppercased, punctuation stripped). Detection is exact-match on the
# already-normalized credential list — no substring lookups, so "FACOG" never
# matches "BCFACOGY" etc.
_CREDENTIAL_SIGNALS: dict[str, str] = {
    "FACOG": "facog",
    "FACOOG": "facog",
    "FAAFP": "faafp",
    "FACE": "face",
    "FACP": "facp",
    "WHNP": "whnp",
    "WHNP-BC": "whnp",
    "CNM": "cnm",
}


def credential_signals(credentials: list[str]) -> list[str]:
    """Pull menopause-relevant signal tokens out of a normalized credential list."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in credentials:
        c = raw.strip().upper()
        sig = _CREDENTIAL_SIGNALS.get(c)
        if sig and sig not in seen:
            seen.add(sig)
            out.append(sig)
    return out


def multi_taxonomy_signal(codes: list[str]) -> bool:
    """True when the provider lists ≥2 menopause-relevant NUCC codes.

    A row with one OB/GYN code and one Reproductive Endocrinology code is a
    much stronger menopause signal than a single OB/GYN code alone, because
    the secondary code is visible recognition that the practice covers more
    than the taxonomy header. The threshold is two — we don't reward every
    menopause-relevant code stacked on top.
    """
    relevant = sum(1 for c in codes if c and is_menopause_relevant(c))
    return relevant >= 2


def detect_signals(credentials: list[str], taxonomy_codes: list[str]) -> list[str]:
    """Combined service-signal detector. Stable, deterministic order."""
    signals = credential_signals(credentials)
    if multi_taxonomy_signal(taxonomy_codes):
        signals.append("multi-taxonomy")
    return signals
