#!/usr/bin/env bash
# Stop the local JHE stack. Pass --purge to also drop the Postgres
# volume + the OIDC key on disk (so the next bootstrap.sh starts from
# a clean slate).
set -euo pipefail

PURGE=0
[[ "${1:-}" == "--purge" ]] && PURGE=1

docker rm -f jhe-web      2>/dev/null || true
docker rm -f jhe-postgres 2>/dev/null || true

if [[ $PURGE -eq 1 ]]; then
  docker volume rm jhe-pgdata 2>/dev/null || true
  rm -f "$(dirname "${BASH_SOURCE[0]}")/oidc.key"
  echo "Purged jhe-pgdata volume and oidc.key. Network and image kept."
else
  echo "Stopped jhe-web + jhe-postgres. Volume jhe-pgdata kept."
  echo "Re-run bootstrap.sh to bring it back up; pass --purge here to wipe state."
fi
