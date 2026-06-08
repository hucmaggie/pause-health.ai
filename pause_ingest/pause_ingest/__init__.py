"""Pause-Health.ai wearable ingest worker.

Public surface:
    - convert_sample: vendor JSON → Open mHealth record (via omh-shim)
    - omh_to_fhir_observation: OMH record → FHIR R5 Observation
    - hrv_features_to_fhir_observation: HRV feature set → FHIR R5 Observation
      with a derivedFrom pointer back to the raw observations.
    - upload_observation: POST FHIR Observation to JupyterHealth Exchange
    - read_recent_observations: fetch observations back from JHE
    - hrv_features_flirt: sliding-window HRV features (via DBDP/FLIRT)
    - hrv_time_domain_fallback: small dependency-light HRV reference impl
"""

from .config import IngestConfig
from .convert import convert_sample
from .exchange import read_recent_observations, upload_observation
from .features import (
    HrvTimeDomain,
    InvalidIbiSeries,
    hrv_features_flirt,
    hrv_time_domain_fallback,
)
from .fhir import hrv_features_to_fhir_observation, omh_to_fhir_observation

__all__ = [
    "HrvTimeDomain",
    "IngestConfig",
    "InvalidIbiSeries",
    "convert_sample",
    "hrv_features_flirt",
    "hrv_features_to_fhir_observation",
    "hrv_time_domain_fallback",
    "omh_to_fhir_observation",
    "read_recent_observations",
    "upload_observation",
]
__version__ = "0.1.0"
