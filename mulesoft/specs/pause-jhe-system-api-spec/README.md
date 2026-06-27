# pause-jhe-system-api-spec

OAS 3.0 contract for the JupyterHealth Exchange (JHE) REST surface that
Pause Health's `pause_ingest` Python worker integrates with today, and that
a customer-side `jhe-system-api` Mule project will wrap as a Mule System
API in MuleSoft Phase 1c.

Published to Anypoint Exchange as a versioned shared asset on the Pause
Health business group. **Spec only — there is no live `jhe-system-api`
Mule project yet.** Phase 1c materializes the implementation; this asset
exists so customer integration teams can review the contract first.

This is the second Phase 3 artifact promoted to Exchange (the first was
[`pause-omh-to-fhir-library`](../pause-omh-to-fhir-library/) v1.0.0). See
[`/proposal/mulesoft`](https://pause-health.ai/proposal/mulesoft) for the
Phase 3 narrative.

## What's in the spec

| | |
|---|---|
| `POST /o/token/` | OAuth 2.0 client_credentials grant. JHE accepts only `openid` + `email` scopes (others 400 with `invalid_scope`). |
| `POST /fhir/r5/Observation` | Write a FHIR R5 Observation. Routes mapped (OMH) vs auxiliary (pause-derived) by `code.coding[0].system`; the auxiliary handler requires `X-JHE-FHIR-Source-ID`. |
| `GET /fhir/r5/Observation?patient=…` | Search by patient. Returns a FHIR Bundle. Real JHE does NOT filter unknown patient ids — callers must enforce no-leakage. |

Plus 10 data-plane schemas documenting JHE's Django ORM (Study, Patient,
DataSource, FhirSource, etc.). **Those are NOT exposed as REST today** —
they're seeded by [`jhe-local/bootstrap.sh`](../../jhe-local/bootstrap.sh).
Documented in the spec's `components.schemas` so any Mule app calling
JHE shares the vocabulary.

The full contract is pinned in `pause_ingest`'s real-JHE test suite —
`PAUSE_USE_REAL_JHE=1 pytest` against `jhe-local` is the canonical
integration check.

## Coordinates

| | |
|---|---|
| groupId | `56707cc3-a0e3-4318-b110-78126aace370` (Pause Health business group) |
| artifactId | `pause-jhe-system-api-spec` |
| version | `1.0.0` |
| packaging | `jar` |
| Spec file (inside jar) | `jhe-system-api.oas3.yaml` |

## How to consume

```xml
<dependency>
    <groupId>56707cc3-a0e3-4318-b110-78126aace370</groupId>
    <artifactId>pause-jhe-system-api-spec</artifactId>
    <version>1.0.0</version>
</dependency>
```

Then read the spec off the classpath in any Mule app:

```dataweave
%dw 2.0
import * from dw::io::file::Files
output application/json
---
readUrl("classpath://jhe-system-api.oas3.yaml")
```

Or simply unzip the jar and point an Anypoint Studio / Code Builder
project at the file as an API spec.

## Why this is a plain `jar` (not `raml-fragment` or `rest-api`)

Anypoint Exchange supports first-class REST-API asset types
(`raml-fragment`, `rest-api`, etc.) with Swagger-UI rendering. We're using
plain `jar` for two reasons:

1. **Avoid the same `mule-plugin` extension-extraction trap that 502'd
   the DataWeave library publish.** Exchange's tooling service treats
   classifier-specific assets specially and can fail on metadata it
   doesn't expect. Plain jar is the safest path for spec-only artifacts.
2. **OAS 3.0 first-class support on Exchange v2 is limited.** Exchange's
   API portals built up around RAML 1.0; first-class OAS 3.0 hosting is
   patchier. Publishing as a jar avoids type-mismatch surprises and the
   spec is still consumer-readable.

If/when the team wants the Swagger UI rendering, the spec file can be
**re-published** via the Anypoint UI as a `rest-api` asset; the jar
version stays as the Maven-dependency-consumable copy. The yaml is the
source of truth either way.

## Build & publish

Requires Zulu 17 and an `~/.m2/settings.xml` with an `anypoint-exchange-v2`
server entry (both already in place per
[`memory/project_mulesoft_state.md`](../../../.claude/projects/-Users-maggie-hu-Projects-pause-health-ai/memory/project_mulesoft_state.md)).

```bash
cd mulesoft/specs/pause-jhe-system-api-spec
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
BASE=https://maven.anypoint.mulesoft.com/api/v2/organizations/56707cc3-a0e3-4318-b110-78126aace370/maven/56707cc3-a0e3-4318-b110-78126aace370/pause-jhe-system-api-spec/1.0.0

curl -s -X PUT "$BASE/pause-jhe-system-api-spec-1.0.0.pom" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/xml" \
  --data-binary @pom.xml -w "POM HTTP %{http_code}\n"
curl -s -X PUT "$BASE/pause-jhe-system-api-spec-1.0.0.jar" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/java-archive" \
  --data-binary @target/pause-jhe-system-api-spec-1.0.0.jar -w "JAR HTTP %{http_code}\n"
```

Anypoint Exchange tombstones deleted versions. Bump to 1.0.1, 1.1.0,
2.0.0, etc.; never re-publish a deleted version number.

## Files

```
pause-jhe-system-api-spec/
├── README.md
├── pom.xml
└── src/main/resources/
    └── jhe-system-api.oas3.yaml   <- the OAS 3.0 spec
```
