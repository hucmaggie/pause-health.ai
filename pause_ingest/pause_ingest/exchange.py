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


def _fetch_oauth_token(config: IngestConfig, scope: str) -> str:
    """Exchange the client credentials for a short-lived OAuth2 token."""
    response = httpx.post(
        f"{config.jhe_base_url}/o/token/",
        data={
            "grant_type": "client_credentials",
            "client_id": config.jhe_client_id,
            "client_secret": config.jhe_client_secret,
            "scope": scope,
        },
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

    Returns the server-echoed Observation (including its server-assigned id).
    Raises ``httpx.HTTPStatusError`` on non-2xx.
    """
    token = _fetch_oauth_token(config, scope="observation.write")
    response = httpx.post(
        f"{config.jhe_base_url}/fhir/r5/Observation",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/fhir+json",
            "Accept": "application/fhir+json",
        },
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
    """
    try:
        from jupyterhealth_client import JupyterHealthClient  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "jupyterhealth-client is not installed. Run `pip install -e \".[dev]\"` "
            "inside pause_ingest/."
        ) from exc

    client = JupyterHealthClient(
        base_url=config.jhe_base_url,
        client_id=config.jhe_client_id,
        client_secret=config.jhe_client_secret,
    )
    observations = client.list_observations(
        patient_id=config.patient_fhir_id,
        count=count,
    )
    return list(observations)
