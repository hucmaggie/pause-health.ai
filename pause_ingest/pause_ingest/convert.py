"""Thin wrapper around omh-shim that documents the menopause-relevant subset.

omh-shim does the heavy lifting (vendor JSON → Open mHealth / IEEE 1752.1).
We add two small things on top:

    1. An allow-list of (source, data_type) pairs we actually consume for
       menopause workflows, validated against the real omh-shim v1.0.1
       dispatch registry. Surfacing unrelated types in the pipeline would
       just be noise; surfacing UNSUPPORTED types would crash at runtime
       inside the worker, which is worse.

    2. Pass-through for the optional ``tz`` argument. Per omh-shim's docs,
       daily-aggregate data types REQUIRE an explicit timezone; we default
       to the configured ingest tz instead of letting the caller forget.

omh-shim always returns the IEEE 1752.1 envelope (``{"header": ..., "body":
...}``), so we don't need to opt in via a flag — it's the default.
"""

from __future__ import annotations

from typing import Any
from zoneinfo import ZoneInfo

from omh_shim import convert as _omh_convert  # type: ignore[import-not-found]

# Per omh-shim v1.0.1: daily-aggregate types need an explicit tz for correct
# day boundaries. Instant types accept tz but don't require it.
DAILY_AGGREGATE_TYPES: frozenset[str] = frozenset(
    {"step_count", "physical_activity", "sleep_duration", "oxygen_saturation"}
)

# What Pause-Health.ai consumes today. Validated against omh-shim v1.0.1
# REGISTRY — anything outside this set is rejected at the boundary rather
# than silently dropped on the floor.
SUPPORTED: dict[str, frozenset[str]] = {
    "oura_raw": frozenset(
        {
            "heart_rate",
            "heart_rate_variability",
            "step_count",
            "sleep_duration",
            "sleep_episode",
            "physical_activity",
        }
    ),
    "ow_normalized": frozenset(
        {
            "heart_rate",
            "heart_rate_variability",
            "oxygen_saturation",
            "step_count",
            "sleep_duration",
            "sleep_episode",
            "physical_activity",
        }
    ),
}


class UnsupportedConversion(ValueError):
    """Raised when (source, data_type) is outside the menopause-relevant set."""


def convert_sample(
    *,
    source: str,
    data_type: str,
    sample: dict[str, Any],
    default_tz: ZoneInfo,
) -> dict[str, Any]:
    """Convert one wearable sample to an Open mHealth record with IEEE 1752 header.

    Args:
        source: omh-shim source identifier (e.g. ``"oura_raw"``).
        data_type: omh-shim data type (e.g. ``"heart_rate"``).
        sample: vendor-shaped sample dict.
        default_tz: timezone used for daily-aggregate types. Passed through
            for instant types too — omh-shim ignores it where not needed.

    Returns:
        IEEE 1752.1-headered Open mHealth data point dict:
        ``{"header": {...}, "body": {...}}``.

    Raises:
        UnsupportedConversion: if (source, data_type) isn't on the allow-list.
        omh_shim.ConversionError: if the sample shape is invalid for the
            chosen (source, data_type).
        omh_shim.ValidationError: if the converted body fails schema validation.
    """
    allowed_types = SUPPORTED.get(source)
    if allowed_types is None or data_type not in allowed_types:
        raise UnsupportedConversion(
            f"({source!r}, {data_type!r}) is not in the Pause-supported set. "
            f"Supported sources: {sorted(SUPPORTED)}"
        )

    return _omh_convert(source=source, data_type=data_type, sample=sample, tz=default_tz)
