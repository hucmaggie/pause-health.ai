"""Salesforce Data Cloud Ingestion API client (Phase 2 hardening).

This is the push side of the Phase 2 Data 360 grounding pipeline. The
frontend (``frontend/lib/salesforce/data-cloud.ts``) *reads* Calculated
Insights out of Data Cloud; this module *writes* the flattened wearable
feature rows those Insights aggregate over, straight into a Data Cloud
Ingestion API connector — no publicly-reachable JupyterHealth instance
required.

Flow (mirrors the frontend's two-legged auth exactly):

    1. client_credentials grant against
         POST <instance_url>/services/oauth2/token
       → a core Salesforce access token.
    2. CDP token exchange against
         POST <instance_url>/services/a360/token
         grant_type=urn:salesforce:grant-type:external:cdp
       → a Data-Cloud-scoped token + the authoritative tenant host.
    3. Streaming ingest:
         POST <tenant>/api/v1/ingest/sources/{connector}/{object}
         { "data": [ {record}, ... ] }

The Connected App must carry the ``cdp_ingest_api`` scope (alongside the
``cdp_query_api`` the read path uses). See
docs/PHASE_2_INGESTION_API_RUNBOOK.md for the org-side setup.

Records are plain dicts keyed by the DLO schema field names defined in
``data-cloud/Pause_Wearable_Feature.dlo-schema.json``.
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Iterable, Literal
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv

ObservationType = Literal["hrv_rmssd", "sleep_session", "hot_flash", "night_sweat"]

# Default Ingestion API connector / object API names. Override via env so the
# same code targets a differently-named connector in another org.
DEFAULT_CONNECTOR = "Pause_Wearable"
DEFAULT_OBJECT = "wearable_feature"

_CDP_GRANT = "urn:salesforce:grant-type:external:cdp"


class DataCloudConfigError(RuntimeError):
    """Raised when required Data Cloud ingestion settings are missing."""


@dataclass(frozen=True)
class WearableFeatureRecord:
    """One flattened wearable-feature row destined for the Ingestion API.

    These flatten the base64-OMH FHIR Observations the ingest worker
    produces into the columnar shape Data Cloud's Calculated Insights can
    aggregate. Field names match the DLO schema JSON exactly.

    - ``record_id``: idempotency key. Re-pushing the same id upserts rather
      than duplicating, so the cohort generator is safe to re-run.
    - ``unified_id``: the Salesforce Health Cloud Contact.Id — the join key
      that resolves to ssot__Individual__dlm.ssot__Id__c / the CI
      ``unified_id__c`` dimension.
    - ``value_num``: metric value; semantics depend on ``observation_type``
      (RMSSD ms / sleep-efficiency fraction / event severity).
    """

    record_id: str
    unified_id: str
    observation_type: ObservationType
    effective_date: str  # ISO-8601
    value_num: float
    source: str

    def to_ingest_dict(self) -> dict:
        return asdict(self)


def iso_utc(dt: datetime) -> str:
    """Serialize a datetime to an ISO-8601 string Data Cloud accepts.

    Naive datetimes are assumed UTC. Data Cloud's dateTime parser wants a
    timezone offset, so we always emit one.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt.isoformat()


@dataclass(frozen=True)
class DataCloudIngestConfig:
    """Settings for the Data Cloud Ingestion API push.

    Reuses the same Connected App credentials as the Phase 1 SOQL path and
    the frontend read path; only the connector/object names are new.
    """

    instance_url: str
    client_id: str
    client_secret: str
    connector: str
    object_name: str

    @classmethod
    def from_env(cls, *, dotenv_path: str | None = None) -> "DataCloudIngestConfig":
        load_dotenv(dotenv_path=dotenv_path)

        def required(name: str) -> str:
            value = os.environ.get(name, "").strip()
            if not value:
                raise DataCloudConfigError(
                    f"Missing required environment variable: {name}. "
                    "See docs/PHASE_2_INGESTION_API_RUNBOOK.md."
                )
            return value

        return cls(
            instance_url=required("SF_INSTANCE_URL").rstrip("/"),
            client_id=required("SF_CLIENT_ID"),
            client_secret=required("SF_CLIENT_SECRET"),
            connector=os.environ.get("SF_DC_INGEST_CONNECTOR", DEFAULT_CONNECTOR).strip()
            or DEFAULT_CONNECTOR,
            object_name=os.environ.get("SF_DC_INGEST_OBJECT", DEFAULT_OBJECT).strip()
            or DEFAULT_OBJECT,
        )


@dataclass(frozen=True)
class DataCloudToken:
    access_token: str
    tenant_url: str  # normalized, scheme + host, no trailing slash


def _normalize_tenant_host(raw: str) -> str:
    trimmed = raw.strip().rstrip("/")
    if trimmed.startswith("http://") or trimmed.startswith("https://"):
        return trimmed
    return f"https://{trimmed}"


class DataCloudClientBase:
    """Shared two-legged Data Cloud auth for the ingest + query clients.

    Stateless except for a lazily-fetched, per-instance Data Cloud token.
    Network calls use httpx with explicit timeouts so a hung tenant can't
    wedge the caller. Subclasses add the actual ingest / query calls.
    """

    def __init__(self, config: DataCloudIngestConfig, *, timeout: float = 30.0):
        self._cfg = config
        self._timeout = timeout
        self._token: DataCloudToken | None = None

    # -- auth -----------------------------------------------------------------

    def _fetch_core_token(self, client: httpx.Client) -> tuple[str, str]:
        """client_credentials grant → (access_token, instance_url)."""
        resp = client.post(
            f"{self._cfg.instance_url}/services/oauth2/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self._cfg.client_id,
                "client_secret": self._cfg.client_secret,
            },
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        payload = resp.json()
        token = payload.get("access_token")
        instance_url = payload.get("instance_url", self._cfg.instance_url)
        if not token:
            raise DataCloudConfigError("core token response missing access_token")
        return token, instance_url.rstrip("/")

    def _exchange_for_dc_token(
        self, client: httpx.Client, core_token: str, instance_url: str
    ) -> DataCloudToken:
        """Exchange the core token for a Data-Cloud-scoped token (a360)."""
        resp = client.post(
            f"{instance_url}/services/a360/token",
            data={
                "grant_type": _CDP_GRANT,
                "subject_token": core_token,
                "subject_token_type": "urn:ietf:params:oauth:token-type:access_token",
            },
            headers={"Accept": "application/json"},
        )
        if resp.status_code >= 400:
            # The c360a gateway returns a 400 with an often-empty body when the
            # exchange is rejected; surface what we can.
            raise DataCloudConfigError(
                f"Data Cloud token exchange failed ({resp.status_code}): "
                f"{resp.text[:400] or '<empty body>'}"
            )
        payload = resp.json()
        access = payload.get("access_token")
        tenant = payload.get("instance_url")
        if not access or not tenant:
            raise DataCloudConfigError(
                "token exchange response missing access_token or instance_url"
            )
        return DataCloudToken(
            access_token=access, tenant_url=_normalize_tenant_host(tenant)
        )

    def _get_token(self, client: httpx.Client) -> DataCloudToken:
        if self._token is None:
            core, instance_url = self._fetch_core_token(client)
            self._token = self._exchange_for_dc_token(client, core, instance_url)
        return self._token

    def check_auth(self) -> str:
        """Fetch a Data Cloud token and return the tenant URL.

        Isolates the two-legged auth so the preflight can tell an auth problem
        (bad creds / Data Cloud not enabled / missing CDP grant) apart from a
        data problem (DMO or CI not created yet). Raises on any auth failure.
        """
        with httpx.Client(timeout=self._timeout) as client:
            return self._get_token(client).tenant_url


class DataCloudIngestClient(DataCloudClientBase):
    """Thin Data Cloud Ingestion API client (the write path).

    Construct with a config; call :meth:`ingest`. Needs the ``cdp_ingest_api``
    scope on the Connected App.
    """

    # -- ingest ---------------------------------------------------------------

    def ingest(self, records: Iterable[WearableFeatureRecord]) -> dict:
        """Push records to the Ingestion API. Returns the parsed response.

        Records are sent in a single ``{"data": [...]}`` batch. The Streaming
        Ingestion API accepts up to 200 records / request; callers with more
        should chunk (see :func:`chunked`).
        """
        batch = [r.to_ingest_dict() for r in records]
        if not batch:
            return {"accepted": 0, "skipped": "empty batch"}

        with httpx.Client(timeout=self._timeout) as client:
            token = self._get_token(client)
            path = (
                f"{token.tenant_url}/api/v1/ingest/sources/"
                f"{self._cfg.connector}/{self._cfg.object_name}"
            )
            resp = client.post(
                path,
                json={"data": batch},
                headers={
                    "Authorization": f"Bearer {token.access_token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
            )
            if resp.status_code >= 400:
                raise DataCloudConfigError(
                    f"ingest POST failed ({resp.status_code}): {resp.text[:600]}"
                )
            # The Ingestion API returns 202 Accepted with an empty/short body.
            try:
                body = resp.json()
            except ValueError:
                body = {}
            return {"accepted": len(batch), "status_code": resp.status_code, **body}


class DataCloudQueryClient(DataCloudClientBase):
    """Read Calculated Insights back out of Data Cloud (the verify path).

    The read-back counterpart to :class:`DataCloudIngestClient`: after the push
    + CI refresh, this queries each activated Calculated Insight exactly the
    way the frontend does (``frontend/lib/salesforce/data-cloud.ts``) so a
    maintainer can prove the CIs return real per-patient values instead of the
    ``MAX(constant)`` mock. Needs the ``cdp_query_api`` scope on the Connected
    App (the read path already relies on it).
    """

    def query_calculated_insight(
        self, insight_api_name: str, filter_expr: str | None = None
    ) -> list[dict]:
        """GET one Calculated Insight's rows, optionally filtered.

        Mirrors the frontend read exactly:
            GET {tenant}/api/v1/insight/calculated-insights/{name}?filters=[field=value]

        ``filter_expr`` is the bare bracketed expression the Data 360 Insight
        API expects, e.g. ``[unified_id__c=003Hp00003b9bdqIAA]`` — the brackets
        are literal syntax, and httpx percent-encodes them the same way the
        frontend's URLSearchParams does. Returns the ``data`` array (empty when
        the CI has no row for the filter).
        """
        params = {"filters": filter_expr} if filter_expr else None
        with httpx.Client(timeout=self._timeout) as client:
            token = self._get_token(client)
            path = (
                f"{token.tenant_url}/api/v1/insight/calculated-insights/"
                f"{insight_api_name}"
            )
            resp = client.get(
                path,
                params=params,
                headers={
                    "Authorization": f"Bearer {token.access_token}",
                    "Accept": "application/json",
                },
            )
            if resp.status_code >= 400:
                raise DataCloudConfigError(
                    f"insight query for {insight_api_name} failed "
                    f"({resp.status_code}): {resp.text[:600]}"
                )
            try:
                body = resp.json()
            except ValueError:
                return []
            data = body.get("data")
            return data if isinstance(data, list) else []

    def query(self, sql: str) -> list[dict]:
        """Run a Data Cloud SQL query via ``POST /api/v1/query``.

        Mirrors the frontend's ``dcQuery`` (data-cloud.ts). Used by the
        preflight to probe whether the ``Pause_Wearable_Feature__dlm`` DMO
        exists and holds rows; raises :class:`DataCloudConfigError` on an HTTP
        error (e.g. the DMO not existing yet).
        """
        with httpx.Client(timeout=self._timeout) as client:
            token = self._get_token(client)
            resp = client.post(
                f"{token.tenant_url}/api/v1/query",
                json={"sql": sql},
                headers={
                    "Authorization": f"Bearer {token.access_token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
            )
            if resp.status_code >= 400:
                raise DataCloudConfigError(
                    f"query failed ({resp.status_code}): {resp.text[:600]}"
                )
            try:
                body = resp.json()
            except ValueError:
                return []
            data = body.get("data")
            return data if isinstance(data, list) else []


def chunked(records: list[WearableFeatureRecord], size: int = 200) -> Iterable[list]:
    """Yield successive ``size``-length chunks (Ingestion API caps at 200)."""
    for i in range(0, len(records), size):
        yield records[i : i + size]


def build_ingest_payload(records: Iterable[WearableFeatureRecord]) -> dict:
    """Build the ``{"data": [...]}`` payload without sending it.

    Used by the dry-run path of the example script and by tests, so the
    record→payload shaping is verifiable without a live tenant.
    """
    return {"data": [r.to_ingest_dict() for r in records]}
