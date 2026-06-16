# Data 360 Phase 2 — Salesforce Data Cloud Setup Runbook

**Status:** Code ready. Org provisioning required before the live path activates.
**Estimated time:** 3–5 hours of Salesforce UI + SOQL verification.
**Prerequisites:** Phase 1 complete (SF_INSTANCE_URL, SF_CLIENT_ID, SF_CLIENT_SECRET working in `.env.local`).

## What Phase 2 adds

Phase 1 grounded the Care Router on three Salesforce Health Cloud SOQL insights
(enrollment status, days since last clinical contact, care plan status). Phase 2
layers three wearable/EHR Calculated Insights on top, sourced from Data Cloud:

| Insight | Developer Name in DC | Source data |
|---|---|---|
| HRV RMSSD variability z-score (30d) | `Pause_HRV_RMSSD_30d` | Oura FHIR observations via JupyterHealth |
| Vasomotor burden composite (30d) | `Pause_Vasomotor_Burden_30d` | Wearable thermoregulation + intake reports |
| Sleep disruption index (7d) | `Pause_Sleep_Disruption_7d` | Oura sleep staging via JupyterHealth |

When `SF_DC_TENANT_URL` is set and the CIs are provisioned, the grounding
response will show `Phase 2: SOQL (Health Cloud) + Data Cloud Calculated Insights`
in `groundingProvenance.federatedQuery` instead of the Phase 1 string.

## What was discovered about the current org

The `trailsignup` org (connected 2026-06-07) has:
- Data Cloud permission sets present: `CDPAdmin`, `DataCloudActManager`,
  `Mock_Data_Cloud_Access_Permission_Set`, etc.
- No provisioned Data Cloud tenant — `ssot/query` and `ssot/queryjobs`
  endpoints return 404.
- No `UnifiedIndividual` or `DataStreamDefinition` objects queryable.

This is an SDO with the DC demo scaffold but without an actual DC tenant
provisioned. Two options:

**Option A — Provision DC on this org (recommended for prototype):**
  Request a Data Cloud trial add-on at Setup → Data Cloud → Get Started.
  This is available on Enterprise+ orgs and most trial/SDO orgs.

**Option B — Use a dedicated Data Cloud org:**
  Create a new org via https://www.salesforce.com/form/signup/data-cloud-trial/
  and wire it with separate env vars. The same Connected App client ID/secret
  pattern applies.

## Step 0 — Verify your org has a DC tenant

```bash
sf api request rest "/services/data/v66.0/ssot/queryjobs" \
  --method POST \
  --body '{"sql":"SELECT 1"}' \
  --target-org trailsignup
```

Expected when provisioned: `{ "id": "...", "status": "pending" }` (or similar).
Current result: `{ "errorCode": "NOT_FOUND" }` → DC not yet provisioned.

## Step 1 — Get your Data Cloud tenant URL

Once provisioned, find the tenant URL at:
  Setup → Data Cloud → Settings → Tenant API URL

It follows the pattern:
```
https://<15-char-orgId>.c360a.salesforce.com
```

Your org ID is `00DHp00000L08KK`, so your tentative tenant URL would be:
```
https://00DHp00000L08KK.c360a.salesforce.com
```

Verify: `curl -I https://00DHp00000L08KK.c360a.salesforce.com` should return
a 200-range response (not a connection error) when DC is provisioned.

## Step 2 — Grant the Connected App DC access

The same Connected App you created for Phase 1 (`pause-prototype-cloudhub`
or equivalent) needs the following additional scopes for Data Cloud:

- `cdp_query_api` — allows POST to `/api/v1/query`
- `cdp_ingest_api` — allows write (not needed for Phase 2 read-only, but add
  it now so you don't have to re-grant later)

Setup → External Client Apps → `pause-prototype-cloudhub` → Edit Policies →
Add OAuth Scopes → search "Data Cloud" → add the two scopes above.

## Step 3 — Create the Data Model Objects (DMOs)

Data Cloud Calculated Insights run over Data Model Objects. You need one
DMO per source. For Phase 2, the minimum is:

### 3a — JupyterHealth FHIR Observation DMO

If you have a JupyterHealth test instance or FHIR endpoint:
1. Data Cloud → Data Streams → New → API/File → name it `JupyterHealth_FHIR_Observations`.
2. Or use the local mock: pause_ingest exposes FHIR R5 Observations at
   `localhost:5000/fhir/R5/Observation?patient=pause-demo-patient-001`.
   Use the HTTP API Data Stream type, set the polling interval to 1 hour.

For the prototype without a live JHE instance, skip to the **mock CI path**
at the bottom of this doc — you can author the CI against the seeded
Health Cloud Contacts as a stand-in.

### 3b — Unified Individual mapping

The CIs group by the UnifiedIndividual key for the patient, surfaced to the
Insight API as the `unified_id__c` dimension. Wire your FHIR Data Stream's
patient ID field to the UnifiedIndividual's primary key so it resolves to the
Health Cloud `Contact.Id` that Phase 1 already uses.

For the prototype: map `Contact.Id` from Health Cloud (which you already have
from Phase 1) as the identity source.

## Step 4 — Author the three Calculated Insights

Each CI is authored in Data Cloud → Calculated Insights → New.

> **⚠️ Use the committed SQL, not these snippets.** The canonical,
> validator-correct, copy-paste SQL lives in `data-cloud/*.sql` (the real
> `Pause_Wearable_Feature__dlm` path) and `data-cloud/_mock_path.sql` (the
> activated mock). The illustrative blocks below predate two non-obvious DC
> CI validator rules (learned in session 3): the GROUP BY dimension MUST be
> aliased `unified_id__c` — the raw `ssot__Id__c` alias is rejected because of
> the inner `__` — and every output column MUST end in `__c`. The frontend
> filters on `[unified_id__c=<contact-id>]` and reads the `__c` columns, so
> the snippets here are conceptual only.

### CI 1: `Pause_HRV_RMSSD_30d`

```sql
SELECT
  ssot__Id__c,
  AVG(hrv_rmssd_ms)                            AS hrv_rmssd_ms,
  (AVG(hrv_rmssd_ms) - 42.0) / 12.0           AS z_score,
  COUNT(*)                                     AS window_days
FROM ssot__Observation__dlm
WHERE observation_type = 'hrv_rmssd'
  AND effectiveDateTime >= DATE_ADD(CURRENT_DATE, -30, 'DAY')
GROUP BY ssot__Id__c
```

Adjust `ssot__Observation__dlm` to your actual DMO name and field names.
The z-score denominator (42ms mean, 12ms SD) is the approximate normative
RMSSD for perimenopausal women — override with cohort-specific values when
you have them.

### CI 2: `Pause_Vasomotor_Burden_30d`

```sql
SELECT
  ssot__Id__c,
  SUM(vasomotor_event_severity) / 30.0 * 100   AS burden_score_0_100,
  COUNT(*)                                      AS flash_count_30d
FROM ssot__Observation__dlm
WHERE observation_type IN ('hot_flash', 'night_sweat')
  AND effectiveDateTime >= DATE_ADD(CURRENT_DATE, -30, 'DAY')
GROUP BY ssot__Id__c
```

### CI 3: `Pause_Sleep_Disruption_7d`

```sql
SELECT
  ssot__Id__c,
  SUM(CASE WHEN sleep_efficiency < 0.80 THEN 1 ELSE 0 END) / 7.0  AS disruption_index_0_1,
  SUM(CASE WHEN sleep_efficiency < 0.80 THEN 1 ELSE 0 END)         AS disrupted_nights
FROM ssot__Observation__dlm
WHERE observation_type = 'sleep_session'
  AND effectiveDateTime >= DATE_ADD(CURRENT_DATE, -7, 'DAY')
GROUP BY ssot__Id__c
```

After saving each CI:
- Click **Activate** → schedule it to refresh every 6 hours.
- Verify: Data Cloud → Calculated Insights → `Pause_HRV_RMSSD_30d` → **Query** →
  paste `SELECT * FROM Pause_HRV_RMSSD_30d__cio WHERE unified_id__c = '<contact-id>' LIMIT 5`
  (the dimension is `unified_id__c`, NOT `ssot__Id__c`) and confirm rows appear.

## Step 5 — Set the env var and verify

```bash
# frontend/.env.local — add:
SF_DC_TENANT_URL=https://00DHp00000L08KK.c360a.salesforce.com
```

Then restart Next.js and hit the grounding endpoint:

```bash
curl -s "http://localhost:3000/api/data-360/patient/pause-demo-patient-001/grounding" \
  | jq '.grounding.groundingProvenance.federatedQuery'
# Expected: "Phase 2: SOQL (Health Cloud) + Data Cloud Calculated Insights (HRV/vasomotor/sleep)"

curl -s "http://localhost:3000/api/data-360/patient/pause-demo-patient-001/grounding" \
  | jq '[.grounding.calculatedInsights[] | {name, value, sourceWindow}]'
# Expected: HRV/vasomotor/sleep insights have sourceWindow "30d" or "7d" (not "intake-only")
```

## Mock CI path (no live wearable data yet)

If you want to prove the Phase 2 code path without real wearable data:

1. Create the three CIs against the seeded `Contact` records using
   fabricated values in a static formula:
   ```sql
   SELECT Id AS ssot__Id__c, -0.3 AS z_score, 38.2 AS hrv_rmssd_ms, 30 AS window_days
   FROM Contact WHERE Title = 'Pause Demo Patient'
   ```
   This proves the query path end-to-end. The values will be static but
   the source attribution in the UI will correctly show
   `federatedFrom: ["dbdp-wearable-features", "jupyterhealth-fhir"]`.

2. Wire a real JHE instance when available — the CI SQL and the grounding
   code don't change, only the data behind the DMO changes.

## What activates automatically once this is done

- `/api/data-360/patient/*/grounding` response: three insights flip from
  `sourceWindow: "intake-only"` to `"30d"` / `"7d"`.
- `/proposal/data-360` "Prototype vs production" table: the
  "Calculated insights — wearable / EHR" row can be bumped from
  `designed` to `prototype` (one-line change in `page.tsx`).
- Agent Fabric trace: `Data 360 grounding.federated-query` span shows
  `sourcesQueried` including `dbdp-wearable-features` and `jupyterhealth-fhir`.
- The Care Router rationale will begin citing HRV and vasomotor data in
  its routing decisions.

## Failure modes to watch for

1. **`SF_DC_TENANT_URL` 404** — DC not provisioned yet. The `getWearableInsights`
   call catches the error and returns `null`; grounding degrades silently
   to intake-only baselines. Check `SF_DC_TENANT_URL` is correct.

2. **`cdp_query_api` scope missing** — DC API returns 401. The same
   catch/null/degrade path applies. Add the scope to the Connected App
   and re-run the OAuth flow (or wait for the next token refresh, ~2h).

3. **CI not activated** — DC returns an empty `data` array. Each `wearable`
   insight will be `null` and grounding falls back to the baseline for
   that insight only. Activate the CI in the Data Cloud UI and wait for
   the first scheduled run.

4. **`unified_id__c` mismatch** — the CI filters by the Contact.Id from Phase 1
   (via the `unified_id__c` dimension), but your DC UnifiedIndividual uses a
   different identity key, so every row comes back empty. Update the `filter`
   expression in `data-cloud.ts::getWearableInsights` to match your actual CI
   key field.
