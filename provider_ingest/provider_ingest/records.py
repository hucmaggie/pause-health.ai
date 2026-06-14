"""The ProviderRecord — the frozen contract shared with the frontend.

Field-for-field identical to the `ProviderRecord` TypeScript type in
`frontend/lib/mulesoft-mocks.ts` and the OpenAPI `Provider` schema in
`mulesoft/pause-provider-experience-api.oas3.yaml`. The whole point of
Provider-graph Phase 1 is to put real NPPES-derived rows behind this
unchanged contract, so this dataclass must not drift from the TS type.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass


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

    def to_dict(self) -> dict:
        return asdict(self)
