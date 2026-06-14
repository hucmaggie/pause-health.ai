"""NUCC Healthcare Provider Taxonomy codes relevant to menopause care.

The CMS NPPES bulk file codes each provider with one or more NUCC taxonomy
codes. Provider-graph Phase 1 narrows the ~8.5M-row national file to the
clinicians who plausibly deliver menopause care by filtering on this set.

Codes are the real NUCC taxonomy values (https://nucc.org/ — the code set CMS
uses in NPPES). Each maps to the human-readable `specialty` string that lands
on the ProviderRecord the frontend already renders, plus a default credential
label used when the provider's free-text credential field is empty.

This is deliberately a *curated* menopause-relevant slice, not the full NUCC
set. Phase 2 widens it (e.g. urogynecology, behavioral health) and adds
state-license + service-line signals.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Taxonomy:
    code: str
    specialty: str
    default_credential: str
    # Relevance weight (0-1) — how central this specialty is to menopause care.
    # Feeds the graphScore so an OB/GYN outranks a generalist, all else equal.
    relevance: float


# Curated menopause-relevant taxonomies. Keep the `specialty` strings aligned
# with what the frontend ProviderRecord renders.
MENOPAUSE_TAXONOMIES: dict[str, Taxonomy] = {
    # Obstetrics & Gynecology family
    "207V00000X": Taxonomy("207V00000X", "Obstetrics & Gynecology", "MD", 1.00),
    "207VG0400X": Taxonomy("207VG0400X", "Gynecology", "MD", 0.98),
    "207VE0102X": Taxonomy(
        "207VE0102X", "Reproductive Endocrinology & Infertility", "MD", 0.95
    ),
    "207VM0101X": Taxonomy("207VM0101X", "Maternal & Fetal Medicine", "MD", 0.70),
    # Endocrinology (vasomotor / metabolic overlap)
    "207RE0101X": Taxonomy(
        "207RE0101X", "Endocrinology, Diabetes & Metabolism", "MD", 0.90
    ),
    # Primary care that commonly manages midlife women
    "207Q00000X": Taxonomy("207Q00000X", "Family Medicine", "MD", 0.75),
    "207R00000X": Taxonomy("207R00000X", "Internal Medicine", "MD", 0.72),
    # Advanced practice
    "363LW0102X": Taxonomy(
        "363LW0102X", "Nurse Practitioner — Women's Health", "NP", 0.88
    ),
    "363LF0000X": Taxonomy("363LF0000X", "Nurse Practitioner — Family", "NP", 0.74),
    "175M00000X": Taxonomy("175M00000X", "Certified Nurse-Midwife (Lactation)", "CNM", 0.80),
    "176B00000X": Taxonomy("176B00000X", "Midwife", "CNM", 0.70),
    "363AM0700X": Taxonomy(
        "363AM0700X", "Physician Assistant — Medical", "PA", 0.68
    ),
    "364SW0102X": Taxonomy(
        "364SW0102X", "Clinical Nurse Specialist — Women's Health", "CNS", 0.82
    ),
}


def is_menopause_relevant(code: str) -> bool:
    """True if a taxonomy code is in the curated menopause-relevant set."""
    return code.strip().upper() in MENOPAUSE_TAXONOMIES


def lookup(code: str) -> Taxonomy | None:
    """Return the Taxonomy for a code, or None if not menopause-relevant."""
    return MENOPAUSE_TAXONOMIES.get(code.strip().upper())


def best_relevant(codes: list[str]) -> Taxonomy | None:
    """Pick the most menopause-central taxonomy from a provider's code list.

    NPPES providers carry up to 15 taxonomy codes; we rank by relevance so a
    provider who is both an OB/GYN (1.00) and Family Medicine (0.75) is
    represented as the OB/GYN.
    """
    candidates = [t for t in (lookup(c) for c in codes) if t is not None]
    if not candidates:
        return None
    return max(candidates, key=lambda t: t.relevance)
