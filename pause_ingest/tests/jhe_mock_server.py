"""In-process JupyterHealth Exchange mock server for contract testing.

This module stands up a small HTTP server that mimics the subset of the
JupyterHealth Exchange (JHE) API that ``pause_ingest`` actually calls:

  - POST /o/token/                       (OAuth2 client_credentials grant)
  - POST /fhir/r5/Observation            (FHIR R5 Observation upload)
  - GET  /fhir/r5/Observation            (FHIR search by patient)

It is a **wire-level mock**, not a unit-test double. The pause_ingest
code path (``exchange.upload_observation``, ``exchange.read_recent_observations``)
runs unmodified against this server; we exercise the real httpx +
requests stacks, real JSON encoding/decoding, real OAuth bearer-token
threading, and the real FHIR R5 wire shape.

The mock validates the subset of the JHE contract pause_ingest depends
on:

  - The client must POST grant_type=client_credentials with valid
    client_id + client_secret to /o/token/ to obtain an access_token.
  - Subsequent requests must carry Authorization: Bearer <access_token>.
  - The FHIR Observation POST body must be valid JSON with the
    minimal shape JHE requires (resourceType="Observation", subject,
    valueAttachment).

When any of those expectations is violated, the mock returns the same
status code the real JHE would (401 for bad auth, 400 for bad FHIR,
404 for unknown resources). This is what makes the contract test more
than a happy-path smoke test: it surfaces wire-level bugs that unit
tests with mocked HTTP cannot catch.

For the runbook on swapping this mock for a real JHE instance, see
docs/JHE_SETUP_RUNBOOK.md.
"""

from __future__ import annotations

import json
import secrets
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse


VALID_CLIENT_ID = "pause-ingest-test-client"
VALID_CLIENT_SECRET = "pause-ingest-test-secret"


class JheMockState:
    """Per-server-instance state, shared across handler threads.

    Tracks issued tokens (so we can validate them on subsequent calls)
    and stored observations (so POST -> GET round-trips actually work).
    """

    def __init__(self) -> None:
        self.tokens: set[str] = set()
        # observation_id -> Observation dict (server-side view)
        self.observations: dict[str, dict[str, Any]] = {}
        # Patient id (as string, like "43373") -> list of observation ids
        self.observations_by_patient: dict[str, list[str]] = {}
        # Track call counts so a test can assert "the client really did
        # exchange a token before uploading", not just "the upload landed".
        self.token_calls = 0
        self.upload_calls = 0
        self.list_calls = 0
        # Strict mode: fail on Authorization mismatch (default True).
        # Tests can flip this to test the auth-failure branch of
        # exchange.upload_observation if we ever add one.
        self.strict_auth = True


def _make_handler(state: JheMockState) -> type[BaseHTTPRequestHandler]:
    """Build a handler class closed over a per-server JheMockState."""

    class Handler(BaseHTTPRequestHandler):
        # Silence the per-request access log -- pytest output is cleaner
        # without it. Override `log_message` to a no-op.
        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return

        def _send_json(self, status: int, body: dict[str, Any]) -> None:
            payload = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def _send_error_json(self, status: int, message: str) -> None:
            self._send_json(status, {"error": message})

        def _read_body(self) -> bytes:
            length = int(self.headers.get("Content-Length") or "0")
            if length == 0:
                return b""
            return self.rfile.read(length)

        def _require_bearer(self) -> bool:
            """Return True if the request has a valid Bearer token.

            Sends a 401 and returns False otherwise.
            """
            if not state.strict_auth:
                return True
            auth = self.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                self._send_error_json(401, "Missing Bearer token")
                return False
            token = auth[len("Bearer ") :].strip()
            if token not in state.tokens:
                self._send_error_json(401, "Invalid Bearer token")
                return False
            return True

        # --- POST /o/token/ ---------------------------------------------
        def _handle_token(self) -> None:
            state.token_calls += 1
            body = self._read_body().decode("utf-8")
            # OAuth2 token endpoints expect application/x-www-form-urlencoded.
            params = {k: v[0] for k, v in parse_qs(body).items()}
            grant_type = params.get("grant_type")
            if grant_type != "client_credentials":
                self._send_error_json(
                    400,
                    f"unsupported_grant_type: expected client_credentials, "
                    f"got {grant_type!r}",
                )
                return
            client_id = params.get("client_id")
            client_secret = params.get("client_secret")
            if client_id != VALID_CLIENT_ID or client_secret != VALID_CLIENT_SECRET:
                self._send_error_json(401, "invalid_client")
                return
            token = secrets.token_urlsafe(24)
            state.tokens.add(token)
            self._send_json(
                200,
                {
                    "access_token": token,
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "scope": params.get("scope", "observation.read observation.write"),
                },
            )

        # --- POST /fhir/r5/Observation ---------------------------------
        def _handle_observation_post(self) -> None:
            state.upload_calls += 1
            if not self._require_bearer():
                return
            raw = self._read_body()
            try:
                obs = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_error_json(400, "invalid JSON body")
                return
            if not isinstance(obs, dict) or obs.get("resourceType") != "Observation":
                self._send_error_json(
                    400, "resourceType must be 'Observation'"
                )
                return
            # FHIR requires a subject reference for clinical observations.
            subject = obs.get("subject", {})
            ref = subject.get("reference") if isinstance(subject, dict) else None
            if not ref or not ref.startswith("Patient/"):
                self._send_error_json(
                    400, "subject.reference must start with 'Patient/'"
                )
                return
            # valueAttachment must carry the base64 OMH payload.
            va = obs.get("valueAttachment", {})
            if not isinstance(va, dict) or not va.get("data"):
                self._send_error_json(
                    400, "valueAttachment.data is required"
                )
                return
            # Assign a server-side id (overrides the client-side UUID
            # the way the real JHE does -- this is important to verify
            # the client trusts the server's id and doesn't re-use the
            # client UUID downstream).
            server_id = str(len(state.observations) + 63600)
            stored = dict(obs)
            stored["id"] = server_id
            stored["meta"] = {
                "lastUpdated": "2026-06-07T23:59:00.000000+00:00",
                "versionId": "1",
            }
            patient_id = ref.split("/", 1)[1]
            state.observations[server_id] = stored
            state.observations_by_patient.setdefault(patient_id, []).append(
                server_id
            )
            self._send_json(201, stored)

        # --- GET /fhir/r5/Observation?patient=... ----------------------
        def _handle_observation_list(self, query: dict[str, list[str]]) -> None:
            state.list_calls += 1
            if not self._require_bearer():
                return
            patient_id_raw = (query.get("patient") or [None])[0]
            if not patient_id_raw:
                self._send_error_json(400, "patient query param is required")
                return
            # JHE's FHIR endpoint accepts either a raw patient id or a
            # Patient/<id> reference. Normalize.
            patient_id = patient_id_raw.split("/")[-1]
            ids = state.observations_by_patient.get(patient_id, [])
            entries = [
                {"resource": state.observations[oid], "fullUrl": f"Observation/{oid}"}
                for oid in ids
            ]
            bundle = {
                "resourceType": "Bundle",
                "type": "searchset",
                "total": len(entries),
                "entry": entries,
                # JHE's pagination uses Bundle.link[rel=next]; we don't
                # paginate in the mock since the test corpus is tiny.
                "link": [
                    {
                        "relation": "self",
                        "url": f"http://{self.headers.get('Host', 'localhost')}"
                        f"/fhir/r5/Observation?patient={patient_id}",
                    }
                ],
            }
            self._send_json(200, bundle)

        # --- dispatch ---------------------------------------------------
        def do_POST(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
            parsed = urlparse(self.path)
            if parsed.path == "/o/token/":
                self._handle_token()
            elif parsed.path == "/fhir/r5/Observation":
                self._handle_observation_post()
            else:
                self._send_error_json(404, f"unknown route: POST {parsed.path}")

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            if parsed.path == "/fhir/r5/Observation":
                self._handle_observation_list(query)
            elif parsed.path == "/healthz":
                self._send_json(200, {"ok": True})
            else:
                self._send_error_json(404, f"unknown route: GET {parsed.path}")

    return Handler


class JheMockServer:
    """Context-manager friendly mock JHE server.

    Usage::

        with JheMockServer() as srv:
            assert srv.base_url.startswith("http://127.0.0.1:")
            # configure pause_ingest to point at srv.base_url, run flow
            assert srv.state.upload_calls == 1
            assert srv.state.list_calls == 1
    """

    def __init__(self, port: int = 0) -> None:
        self.state = JheMockState()
        handler_cls = _make_handler(self.state)
        # port=0 lets the OS pick a free port. We read the chosen port
        # back out via httpd.server_address after binding.
        self._server = ThreadingHTTPServer(("127.0.0.1", port), handler_cls)
        self._thread: threading.Thread | None = None

    @property
    def port(self) -> int:
        return self._server.server_address[1]

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def __enter__(self) -> "JheMockServer":
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="jhe-mock-server",
            daemon=True,
        )
        self._thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self._server.shutdown()
        self._server.server_close()
        if self._thread:
            self._thread.join(timeout=5.0)
