#!/usr/bin/env bash
#
# Refresh the committed national provider directory from the latest CMS NPPES
# Data Dissemination drop. Streams the ~11.5 GB CSV out of the dissemination
# zip via a FIFO so we never extract it to disk; ~1m50s end-to-end.
#
# Designed to replace the ad-hoc .scratch/run_national*.sh files. Tracks in
# git; idempotent (cleans up its own FIFO); safe to re-run.
#
# Inputs (env vars, all optional):
#   NPPES_ZIP    Path to the dissemination zip. Default: latest
#                NPPES_Data_Dissemination_*.zip under
#                ~/Documents/Personal/Pause-Health.ai/.
#   NPPES_OUT    Output directory JSON. Default: the committed
#                frontend/lib/provider-directory.generated.json.
#   NPPES_LIMIT  Non-certified provider cap. Default: 2000.
#
# Flags:
#   --dry-run    Print what would happen without invoking the build.
#
# Exit codes:
#   0  success
#   1  no NPPES zip found / pipeline failure / not in repo root
#
# After a successful run:
#   - frontend/lib/provider-directory.generated.json is updated in place
#   - frontend/lib/provider-directory.generated.meta.json holds runDate +
#     sourceDate + counts (consumed by /api/mulesoft/providers provenance)
#
# Refresh cadence: CMS publishes NPPES monthly. Drop the new zip into the
# default location, re-run this script, commit the diff (the only changes
# should be the two generated JSONs).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# Default NPPES location — easy to override via env, but the canonical
# maintainer setup keeps the dissemination zips in a stable directory.
NPPES_DIR_DEFAULT="$HOME/Documents/Personal/Pause-Health.ai"
if [[ -z "${NPPES_ZIP:-}" ]]; then
  # `ls -1t` sorts newest-first; head -1 is the latest dissemination zip.
  NPPES_ZIP="$(ls -1t "${NPPES_DIR_DEFAULT}"/NPPES_Data_Dissemination_*.zip 2>/dev/null | head -1 || true)"
fi
if [[ -z "${NPPES_ZIP:-}" || ! -f "$NPPES_ZIP" ]]; then
  echo "ERROR: no NPPES dissemination zip found." >&2
  echo "Set NPPES_ZIP=/path/to/NPPES_Data_Dissemination_*.zip or place one at" >&2
  echo "  ${NPPES_DIR_DEFAULT}/NPPES_Data_Dissemination_*.zip" >&2
  echo "(Download from https://download.cms.gov/nppes/NPI_Files.html.)" >&2
  exit 1
fi

# The bulk file inside the zip is npidata_pfile_<startdate>-<enddate>.csv. We
# pick the data file (not the header file) by name pattern. unzip -l surfaces
# the manifest; awk grabs the matching member name.
MEMBER="$(unzip -l "$NPPES_ZIP" 'npidata_pfile_*[0-9].csv' 2>/dev/null \
            | awk '/npidata_pfile_/{print $NF}' | head -1)"
if [[ -z "$MEMBER" ]]; then
  echo "ERROR: $NPPES_ZIP has no npidata_pfile_*.csv data member" >&2
  exit 1
fi

NPPES_OUT="${NPPES_OUT:-frontend/lib/provider-directory.generated.json}"
NPPES_LIMIT="${NPPES_LIMIT:-2000}"
FIFO=".scratch/npi_refresh.fifo"

# Use the zip's mtime as the dataset's source date. unzip preserves member
# mtimes from the archive; the zip-itself mtime tracks the maintainer's
# download time. Both are honest signals — we report the file as the source
# of truth for "when was the dataset published".
SOURCE_DATE="$(python3 -c '
import os, sys
from datetime import datetime, timezone
path = sys.argv[1]
ts = os.stat(path).st_mtime
print(datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds"))
' "$NPPES_ZIP")"

echo "→ NPPES zip:    $NPPES_ZIP"
echo "→ NPPES member: $MEMBER"
echo "→ Source date:  $SOURCE_DATE"
echo "→ Output:       $NPPES_OUT"
echo "→ Limit:        $NPPES_LIMIT (--keep-all-certified)"

if (( DRY_RUN )); then
  echo "DRY RUN — exiting without running the build."
  exit 0
fi

mkdir -p .scratch
# Defensive: if a prior run was interrupted, the FIFO may linger. trap removes
# it on any exit so a re-run is clean.
rm -f "$FIFO"
mkfifo "$FIFO"
trap 'rm -f "$FIFO"' EXIT

unzip -p "$NPPES_ZIP" "$MEMBER" > "$FIFO" &
UNZIP_PID=$!

# National file FIRST, demo fixture LAST (last-wins so the demo personas keep
# resolving to their curated local certified providers — see build.py docs).
time ./provider_ingest/.venv/bin/pause-provider-build \
  --nppes "$FIFO" \
  --nppes provider_ingest/examples/fixtures/nppes_sample.csv \
  --mscp  provider_ingest/examples/fixtures/mscp_npis.json \
  --out   "$NPPES_OUT" \
  --keep-all-certified \
  --limit "$NPPES_LIMIT" \
  --source-date "$SOURCE_DATE"

wait "$UNZIP_PID" 2>/dev/null || true
echo "DONE: refreshed $NPPES_OUT (and ${NPPES_OUT%.json}.meta.json)."
