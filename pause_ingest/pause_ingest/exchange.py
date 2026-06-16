"""JupyterHealth Exchange upload + readback.

We use ``jupyterhealth-client`` for reads (it exposes a friendly Python
surface) and a raw httpx POST for writes (the client library is mostly
read-oriented today). Both paths use the same OAuth2 client-credentials
token so behavior is consistent.

If ``jupyterhealth-client`` later grows a first-class ``upload_observation``
helper, swap the httpx call out for that — no public API change here.
"""

from __future__ import annotations

from typing import Any

import httpx

from .config import IngestConfig


def _fetch_oauth_token(config: IngestConfig, scope: str | None = None) -> str:
    """Exchange the client credentials for a short-lived OAuth2 token.

    `scope` is optional: real JHE's OAuth2 vocabulary is `openid email`
    and rejects custom strings like `observation.write` with
    `invalid_scope`. JHE authorizes FHIR writes by Study/Patient/Scope
    consent at the resource layer, not by OAuth scope.
    """
    data = {
        "grant_type": "client_credentials",
        "client_id": config.jhe_client_id,
        "client_secret": config.jhe_client_secret,
    }
    if scope:
        data["scope"] = scope
    response = httpx.post(
        f"{config.jhe_base_url}/o/token/",
        data=data,
        timeout=10.0,
    )
    response.raise_for_status()
    token = response.json().get("access_token")
    if not token:
        raise RuntimeError(
            f"JHE token response did not include access_token: {response.text!r}"
        )
    return token


def upload_observation(
    observation: dict[str, Any],
    *,
    config: IngestConfig,
) -> dict[str, Any]:
    """POST a FHIR R5 Observation to JupyterHealth Exchange.

    JHE routes Observation writes between two handlers based on the
    coding ``system`` in the resource: codings under
    ``https://w3id.org/openmhealth`` go to the *mapped* OMH handler; any
    other coding (e.g. our derived ``https://pause-health.ai/schemas/derived``
    HRV-features payload) goes to the *auxiliary* handler, which requires
    an ``X-JHE-FHIR-Source-ID`` header pointing at a registered
    ``FhirSource`` row that ties the patient to the data source.

    We send the header whenever the config carries a fhir_source_id. The
    real JHE ignores the header when the observation routes to the
    mapped handler, so it's safe to always send it.

    Returns the server-echoed Observation (including its server-assigned id).
    Raises ``httpx.HTTPStatusError`` on non-2xx.
    """
    token = _fetch_oauth_token(config)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if config.fhir_source_id:
        headers["X-JHE-FHIR-Source-ID"] = config.fhir_source_id
    response = httpx.post(
        f"{config.jhe_base_url}/fhir/r5/Observation",
        headers=headers,
        json=observation,
        timeout=15.0,
    )
    response.raise_for_status()
    return response.json()


def read_recent_observations(
    *,
    config: IngestConfig,
    count: int = 10,
) -> list[dict[str, Any]]:
    """Read the most recent observations for the configured patient.

    Uses ``jupyterhealth-client`` so we exercise the same library a Pause
    backend service would use in production.

    Implementation note: ``JupyterHealthClient`` 0.2.0 takes a pre-issued
    bearer token, not a client_id/client_secret pair. We do the OAuth2
    client-credentials exchange ourselves (same as ``upload_observation``)
    and hand the resulting access_token to the client. If the upstream
    client library adds first-class client-credentials support later,
    swap this for that -- the public API of this function is unchanged.
    """
    try:
        from jupyterhealth_client import JupyterHealthClient  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "jupyterhealth-client is not installed. Run `pip install -e \".[dev]\"` "
            "inside pause_ingest/."
        ) from exc

    token = _fetch_oauth_token(config)
    client = JupyterHealthClient(url=config.jhe_base_url, token=token)
    # The 0.2.0 client takes `limit`, not `count`, and returns a Generator.
    observations = client.list_observations(
        patient_id=config.patient_fhir_id,  # type: ignore[arg-type]
        limit=count,
    )
    return list(observations)
