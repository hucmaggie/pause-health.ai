# pause-dbdp-system-api-spec

OAS 3.0 contract for the Pause DBDP/FLIRT feature-engineering System API.

**Spec only — no live Mule project consumes it yet.** This is a
*prospective* contract describing the HTTP surface that a future
`dbdp-system-api` Mule project would expose on top of the existing
`pause_ingest.features.{hrv_features_flirt, hrv_time_domain_fallback}`
Python layer. Published to Anypoint Exchange so customer-side Mule apps
and the future `pause-ingest-process-api` can review the contract before
the implementation lands in Phase 1c.

Third Phase 3 artifact on Exchange (after
[`pause-omh-to-fhir-library`](../pause-omh-to-fhir-library/) and
[`pause-jhe-system-api-spec`](../pause-jhe-system-api-spec/)). See
[`/proposal/mulesoft`](https://pause-health.ai/proposal/mulesoft) for
the Phase 3 narrative.

## What's in the spec

A single endpoint, parameterized by `mode`:

| | |
|---|---|
| `POST /features/hrv:compute` (mode=`sliding-window`) | Wraps `pause_ingest.features.hrv_features_flirt`. Returns one row per sliding window, with FLIRT-named feature columns (`hrv_rmssd`, `hrv_sdnn`, `hrv_lf`, etc.). Default window 180s / step 60s. |
| `POST /features/hrv:compute` (mode=`time-domain-fallback`) | Wraps `pause_ingest.features.hrv_time_domain_fallback`. Returns a single aggregate (`HrvTimeDomain`: mean_nn / sdnn / rmssd / nn50 / pnn50 / mean_hr). Dependency-light; Kubios-validated. |

Plus five schemas: `HrvComputeRequest`, the two response shapes, the
shared `HrvTimeDomain` (1:1 mirror of `pause_ingest.features.HrvTimeDomain`),
and a `DbdpError` envelope.

The contract is shaped by three actual things:
1. The endpoint sketch in [`mulesoft/flows/pause-process-api.example.xml`](../../flows/pause-process-api.example.xml)
   (`POST /features/hrv:compute` taking `{observationId, source, windowSec}`).
2. The Python function signatures in
   [`pause_ingest/pause_ingest/features.py`](../../../pause_ingest/pause_ingest/features.py).
3. The FHIR derivation shape the CloudHub worker already returns
   (`urn:pause-health:code:dbdp-features` / `hrv_rmssd_sliding_180s`,
   with `derivedFrom` lineage back to the raw IBI Observation).

## Coordinates

| | |
|---|---|
| groupId | `56707cc3-a0e3-4318-b110-78126aace370` (Pause Health business group) |
| artifactId | `pause-dbdp-system-api-spec` |
| version | `1.0.0` |
| packaging | `jar` |
| Spec file (inside jar) | `dbdp-system-api.oas3.yaml` |

## How to consume

```xml
<dependency>
    <groupId>56707cc3-a0e3-4318-b110-78126aace370</groupId>
    <artifactId>pause-dbdp-system-api-spec</artifactId>
    <version>1.0.0</version>
</dependency>
```

Then read the spec off the classpath in any Mule app:

```dataweave
%dw 2.0
import * from dw::io::file::Files
output application/json
---
readUrl("classpath://dbdp-system-api.oas3.yaml")
```

Or unzip the jar and point an Anypoint Studio / Code Builder project at
the file as an API spec.

## Build & publish

Same recipe as the JHE spec
([`pause-jhe-system-api-spec/README.md`](../pause-jhe-system-api-spec/README.md)).
Requires Zulu 17 + an `~/.m2/settings.xml` with an `anypoint-exchange-v2`
server entry.

```bash
cd mulesoft/specs/pause-dbdp-system-api-spec
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
BASE=https://maven.anypoint.mulesoft.com/api/v2/organizations/56707cc3-a0e3-4318-b110-78126aace370/maven/56707cc3-a0e3-4318-b110-78126aace370/pause-dbdp-system-api-spec/1.0.0

curl -s -X PUT "$BASE/pause-dbdp-system-api-spec-1.0.0.pom" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/xml" \
  --data-binary @pom.xml -w "POM HTTP %{http_code}\n"
curl -s -X PUT "$BASE/pause-dbdp-system-api-spec-1.0.0.jar" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/java-archive" \
  --data-binary @target/pause-dbdp-system-api-spec-1.0.0.jar -w "JAR HTTP %{http_code}\n"
```

Anypoint Exchange tombstones deleted versions. Bump to 1.0.1, 1.1.0,
2.0.0, etc.; never re-publish a deleted version number.

## Files

```
pause-dbdp-system-api-spec/
├── README.md
├── pom.xml
└── src/main/resources/
    └── dbdp-system-api.oas3.yaml   <- the OAS 3.0 spec
```
