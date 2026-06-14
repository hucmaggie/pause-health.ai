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
    - sleep_efficiency_from_stages / sleep_disruption_index: sleep-architecture
      features feeding the Pause_Sleep_Disruption_7d Calculated Insight
    - detect_vasomotor_event / vasomotor_burden: hot-flash / night-sweat
      detection + burden scoring feeding Pause_Vasomotor_Burden_30d
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
from .features_sleep import (
    InvalidSleepSession,
    SleepDisruption,
    SleepEfficiency,
    is_disrupted_night,
    sleep_disruption_index,
    sleep_efficiency_from_stages,
)
from .features_vasomotor import (
    InvalidVasomotorInput,
    VasomotorBurden,
    VasomotorEvent,
    detect_vasomotor_event,
    vasomotor_burden,
)
from .fhir import hrv_features_to_fhir_observation, omh_to_fhir_observation

__all__ = [
    "HrvTimeDomain",
    "IngestConfig",
    "InvalidIbiSeries",
    "InvalidSleepSession",
    "InvalidVasomotorInput",
    "SleepDisruption",
    "SleepEfficiency",
    "VasomotorBurden",
    "VasomotorEvent",
    "convert_sample",
    "detect_vasomotor_event",
    "hrv_features_flirt",
    "hrv_features_to_fhir_observation",
    "hrv_time_domain_fallback",
    "is_disrupted_night",
    "omh_to_fhir_observation",
    "read_recent_observations",
    "sleep_disruption_index",
    "sleep_efficiency_from_stages",
    "upload_observation",
    "vasomotor_burden",
]
__version__ = "0.1.0"
