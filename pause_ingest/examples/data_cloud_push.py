"""Generate the demo-cohort wearable features and push them to Data Cloud.

This is the Phase 2 "harden with real feature math" entrypoint: it runs the
real HRV / sleep / vasomotor feature functions over deterministic per-persona
inputs and streams the flattened rows into the Data Cloud Ingestion API,
where the three Calculated Insights aggregate them.

Run with:

    # Dry run — print the payload, push nothing (no creds needed):
    python -m examples.data_cloud_push --dry-run

    # Live — push to the Ingestion API connector (reads SF_* from .env):
    python -m examples.data_cloud_push

Required env for a live push (see docs/PHASE_2_INGESTION_API_RUNBOOK.md):
    SF_INSTANCE_URL, SF_CLIENT_ID, SF_CLIENT_SECRET
    SF_DC_INGEST_CONNECTOR  (default: Pause_Wearable)
    SF_DC_INGEST_OBJECT     (default: wearable_feature)
The Connected App must carry the cdp_ingest_api scope.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter

from pause_ingest.cohort import generate_cohort_records
from pause_ingest.data_cloud import (
    DataCloudConfigError,
    DataCloudIngestClient,
    DataCloudIngestConfig,
    build_ingest_payload,
    chunked,
)


def _summarize(records) -> str:
    by_type = Counter(r.observation_type for r in records)
    by_patient = Counter(r.unified_id for r in records)
    return (
        f"{len(records)} records across {len(by_patient)} patients; "
        f"by type: {dict(by_type)}"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the ingest payload and exit without pushing.",
    )
    args = parser.parse_args(argv)

    records = generate_cohort_records()
    print(f"Generated {_summarize(records)}")

    if args.dry_run:
        payload = build_ingest_payload(records)
        print(json.dumps(payload, indent=2)[:4000])
        print(f"\n[dry-run] would push {len(records)} records; nothing sent.")
        return 0

    try:
        config = DataCloudIngestConfig.from_env()
    except DataCloudConfigError as exc:
        print(f"Not configured for a live push: {exc}", file=sys.stderr)
        print("Re-run with --dry-run to preview the payload.", file=sys.stderr)
        return 2

    client = DataCloudIngestClient(config)
    total = 0
    for batch in chunked(records, size=200):
        result = client.ingest(batch)
        total += result.get("accepted", 0)
        print(f"Pushed batch: {result}")

    print(
        f"OK — pushed {total} wearable feature records to "
        f"{config.connector}/{config.object_name}. "
        "Refresh the three Calculated Insights to recompute."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
