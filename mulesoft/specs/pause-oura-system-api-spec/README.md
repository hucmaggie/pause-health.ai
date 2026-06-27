# pause-oura-system-api-spec

OAS 3.0 contract for the Pause Mule app that wraps the Oura Cloud API
and emits normalized Open mHealth (IEEE 1752.1) samples to Process APIs.

**Spec only — no live Mule project consumes it yet.** This is a
*prospective* contract on the same pattern as
[`pause-jhe-system-api-spec`](../pause-jhe-system-api-spec/) and
[`pause-dbdp-system-api-spec`](../pause-dbdp-system-api-spec/).
`pause_ingest.convert.convert_sample(source="oura_raw", ...)` is called
in-process from Python today; this spec describes the HTTP surface that
a future Mule wrapper would expose.

Fourth Phase 3 artifact on Exchange and the **template** for additional
per-wearable specs (Apple HealthKit, Whoop, Garmin, Empatica E4 each get
their own asset following this shape).

## What's in the spec

| | |
|---|---|
| `GET /oura/{patient}/{dataType}` | Returns an array of OMH (IEEE 1752.1) envelopes for one data type within an optional time window. Six supported `dataType` values pinned to `pause_ingest.convert.SUPPORTED["oura_raw"]`: `heart-rate`, `heart-rate-variability`, `step-count`, `sleep-duration`, `sleep-episode`, `physical-activity`. |
| `GET /oura/{patient}/account` | Lightweight diagnostic — `{linked, tokenFresh, scopes, lastSyncIso}`. Lets a Process API or Care Router fail fast when the patient revoked Oura access or the token expired, instead of polling the data path and seeing empty results forever. |

Plus five schemas: `OmhSamplesResponse`, the OMH `OmhEnvelope` +
`OmhHeader` (shape fixed by IEEE 1752.1 / `omh_shim` v1.0.1),
`AccountStatus`, and a `SystemApiError` envelope with a tight `code`
enum covering the seven failure modes the system API can surface.

## The per-wearable template

The intent of `/proposal/mulesoft`'s Phase 3 plan is to promote a System
API per wearable. This Oura spec is the template — additional vendors
get a near-clone asset with:

- Same URL shape: `GET /{vendor}/{patient}/{dataType}` + `GET /{vendor}/{patient}/account`.
- Same OMH envelope response.
- Same six data types (filtered per vendor — HealthKit adds
  cycle-tracking, `oxygen_saturation`; Whoop adds recovery scores; etc.).
- Per-vendor auth choice on `securitySchemes` (Oura: OAuth2 auth code on
  Oura side; HealthKit: iOS app-uploaded blob; Whoop / Garmin: OAuth2 +
  vendor-specific webhook flow).

A `pause-healthkit-system-api-spec` v1.0.0 published later would be a
near-clone — same URL shape, HealthKit's data-type list, app-side auth
description in `info.description`.

## Coordinates

| | |
|---|---|
| groupId | `56707cc3-a0e3-4318-b110-78126aace370` (Pause Health business group) |
| artifactId | `pause-oura-system-api-spec` |
| version | `1.0.0` |
| packaging | `jar` |
| Spec file (inside jar) | `oura-system-api.oas3.yaml` |

## How to consume

```xml
<dependency>
    <groupId>56707cc3-a0e3-4318-b110-78126aace370</groupId>
    <artifactId>pause-oura-system-api-spec</artifactId>
    <version>1.0.0</version>
</dependency>
```

Then read the spec off the classpath in any Mule app:

```dataweave
%dw 2.0
import * from dw::io::file::Files
output application/json
---
readUrl("classpath://oura-system-api.oas3.yaml")
```

Or unzip the jar and point an Anypoint Studio / Code Builder project at
the file as an API spec.

## Build & publish

Same recipe as the JHE + DBDP specs. Requires Zulu 17 + an
`~/.m2/settings.xml` with an `anypoint-exchange-v2` server entry.

```bash
cd mulesoft/specs/pause-oura-system-api-spec
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
BASE=https://maven.anypoint.mulesoft.com/api/v2/organizations/56707cc3-a0e3-4318-b110-78126aace370/maven/56707cc3-a0e3-4318-b110-78126aace370/pause-oura-system-api-spec/1.0.0

curl -s -X PUT "$BASE/pause-oura-system-api-spec-1.0.0.pom" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/xml" \
  --data-binary @pom.xml -w "POM HTTP %{http_code}\n"
curl -s -X PUT "$BASE/pause-oura-system-api-spec-1.0.0.jar" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/java-archive" \
  --data-binary @target/pause-oura-system-api-spec-1.0.0.jar -w "JAR HTTP %{http_code}\n"
```

Anypoint Exchange tombstones deleted versions. Bump to 1.0.1, 1.1.0,
2.0.0, etc.; never re-publish a deleted version number.

## Files

```
pause-oura-system-api-spec/
├── README.md
├── pom.xml
└── src/main/resources/
    └── oura-system-api.oas3.yaml   <- the OAS 3.0 spec
```
