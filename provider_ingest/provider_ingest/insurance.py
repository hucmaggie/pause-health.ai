"""Insurance-acceptance overlay (synthetic).

There is **no public, free, structured payer/in-network feed**. Aetna, BCBS,
UnitedHealthcare etc. publish per-state PPACA Machine-Readable Files (the
"price transparency" feeds), but they're enormous, fragmented, and don't
identify providers by NPI in any consistent way. A real insurance match
needs a paid data partnership (e.g. Ribbon Health, Turquoise) or per-payer
contracts.

So this overlay is **deterministic and synthetic** — it gives every
ProviderRecord an `insuranceAccepted: list[str]` derived from a stable
SHA-256 hash of the NPI. The shape is real (the API contract, the filter
UX, the agent framing); the data is honest about being synthetic. When a
real feed lands, swap this module's logic — the ProviderRecord field, the
OAS schema, and the agent prompts don't change.

Plans we model are the largest US payers + the public programs everyone is
expected to support: Medicare, Medicaid, Aetna, BCBS, UnitedHealthcare,
Cigna, Humana, and Kaiser. The deterministic mapping yields ~3 plans per
provider on average (Medicare almost always; commercial mix varies). It is
**stable across rebuilds for the same NPI** so the directory and the demo
personas are reproducible.

Not a substitute for a real partnership; clearly flagged in `provenance` and
the runbook.
"""

from __future__ import annotations

import hashlib

# Order matters: this is the canonical render order chips are shown in.
# Stable so consumers can render without their own sort.
PLANS: tuple[str, ...] = (
    "medicare",
    "medicaid",
    "aetna",
    "bcbs",
    "uhc",
    "cigna",
    "humana",
    "kaiser",
)


# Per-plan acceptance probabilities, calibrated to roughly match real-world
# physician participation rates. Tuned so the directory looks plausible at
# the population level — never relied on per-provider as ground truth.
_PLAN_THRESHOLDS: tuple[tuple[str, int], ...] = (
    ("medicare", 85),
    ("medicaid", 65),
    ("aetna", 50),
    ("bcbs", 50),
    ("uhc", 45),
    ("cigna", 35),
    ("humana", 30),
    ("kaiser", 20),
)


def derive_insurance_accepted(npi: str) -> list[str]:
    """NPI → deterministic, stable list of accepted plans.

    Uses a SHA-256 hash with a per-plan salt so each plan gets a pseudo-
    uniform [0,100) draw and the per-plan booleans are decorrelated. Pure
    function; identical input always yields identical output, so the
    directory is reproducible across rebuilds. NPIs start with a fixed
    Type-code digit, so we can't use the raw digits as entropy — the hash
    avoids that pitfall entirely.

    A real feed later overwrites this with ground truth and downstream code
    is unchanged.
    """
    if not npi:
        # No NPI → degenerate; conservative default of just Medicare so
        # consumers don't render an empty chip-row that looks like a UI bug.
        return ["medicare"]

    accepted: list[str] = []
    for plan, threshold in _PLAN_THRESHOLDS:
        h = hashlib.sha256(f"{plan}:{npi}".encode("utf-8")).digest()
        # Take the first 4 bytes as a uint32 for a fast, well-distributed draw.
        draw = int.from_bytes(h[:4], "big") % 100
        if draw < threshold:
            accepted.append(plan)

    if not accepted:
        # Floor: every provider accepts SOMETHING — keep Medicare as the
        # fallback so the chip row is never empty.
        accepted.append("medicare")
    return accepted


def normalize_plan_query(plan: str | None) -> str | None:
    """Lowercase + strip + map common synonyms → canonical plan token.

    Callers (the route handler, the agent) pass user-typed plan names. We
    accept casing variants and the most common synonyms; everything else is
    returned as-is so the filter is honest about an unknown plan token
    yielding zero results, rather than silently matching nothing.
    """
    if not plan:
        return None
    p = plan.strip().lower()
    aliases = {
        "blue cross": "bcbs",
        "blue cross blue shield": "bcbs",
        "blue shield": "bcbs",
        "united": "uhc",
        "united healthcare": "uhc",
        "unitedhealthcare": "uhc",
        "kaiser permanente": "kaiser",
    }
    return aliases.get(p, p)
