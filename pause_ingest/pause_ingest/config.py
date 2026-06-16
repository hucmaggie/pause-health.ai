"""Environment-driven configuration for the ingest worker.

We intentionally keep this small and explicit. Anything secret comes from
the environment (.env in dev, real secret manager in prod).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from dotenv import load_dotenv


@dataclass(frozen=True)
class IngestConfig:
    """All settings the ingest worker needs to talk to JupyterHealth Exchange."""

    jhe_base_url: str
    jhe_client_id: str
    jhe_client_secret: str
    patient_fhir_id: str
    data_source_id: str
    default_tz: ZoneInfo
    fhir_source_id: str | None = None

    @classmethod
    def from_env(cls, *, dotenv_path: str | None = None) -> "IngestConfig":
        """Load configuration from environment variables.

        Raises a clear error if anything required is missing — silent
        misconfiguration in a healthcare data pipeline is unacceptable.
        """
        load_dotenv(dotenv_path=dotenv_path)

        def required(name: str) -> str:
            value = os.environ.get(name, "").strip()
            if not value:
                raise RuntimeError(
                    f"Missing required environment variable: {name}. "
                    "Copy .env.example to .env and fill it in."
                )
            return value

        tz_name = os.environ.get("PAUSE_INGEST_DEFAULT_TZ", "UTC").strip() or "UTC"
        try:
            tz = ZoneInfo(tz_name)
        except Exception as exc:
            raise RuntimeError(
                f"PAUSE_INGEST_DEFAULT_TZ={tz_name!r} is not a valid IANA timezone"
            ) from exc

        fhir_source_id = os.environ.get("JHE_FHIR_SOURCE_ID", "").strip() or None

        return cls(
            jhe_base_url=required("JHE_BASE_URL").rstrip("/"),
            jhe_client_id=required("JHE_CLIENT_ID"),
            jhe_client_secret=required("JHE_CLIENT_SECRET"),
            patient_fhir_id=required("JHE_PATIENT_FHIR_ID"),
            data_source_id=required("JHE_DATA_SOURCE_ID"),
            default_tz=tz,
            fhir_source_id=fhir_source_id,
        )
