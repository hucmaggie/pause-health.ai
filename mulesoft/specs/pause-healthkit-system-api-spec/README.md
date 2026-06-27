# pause-healthkit-system-api-spec

OAS 3.0 contract for the Pause HealthKit System API.

**Spec only.** HealthKit's integration model is iOS-app-side — the Pause
iOS app reads HealthKit via `HKHealthStore` and posts batches up to this
endpoint. Apple does not expose a cloud REST API; there's no upstream
to poll. That makes this an *upload-pattern* System API, distinct from
Oura's pull-pattern. The downstream OMH envelope shape Process APIs
consume is unchanged.

Fifth Phase 3 spec on Exchange. Same build/publish/consume recipe as
[`pause-oura-system-api-spec`](../pause-oura-system-api-spec/) — see
that README for the canonical instructions; the only differences here
are the `artifactId` (`pause-healthkit-system-api-spec`) and the spec
file name (`healthkit-system-api.oas3.yaml`).

## Endpoints

| | |
|---|---|
| `POST /healthkit/{patient}/upload` | iOS app posts a HealthKit-shaped batch. Returns a per-sample acceptance report. |
| `GET /healthkit/{patient}/types` | Returns the allow-list of `HKType` identifiers the Mule app accepts. Lets the iOS app skip consent prompts for types Pause won't ingest. |

Spec file: [`src/main/resources/healthkit-system-api.oas3.yaml`](./src/main/resources/healthkit-system-api.oas3.yaml).
