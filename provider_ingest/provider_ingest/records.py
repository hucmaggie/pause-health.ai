"""The ProviderRecord — the frozen contract shared with the frontend.

Field-for-field identical to the `ProviderRecord` TypeScript type in
`frontend/lib/mulesoft-mocks.ts` and the OpenAPI `Provider` schema in
`mulesoft/pause-provider-experience-api.oas3.yaml`. The whole point of
Provider-graph Phase 1 is to put real NPPES-derived rows behind this
unchanged contract, so this dataclass must not drift from the TS type.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class ProviderRecord:
    npi: str
    name: str
    credentials: list[str]
    specialty: str
    menopauseCertified: bool
    city: str
    state: str
    zip: str
    acceptingNewPatients: bool
    telehealth: bool
    graphScore: float
    # Centroid of the practice ZIP (Census 2020 ZCTA). Both null if the ZIP
    # has no ZCTA centroid (rare PO-box-only / very new ZIPs); the directory
    # then falls back to non-distance ranking for that provider.
    latitude: float | None = None
    longitude: float | None = None
    # Public-registry service-line signals: small set of tokens (e.g. "facog",
    # "whnp", "multi-taxonomy") detected from the provider's NPPES credential
    # text and taxonomy stack. Surfaces evidence that a non-certified provider
    # actually delivers menopause care — feeds a capped bump on graphScore and
    # is shown to the patient as chips. Empty list when nothing matched.
    serviceSignals: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
