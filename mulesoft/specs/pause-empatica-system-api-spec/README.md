# pause-empatica-system-api-spec

OAS 3.0 contract for the Pause Empatica E4 System API.

**Spec only.** Empatica E4 is the most common research-grade wearable
in academic menopause / women's-health studies. There is no consumer
Empatica Cloud REST API; the research model is researcher-uploaded
session archives. So this System API uses the **upload pattern** —
similar in shape to
[`pause-healthkit-system-api-spec`](../pause-healthkit-system-api-spec/)
but accepting binary .zip archives instead of JSON batches.

The Empatica module in `pause_ingest`
([`empatica.py`](../../../pause_ingest/pause_ingest/empatica.py))
currently raises `EmpaticaIngestNotImplemented` — Phase 2 of the DBDP
integration. The blocker is `devicely`'s numpy<2.0 pin (used for E4
de-identification) being incompatible with the Python 3.13 scientific
stack the rest of `pause_ingest` runs on. This spec describes the HTTP
surface the future Mule wrapper will expose; once the de-id pipeline
lights up, the Mule project lands on this contract.

## Endpoints

| | |
|---|---|
| `POST /empatica/{patient}/upload` | Multipart upload of an E4 `.zip` session archive. Mule app de-identifies, normalizes each signal CSV (`HR`, `IBI`, `EDA`, `TEMP`, `ACC`, `BVP`, `TAGS`), emits OMH downstream, persists archive to blob storage for re-processing. Returns per-signal acceptance report + opaque `sessionId`. |
| `POST /empatica/{patient}/derive` | Re-run feature derivation on a previously-uploaded session — fans out to [`pause-dbdp-system-api-spec`](../pause-dbdp-system-api-spec/) and writes derived Observations to JHE with `derivedFrom` lineage. |
| `GET /empatica/{patient}/sessions` | List uploaded session ids for audit and re-derivation workflows. |

Spec file:
[`src/main/resources/empatica-system-api.oas3.yaml`](./src/main/resources/empatica-system-api.oas3.yaml).
Same build/publish/consume recipe as the Oura asset.
