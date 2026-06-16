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
    # Disposition against published state sanction lists. Today the only
    # source is the CA Medi-Cal Suspended & Ineligible list (see
    # sanctions.py); a provider on that list is filtered out at build time,
    # so survivors always carry "active" here. The field exists so the
    # contract is honest about what was checked and so additional states /
    # statuses (e.g. "probation") can land additively.
    licenseStatus: str = "active"
    # Plans the provider accepts — today derived synthetically per-NPI by
    # `insurance.py` because no public payer feed is available; the shape is
    # real (so the API contract, filter UX, and agent framing are real) and
    # a paid data partnership can replace the derivation later without any
    # downstream changes. Always non-empty (Medicare is the conservative
    # floor).
    insuranceAccepted: list[str] = field(default_factory=list)
    # How `menopauseCertified` was earned — set only when certified, else None:
    #   "curated-overlay": on the curated MSCP roster (authoritative; the
    #     synthetic overlay today, a licensed Menopause Society feed later).
    #   "self-reported": a self-reported MSCP/NCMP token in the provider's own
    #     NPPES credential text — honest, but not independently verified.
    # Overlay membership wins when both are true (the roster is authoritative),
    # which also keeps this in lockstep with the frontend's overlay-based
    # `deriveCredentialSource` for artifacts built before this field existed.
    # Mirrors `credentialSource` on the TS ProviderRecord + the OAS schema.
    credentialSource: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)
