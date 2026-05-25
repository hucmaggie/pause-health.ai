"""Pause-Health.ai wearable ingest worker.

Public surface:
    - convert_sample: vendor JSON → Open mHealth record
    - omh_to_fhir_observation: OMH record → FHIR R5 Observation
    - upload_observation: POST FHIR Observation to JupyterHealth Exchange
    - read_recent_observations: fetch observations back from JHE
"""

from .config import IngestConfig
from .convert import convert_sample
from .exchange import read_recent_observations, upload_observation
from .fhir import omh_to_fhir_observation

__all__ = [
    "IngestConfig",
    "convert_sample",
    "omh_to_fhir_observation",
    "read_recent_observations",
    "upload_observation",
]
__version__ = "0.1.0"
