"""Tests for the Data Cloud Ingestion API client.

These cover the parts that don't need a live tenant: record→payload shaping,
config loading, batching, and the auth/ingest HTTP contract (exercised
against an httpx MockTransport so the two-legged token flow and the ingest
POST are verified without network).
"""

from __future__ import annotations

import json
from urllib.parse import parse_qs

import httpx
import pytest

from pause_ingest.data_cloud import (
    DataCloudConfigError,
    DataCloudIngestClient,
    DataCloudIngestConfig,
    DataCloudQueryClient,
    WearableFeatureRecord,
    build_ingest_payload,
    chunked,
    iso_utc,
)
from datetime import datetime, timezone


def _rec(i: int) -> WearableFeatureRecord:
    return WearableFeatureRecord(
        record_id=f"003X:{i}",
        unified_id="003X000000000001",
        observation_type="hrv_rmssd",
        effective_date=iso_utc(datetime(2026, 6, 13, tzinfo=timezone.utc)),
        value_num=38.2,
        source="dbdp-flirt",
    )


def test_build_payload_shape():
    payload = build_ingest_payload([_rec(0), _rec(1)])
    assert set(payload.keys()) == {"data"}
    assert len(payload["data"]) == 2
    assert payload["data"][0] == {
        "record_id": "003X:0",
        "unified_id": "003X000000000001",
        "observation_type": "hrv_rmssd",
        "effective_date": "2026-06-13T00:00:00+00:00",
        "value_num": 38.2,
        "source": "dbdp-flirt",
    }


def test_iso_utc_adds_offset_to_naive():
    s = iso_utc(datetime(2026, 6, 13, 1, 2, 3))
    assert s.endswith("+00:00")


def test_chunked_caps_batches():
    records = [_rec(i) for i in range(450)]
    batches = list(chunked(records, size=200))
    assert [len(b) for b in batches] == [200, 200, 50]


def test_config_from_env_requires_core_vars(monkeypatch):
    for var in ("SF_INSTANCE_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET"):
        monkeypatch.delenv(var, raising=False)
    with pytest.raises(DataCloudConfigError):
        # dotenv_path to a nonexistent file so a real .env can't satisfy it.
        DataCloudIngestConfig.from_env(dotenv_path="/nonexistent/.env")


def test_config_from_env_defaults(monkeypatch):
    monkeypatch.setenv("SF_INSTANCE_URL", "https://example.my.salesforce.com/")
    monkeypatch.setenv("SF_CLIENT_ID", "cid")
    monkeypatch.setenv("SF_CLIENT_SECRET", "secret")
    monkeypatch.delenv("SF_DC_INGEST_CONNECTOR", raising=False)
    monkeypatch.delenv("SF_DC_INGEST_OBJECT", raising=False)
    cfg = DataCloudIngestConfig.from_env(dotenv_path="/nonexistent/.env")
    assert cfg.instance_url == "https://example.my.salesforce.com"  # trailing / stripped
    assert cfg.connector == "Pause_Wearable"
    assert cfg.object_name == "wearable_feature"


def _config() -> DataCloudIngestConfig:
    return DataCloudIngestConfig(
        instance_url="https://example.my.salesforce.com",
        client_id="cid",
        client_secret="secret",
        connector="Pause_Wearable",
        object_name="wearable_feature",
    )


def test_ingest_two_legged_flow(monkeypatch):
    """The client must: get a core token, exchange it, then POST to the tenant."""
    seen: dict[str, dict] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/services/oauth2/token"):
            seen["core"] = dict(request.url.params) or {"body": request.content.decode()}
            return httpx.Response(
                200,
                json={
                    "access_token": "CORE_TOKEN",
                    "instance_url": "https://example.my.salesforce.com",
                },
            )
        if url.endswith("/services/a360/token"):
            seen["exchange_body"] = request.content.decode()
            return httpx.Response(
                200,
                json={
                    "access_token": "DC_TOKEN",
                    "instance_url": "https://tenant.c360a.salesforce.com",
                },
            )
        if "/api/v1/ingest/sources/Pause_Wearable/wearable_feature" in url:
            seen["ingest_auth"] = request.headers.get("authorization")
            seen["ingest_body"] = json.loads(request.content.decode())
            seen["ingest_host"] = request.url.host
            return httpx.Response(202, json={})
        raise AssertionError(f"unexpected request to {url}")

    transport = httpx.MockTransport(handler)

    # Patch httpx.Client so the client-under-test uses our transport.
    real_client = httpx.Client

    def fake_client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "Client", fake_client)

    client = DataCloudIngestClient(_config())
    result = client.ingest([_rec(0), _rec(1)])

    assert result["accepted"] == 2
    assert result["status_code"] == 202
    # CDP grant was used in the exchange (form body is URL-encoded).
    exchange_params = parse_qs(seen["exchange_body"])
    assert exchange_params["grant_type"] == ["urn:salesforce:grant-type:external:cdp"]
    assert exchange_params["subject_token"] == ["CORE_TOKEN"]
    # Ingest used the exchanged DC token and the authoritative tenant host.
    assert seen["ingest_auth"] == "Bearer DC_TOKEN"
    assert seen["ingest_host"] == "tenant.c360a.salesforce.com"
    assert len(seen["ingest_body"]["data"]) == 2


def test_ingest_raises_on_exchange_failure(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/services/oauth2/token"):
            return httpx.Response(200, json={"access_token": "CORE", "instance_url": "https://example.my.salesforce.com"})
        if url.endswith("/services/a360/token"):
            return httpx.Response(400, text="")  # empty-body 400, the classic DC failure
        raise AssertionError("should not reach ingest")

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client
    monkeypatch.setattr(
        httpx, "Client", lambda *a, **k: real_client(*a, **{**k, "transport": transport})
    )

    client = DataCloudIngestClient(_config())
    with pytest.raises(DataCloudConfigError):
        client.ingest([_rec(0)])


def test_ingest_empty_batch_is_noop():
    client = DataCloudIngestClient(_config())
    result = client.ingest([])
    assert result["accepted"] == 0


def _mock_two_legged(monkeypatch, insight_handler):
    """Wire httpx.Client to a MockTransport that serves the two-legged auth,
    then delegates any insight GET to `insight_handler(request)`."""

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/services/oauth2/token"):
            return httpx.Response(
                200,
                json={"access_token": "CORE", "instance_url": "https://example.my.salesforce.com"},
            )
        if url.endswith("/services/a360/token"):
            return httpx.Response(
                200,
                json={"access_token": "DC_TOKEN", "instance_url": "https://tenant.c360a.salesforce.com"},
            )
        if "/api/v1/insight/calculated-insights/" in url:
            return insight_handler(request)
        raise AssertionError(f"unexpected request to {url}")

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client
    monkeypatch.setattr(
        httpx, "Client", lambda *a, **k: real_client(*a, **{**k, "transport": transport})
    )


def test_query_calculated_insight_two_legged(monkeypatch):
    """Query client exchanges the token, then GETs the insight on the tenant host."""
    seen: dict = {}

    def insight_handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        seen["host"] = request.url.host
        seen["path"] = request.url.path
        seen["filters"] = request.url.params.get("filters")
        return httpx.Response(
            200,
            json={"data": [{"unified_id__c": "003X", "hrv_rmssd_ms__c": 41.5, "z_score__c": -0.04}]},
        )

    _mock_two_legged(monkeypatch, insight_handler)

    client = DataCloudQueryClient(_config())
    rows = client.query_calculated_insight(
        "Pause_HRV_RMSSD_30d__cio", "[unified_id__c=003X]"
    )

    assert rows == [{"unified_id__c": "003X", "hrv_rmssd_ms__c": 41.5, "z_score__c": -0.04}]
    assert seen["auth"] == "Bearer DC_TOKEN"
    assert seen["host"] == "tenant.c360a.salesforce.com"
    assert seen["path"].endswith("/api/v1/insight/calculated-insights/Pause_HRV_RMSSD_30d__cio")
    # httpx decodes the percent-encoded bracket filter back to the bare form.
    assert seen["filters"] == "[unified_id__c=003X]"


def test_query_calculated_insight_empty_data(monkeypatch):
    _mock_two_legged(monkeypatch, lambda req: httpx.Response(200, json={}))
    client = DataCloudQueryClient(_config())
    assert client.query_calculated_insight("Pause_HRV_RMSSD_30d__cio") == []


def test_query_calculated_insight_raises_on_http_error(monkeypatch):
    _mock_two_legged(monkeypatch, lambda req: httpx.Response(404, text="no such CI"))
    client = DataCloudQueryClient(_config())
    with pytest.raises(DataCloudConfigError):
        client.query_calculated_insight("Nope__cio", "[unified_id__c=003X]")


def test_query_sql_two_legged(monkeypatch):
    """The generic query() posts SQL to /api/v1/query on the tenant host."""
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/services/oauth2/token"):
            return httpx.Response(200, json={"access_token": "CORE", "instance_url": "https://example.my.salesforce.com"})
        if url.endswith("/services/a360/token"):
            return httpx.Response(200, json={"access_token": "DC_TOKEN", "instance_url": "https://tenant.c360a.salesforce.com"})
        if url.endswith("/api/v1/query"):
            seen["auth"] = request.headers.get("authorization")
            seen["host"] = request.url.host
            seen["sql"] = json.loads(request.content.decode())["sql"]
            return httpx.Response(200, json={"data": [{"unified_id__c": "003X"}]})
        raise AssertionError(f"unexpected request to {url}")

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda *a, **k: real_client(*a, **{**k, "transport": transport}))

    client = DataCloudQueryClient(_config())
    rows = client.query("SELECT unified_id__c FROM Pause_Wearable_Feature__dlm LIMIT 1")
    assert rows == [{"unified_id__c": "003X"}]
    assert seen["auth"] == "Bearer DC_TOKEN"
    assert seen["host"] == "tenant.c360a.salesforce.com"
    assert "Pause_Wearable_Feature__dlm" in seen["sql"]


def test_check_auth_returns_tenant_url(monkeypatch):
    _mock_two_legged(monkeypatch, lambda req: httpx.Response(200, json={"data": []}))
    client = DataCloudQueryClient(_config())
    assert client.check_auth() == "https://tenant.c360a.salesforce.com"


def test_check_auth_raises_on_exchange_failure(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/services/oauth2/token"):
            return httpx.Response(200, json={"access_token": "CORE", "instance_url": "https://example.my.salesforce.com"})
        if url.endswith("/services/a360/token"):
            return httpx.Response(400, text="")
        raise AssertionError("should not reach query")

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda *a, **k: real_client(*a, **{**k, "transport": transport}))

    client = DataCloudQueryClient(_config())
    with pytest.raises(DataCloudConfigError):
        client.check_auth()
