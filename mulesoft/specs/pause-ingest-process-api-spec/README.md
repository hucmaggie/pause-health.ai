# pause-ingest-process-api-spec

OAS 3.0 contract for the Pause Process tier — the orchestration layer
that consumes the per-wearable System APIs and emits writes to JHE +
triggers to DBDP. One endpoint: `POST /samples`.

**Spec only — no deployable Mule project yet.** Anchored to the
reference Mule XML at
[`mulesoft/flows/pause-process-api.example.xml`](../../flows/pause-process-api.example.xml),
which is labeled "REFERENCE, not deployable" because it lacks the
customer-managed property files (Anypoint Platform org, secret manager
keys, downstream URLs) and the OMH JSON schema bundle. Phase 1c
materializes the deployable project. Today, `pause_ingest`'s Python
worker performs the equivalent orchestration in-process — see
[`oura_sample_upload.py`](../../../pause_ingest/examples/oura_sample_upload.py).

## Why this asset completes the API-led story on Exchange

| Tier | Pause asset on Exchange |
|---|---|
| **System** | [`pause-jhe-system-api-spec`](../pause-jhe-system-api-spec/) (FHIR write surface) + [`pause-dbdp-system-api-spec`](../pause-dbdp-system-api-spec/) (HRV feature compute) + [`pause-oura-system-api-spec`](../pause-oura-system-api-spec/) (per-wearable template; HealthKit / Whoop / Garmin clones to follow) |
| **Process** | **`pause-ingest-process-api-spec` (this asset)** |
| **Experience** | `pause-provider-experience-api-spec` (already on Exchange; backs the live CloudHub worker's `/health` + `/providers` endpoints) |

The Process tier composes downward: it calls the System-tier specs and
uses the `pause-omh-to-fhir-library` DataWeave transform. With this
asset published, every layer of MuleSoft's API-led pattern has a
versioned Pause artifact on Exchange.

## What's in the spec

| | |
|---|---|
| `POST /samples` | The single orchestration endpoint. Validates an OMH envelope → transforms to FHIR R5 → writes to JHE → fires DBDP feature compute (async) → returns the JHE-assigned id. |

Plus four schemas: `IngestSampleRequest` (`{source, header, body}`),
`OmhHeader` (IEEE 1752.1), `IngestSampleResponse` (`{status,
observationId, source, featureComputeTriggered}`), and
`ProcessApiError` mirroring the reference Mule flow's `<error-handler>`
envelope (`{status: "error", error, errorType}` with the Mule
`errorType.identifier` propagated for runbook diagnosis).

## Fire-and-forget DBDP

Step 4 of the reference flow wraps the DBDP call in `<async>`. The
Process API **does not wait** on feature compute; `featureComputeTriggered:
true` means "the trigger was issued," not "features were computed." This
matches `pause_ingest`'s Python flow: the derived HRV Observation is
written separately and carries `derivedFrom` lineage back to the raw
one.

## Coordinates

| | |
|---|---|
| groupId | `56707cc3-a0e3-4318-b110-78126aace370` (Pause Health business group) |
| artifactId | `pause-ingest-process-api-spec` |
| version | `1.0.0` |
| packaging | `jar` |
| Spec file (inside jar) | `pause-ingest-process-api.oas3.yaml` |

## How to consume

```xml
<dependency>
    <groupId>56707cc3-a0e3-4318-b110-78126aace370</groupId>
    <artifactId>pause-ingest-process-api-spec</artifactId>
    <version>1.0.0</version>
</dependency>
```

Then read the spec off the classpath in any Mule app:

```dataweave
%dw 2.0
import * from dw::io::file::Files
output application/json
---
readUrl("classpath://pause-ingest-process-api.oas3.yaml")
```

## Build & publish

Same recipe as the other spec assets. Requires Zulu 17 + an
`~/.m2/settings.xml` with an `anypoint-exchange-v2` server entry.

```bash
cd mulesoft/specs/pause-ingest-process-api-spec
export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home
export PATH=$JAVA_HOME/bin:$PATH

# 1. Build
mvn -B clean package

# 2. Publish to Anypoint Exchange v2 (POM through curl per the known Content-Type gotcha)
CRED=$(grep -A 3 anypoint-exchange-v2 ~/.m2/settings.xml | grep password | sed 's/.*>\(.*\)<.*/\1/')
CLIENT_ID=$(echo $CRED | cut -d'~' -f1)
CLIENT_SECRET=$(echo $CRED | cut -d'~' -f3)
TOKEN=$(curl -s -X POST "https://anypoint.mulesoft.com/accounts/api/v2/oauth2/token" \
  -d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET" \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
BASE=https://maven.anypoint.mulesoft.com/api/v2/organizations/56707cc3-a0e3-4318-b110-78126aace370/maven/56707cc3-a0e3-4318-b110-78126aace370/pause-ingest-process-api-spec/1.0.0

curl -s -X PUT "$BASE/pause-ingest-process-api-spec-1.0.0.pom" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/xml" \
  --data-binary @pom.xml -w "POM HTTP %{http_code}\n"
curl -s -X PUT "$BASE/pause-ingest-process-api-spec-1.0.0.jar" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/java-archive" \
  --data-binary @target/pause-ingest-process-api-spec-1.0.0.jar -w "JAR HTTP %{http_code}\n"
```

Anypoint Exchange tombstones deleted versions. Bump to 1.0.1, 1.1.0,
2.0.0, etc.; never re-publish a deleted version number.

## Files

```
pause-ingest-process-api-spec/
├── README.md
├── pom.xml
└── src/main/resources/
    └── pause-ingest-process-api.oas3.yaml   <- the OAS 3.0 spec
```
