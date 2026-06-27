# pause-omh-to-fhir-library

Reusable DataWeave library: **Open mHealth (IEEE 1752.1) -> FHIR R5 Observation.**

Published to Anypoint Exchange under the Pause Health business group as a
shared, versioned asset so any Pause-or-customer-side Mule app can call the
transform directly instead of re-implementing the OMH<->FHIR mapping.

This is the first artifact promoted under the MuleSoft Phase 3 plan
(multi-customer fabric) at `/proposal/mulesoft`. See
[`docs/mulesoft-integration.md`](../../docs/mulesoft-integration.md) for the
phased plan and
[`docs/MULESOFT_RUNBOOK.md`](../../docs/MULESOFT_RUNBOOK.md) for the live
state of the Phase 1 worker that will consume it.

## Coordinates

| | |
|---|---|
| groupId | `56707cc3-a0e3-4318-b110-78126aace370` (Pause Health business group) |
| artifactId | `pause-omh-to-fhir-library` |
| version | `1.0.0` |
| packaging | `jar` |
| classifier | _(none — see below)_ |
| Exchange asset type | Plain Maven jar (DataWeave library) |

## How to consume

Add the dependency to any Mule app's `pom.xml`:

```xml
<dependency>
    <groupId>56707cc3-a0e3-4318-b110-78126aace370</groupId>
    <artifactId>pause-omh-to-fhir-library</artifactId>
    <version>1.0.0</version>
</dependency>
```

> **Note on classifier.** This is a plain Maven jar carrying DataWeave
> resources, not a Mule SDK extension. Tagging it `classifier=mule-plugin`
> would trigger Exchange's `ms-exchange-tooling-service` extension-model
> extraction, which 502s on a no-SDK jar. The Mule runtime picks up the
> `dw/` namespace from any jar on the classpath, so the classifier is not
> needed.

And import the module from any DataWeave script:

```dataweave
%dw 2.0
import dw::pause::health::omh
output application/json
---
omh::omhToObservation(payload, "Patient/pause-demo-patient-001", 0)
```

The function signature is:

```
fun omhToObservation(sample: Object, patientRef: String, idx: Number): Object
```

Returns a `{ fullUrl, resource }` shape ready to drop into a FHIR `Bundle.entry[]`.

## Supported OMH schemas

| `schema_id.name` | FHIR LOINC code | Notes |
|---|---|---|
| `heart-rate` | 8867-4 | `valueQuantity` in `/min` |
| `heart-rate-variability-rmssd` | 80404-7 | `valueQuantity` in `ms` |
| `sleep-duration` | 93832-4 | `valueQuantity` honors the OMH unit (`min`, `h`, etc.) |
| _anything else_ | `urn:pause-health:code:unmapped-omh` | Fall-through; never throws |

Provenance: every emitted Observation carries the `urn:pause-health:extension:mulesoft-pipeline-version`
extension and `meta.source = urn:pause-health:mulesoft:pause-ingest-process-api` so the
read path can distinguish samples that came through the MuleSoft pipeline from direct
ingest.

## Build & publish

Requires Zulu 17 (`JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home`)
and a `~/.m2/settings.xml` with an `anypoint-exchange-v2` server entry — both are already
in place per [`memory/project_mulesoft_state.md`](../../.claude/projects/-Users-maggie-hu-Projects-pause-health-ai/memory/project_mulesoft_state.md).

```bash
cd mulesoft/pause-omh-to-fhir-library

# 1. Build
mvn -B clean package

# 2. Publish to Anypoint Exchange v2
#
# Exchange v2 requires the POM upload to be Content-Type: application/xml.
# mvn-deploy-plugin's HTTP transport defaults to application/x-www-form-urlencoded
# for .pom files, which Exchange 500s on ("input contained no data"). The
# direct PUT below works around that. The jar upload is content-type-clean.

CRED=$(grep -A 3 anypoint-exchange-v2 ~/.m2/settings.xml | grep password | sed 's/.*>\(.*\)<.*/\1/')
CLIENT_ID=$(echo $CRED | cut -d'~' -f1)
CLIENT_SECRET=$(echo $CRED | cut -d'~' -f3)
TOKEN=$(curl -s -X POST "https://anypoint.mulesoft.com/accounts/api/v2/oauth2/token" \
  -d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET" \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
BASE=https://maven.anypoint.mulesoft.com/api/v2/organizations/56707cc3-a0e3-4318-b110-78126aace370/maven/56707cc3-a0e3-4318-b110-78126aace370/pause-omh-to-fhir-library/1.0.0

curl -s -X PUT "$BASE/pause-omh-to-fhir-library-1.0.0.pom" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/xml" \
  --data-binary @pom.xml -w "POM HTTP %{http_code}\n"
curl -s -X PUT "$BASE/pause-omh-to-fhir-library-1.0.0.jar" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/java-archive" \
  --data-binary @target/pause-omh-to-fhir-library-1.0.0.jar -w "JAR HTTP %{http_code}\n"
```

**Versioning policy:** Anypoint Exchange tombstones deleted versions — a deleted
version number can never be reused. Bump to `1.0.1`, `1.1.0`, `2.0.0` etc.; never re-publish `1.0.0`.

## Files

```
pause-omh-to-fhir-library/
├── README.md
├── pom.xml
└── src/main/resources/dw/pause/health/omh.dwl   <- the transform
```
