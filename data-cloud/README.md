# Salesforce Data Cloud — Calculated Insight definitions

These files are **not executed by application code**. They are the
canonical, version-controlled source of the Phase 2 Data Cloud
Calculated Insight SQL, intended to be copy-pasted into the Data Cloud
UI (`Setup → Data Cloud → Calculated Insights → New`) during activation.

There are **two interchangeable definitions** of the same three CIs. Both
emit the identical output columns, so the frontend (`data-cloud.ts`) is
unchanged regardless of which is active:

- **Mock** (`_mock_path.sql`) — `MAX(constant)` over `ssot__Individual__dlm`.
  Proves the pipeline with zero data infrastructure. **Currently activated.**
- **Real** (the three per-CI `.sql` files) — aggregate real DBDP-computed
  features out of the `Pause_Wearable_Feature__dlm` DMO, which is fed by the
  Data Cloud **Ingestion API** push from `pause_ingest`
  (`examples/data_cloud_push.py`). Swap-in steps:
  **`docs/PHASE_2_INGESTION_API_RUNBOOK.md`**.

| File                                  | Developer Name                  | Refresh | Source (real path)                          |
|---------------------------------------|---------------------------------|---------|---------------------------------------------|
| `Pause_HRV_RMSSD_30d.sql`             | `Pause_HRV_RMSSD_30d`           | 6h      | `AVG(value_num)` over `hrv_rmssd` rows (30d) |
| `Pause_Vasomotor_Burden_30d.sql`      | `Pause_Vasomotor_Burden_30d`    | 6h      | `SUM(severity)/30*100` over event rows (30d) |
| `Pause_Sleep_Disruption_7d.sql`       | `Pause_Sleep_Disruption_7d`     | 6h      | nights `< 0.80` over `sleep_session` rows (7d) |
| `_mock_path.sql`                      | (three CIs, mock data)          | 6h      | `MAX(constant)` over `ssot__Individual__dlm` (currently activated) |
| `Pause_Wearable_Feature.dlo-schema.json` | (Ingestion API schema)       | n/a     | OpenAPI schema uploaded to create the `Pause_Wearable` DLO/DMO |

The Developer Names are **load-bearing** — they're referenced as constants in:

- `frontend/lib/salesforce/data-cloud.ts` (`CI_HRV_RMSSD_30D`, `CI_VASOMOTOR_BURDEN_30D`, `CI_SLEEP_DISRUPTION_7D`)

Note: Data Cloud appends `__cio` to each CI's API name, so those
constants carry the suffix (e.g. `Pause_HRV_RMSSD_30d__cio`), and the
client filters on `unified_id__c` (the validator rejected `ssot__Id__c`
as a dimension alias). If you rename a CI in Data Cloud you must also
update those constants (and vice-versa). The end-to-end activation
runbook lives in `docs/MULESOFT_PHASE_2_DATA_CLOUD.md`; the quick-flip
activation checklist + the gotchas we hit live in
`docs/PHASE_2_ACTIVATION_CHECKLIST.md`.

## Status snapshot (as of 2026-06-13)

- **SHIPPED.** Phase 2 is live in production; `/api/data-360/.../grounding`
  returns `"Phase 2: SOQL (Health Cloud) + Data Cloud Calculated Insights
  (HRV/vasomotor/sleep)"`.
- Code: live (`frontend/lib/salesforce/data-cloud.ts`), with the mandatory
  a360 token exchange and the `/api/v1/insight/calculated-insights/{ci}`
  query endpoint.
- Env: `SF_DC_TENANT_URL` set on Vercel (Production + Preview + Development).
- Org: `trailsignup` DC tenant provisioned; the three CIs are authored +
  activated over `ssot__Individual__dlm` using the **mock** `_mock_path.sql`
  formulas (demo-cohort values).
- Next iteration (code SHIPPED, org wiring pending): replace the mock CIs with
  real DBDP feature math via the Data Cloud **Ingestion API**. The feature
  computation (`pause_ingest/features.py`, `features_sleep.py`,
  `features_vasomotor.py`), the per-persona generator (`cohort.py`), the push
  client (`data_cloud.py` + `examples/data_cloud_push.py`), the DLO schema, and
  the real CI SQL are all in the repo and tested. Follow
  `docs/PHASE_2_INGESTION_API_RUNBOOK.md` to wire the connector + DMO and flip
  the CIs. (The older `docs/JHE_SETUP_RUNBOOK.md` Data-Stream-from-JHE path
  remains valid but needs a publicly-reachable JHE; the Ingestion API push
  avoids that.)
