#!/usr/bin/env bash
# Stand up a real JupyterHealth Exchange Django app on the local Docker
# host, seed it with the canonical RBAC fixtures, and create the OAuth
# client + Study + consent rows pause_ingest needs to upload an Oura
# sample end-to-end.
#
# This is the executable form of docs/JHE_REAL_RUN_2026-06-16.md.
# Re-running it is idempotent: containers are started only if absent,
# migrations and seeds are no-ops on a populated DB, and the OAuth /
# Study wiring is `update_or_create`.
#
# Prereqs: Docker daemon running. ~1 GB free disk for the JHE image.
#
# After this completes, run:
#   cd ../pause_ingest && .venv/bin/python -m examples.oura_sample_upload
#
# Ports used:
#   127.0.0.1:8000  jhe-web (Django + gunicorn)
#   127.0.0.1:5433  jhe-postgres

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JHE_REPO_DIR="${JHE_REPO_DIR:-/tmp/jupyterhealth-exchange}"
NETWORK=jhe-net
PG_NAME=jhe-postgres
WEB_NAME=jhe-web
IMAGE=jhe-local:latest

CLIENT_ID=pause-ingest-client-id
CLIENT_SECRET=pause-ingest-client-secret-xyz123
PATIENT_ID=40001
DATA_SOURCE_ID=70004    # seeded "Oura"

cd "$HERE"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found on PATH"; exit 2
fi

# 1. Network + volume
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK"
docker volume inspect jhe-pgdata     >/dev/null 2>&1 || docker volume create jhe-pgdata

# 2. Postgres
if ! docker ps --filter name="^${PG_NAME}\$" --format '{{.Names}}' | grep -q "$PG_NAME"; then
  docker rm -f "$PG_NAME" 2>/dev/null || true
  docker run -d --name "$PG_NAME" --network "$NETWORK" -v jhe-pgdata:/var/lib/postgresql/data \
    -e POSTGRES_USER=jheuser -e POSTGRES_PASSWORD=jhepassword -e POSTGRES_DB=jhe_dev \
    -p 127.0.0.1:5433:5432 postgres:16 >/dev/null
  # Give postgres a moment to accept connections
  sleep 4
fi

# 3. OIDC RS256 key
if [[ ! -f "$HERE/oidc.key" ]]; then
  openssl genrsa -out "$HERE/oidc.key" 4096 2>/dev/null
fi
OIDC_KEY=$(awk '{printf "%s%s", (NR==1?"":"\\n"), $0}' "$HERE/oidc.key")

# 4. JHE source clone + image build
if [[ ! -d "$JHE_REPO_DIR" ]]; then
  git clone --depth 1 https://github.com/jupyterhealth/jupyterhealth-exchange.git "$JHE_REPO_DIR"
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  ARCH=$(uname -m)
  case "$ARCH" in
    arm64|aarch64) TARGETARCH=arm64 ;;
    x86_64|amd64)  TARGETARCH=amd64 ;;
    *)             TARGETARCH=amd64 ;;
  esac
  ( cd "$JHE_REPO_DIR" && docker build --build-arg TARGETARCH="$TARGETARCH" -t "$IMAGE" . )
fi

# 5. JHE web container
if ! docker ps --filter name="^${WEB_NAME}\$" --format '{{.Names}}' | grep -q "$WEB_NAME"; then
  docker rm -f "$WEB_NAME" 2>/dev/null || true
  docker run -d --name "$WEB_NAME" --network "$NETWORK" \
    -p 127.0.0.1:8000:8000 \
    -e DEBUG=True \
    -e SITE_URL=http://localhost:8000 \
    -e DB_NAME=jhe_dev -e DB_USER=jheuser -e DB_PASSWORD=jhepassword \
    -e DB_HOST="$PG_NAME" -e DB_PORT=5432 \
    -e SECRET_KEY=pause-jhe-local-dev-secret-key-not-for-prod \
    -e REGISTRATION_INVITE_CODE=jhe \
    -e OW_API_URL=http://localhost:8001 -e OW_API_KEY=unused \
    -e OIDC_RSA_PRIVATE_KEY="$OIDC_KEY" \
    "$IMAGE" >/dev/null
  sleep 5
fi

# 6. Migrate + seed (seed is one-shot; the canonical fixture rows have
# hardcoded ids and re-running raises duplicate-key, so we only seed
# when the JheUser table is empty).
docker exec "$WEB_NAME" python manage.py migrate >/dev/null
NEED_SEED=$(docker exec "$WEB_NAME" python -c "
import django, os; os.environ['DJANGO_SETTINGS_MODULE']='jhe.settings'; django.setup()
from core.models import JheUser; print('1' if JheUser.objects.count()==0 else '0')
")
if [[ "$NEED_SEED" == "1" ]]; then
  docker exec "$WEB_NAME" python manage.py seed >/dev/null
fi

# 7. OAuth client + Study + Patient + DataSource + Scope + Consent wiring
docker exec -i "$WEB_NAME" python <<PY >/dev/null
import django, os
os.environ['DJANGO_SETTINGS_MODULE']='jhe.settings'
django.setup()
from django.utils import timezone
from oauth2_provider.models import get_application_model
from core.models import (
  Study, Patient, DataSource, ClientDataSource, StudyClient,
  StudyDataSource, StudyPatient, StudyPatientScopeConsent,
  StudyScopeRequest, CodeableConcept, JheClient, FhirSource,
)

App = get_application_model()
app, _ = App.objects.get_or_create(
    name="pause-ingest",
    defaults={
        "client_id": "${CLIENT_ID}",
        "client_secret": "${CLIENT_SECRET}",
        "client_type": App.CLIENT_CONFIDENTIAL,
        "authorization_grant_type": App.GRANT_CLIENT_CREDENTIALS,
        "skip_authorization": True,
        "hash_client_secret": False,
        "algorithm": "RS256",
    },
)
app.client_id = "${CLIENT_ID}"
app.client_secret = "${CLIENT_SECRET}"
app.hash_client_secret = False
app.client_type = App.CLIENT_CONFIDENTIAL
app.authorization_grant_type = App.GRANT_CLIENT_CREDENTIALS
JheClient.objects.get_or_create(application=app)

patient = Patient.objects.get(id=${PATIENT_ID})
oura = DataSource.objects.get(id=${DATA_SOURCE_ID})
app.user = patient.jhe_user
app.save()

ClientDataSource.objects.get_or_create(client=app, data_source=oura)

study, _ = Study.objects.get_or_create(
    name="pause-ingest demo study",
    defaults={"organization": patient.organizations.first()},
)
StudyClient.objects.get_or_create(study=study, client=app)
StudyDataSource.objects.get_or_create(study=study, data_source=oura)
sp, _ = StudyPatient.objects.get_or_create(study=study, patient=patient)

now = timezone.now()
for code in ("omh:heart-rate:2.0", "omh:rr-interval:1.0",
             "omh:sleep-duration:2.0", "omh:sleep-episode:1.1",
             "omh:physical-activity:1.2", "omh:step-count:3.0"):
    cc = CodeableConcept.objects.filter(coding_code=code).first()
    if not cc:
        continue
    sr, _ = StudyScopeRequest.objects.update_or_create(
        study=study, scope_code=cc, defaults={"scope_actions": "rs"},
    )
    StudyPatientScopeConsent.objects.update_or_create(
        study_patient=sp, scope_code=cc,
        defaults={"consented": True, "scope_actions": sr.scope_actions, "consented_time": now},
    )

# A FhirSource is required for derived (auxiliary) Observation writes.
# pause_ingest does not write derived observations through this path yet,
# but the row is cheap and lets us add the X-JHE-FHIR-Source-ID header later.
FhirSource.objects.get_or_create(
    patient=patient, data_source=oura,
    defaults={"label": "pause-ingest demo Oura source", "fhir_base_url": ""},
)
PY

cat <<EOF

JHE is up at http://localhost:8000

  Admin login:   admin@example.com / Jhe1234!
  Postgres:      127.0.0.1:5433 (user jheuser pw jhepassword db jhe_dev)

Write the env values below into pause_ingest/.env:

JHE_BASE_URL=http://localhost:8000
JHE_CLIENT_ID=${CLIENT_ID}
JHE_CLIENT_SECRET=${CLIENT_SECRET}
JHE_PATIENT_FHIR_ID=${PATIENT_ID}
JHE_DATA_SOURCE_ID=${DATA_SOURCE_ID}
PAUSE_INGEST_DEFAULT_TZ=UTC

Then:

  cd ../pause_ingest
  .venv/bin/python -m examples.oura_sample_upload
EOF
