# Salesforce Data Cloud — Calculated Insight definitions

These files are **not executed by application code**. They are the
canonical, version-controlled source of the Phase 2 Data Cloud
Calculated Insight SQL, intended to be copy-pasted into the Data Cloud
UI (`Setup → Data Cloud → Calculated Insights → New`) during activation.

| File                                  | Developer Name                  | Refresh | Source                  |
|---------------------------------------|---------------------------------|---------|-------------------------|
| `Pause_HRV_RMSSD_30d.sql`             | `Pause_HRV_RMSSD_30d`           | 6h      | Oura/DBDP via JHE FHIR  |
| `Pause_Vasomotor_Burden_30d.sql`      | `Pause_Vasomotor_Burden_30d`    | 6h      | Wearable + intake       |
| `Pause_Sleep_Disruption_7d.sql`       | `Pause_Sleep_Disruption_7d`     | 6h      | Oura sleep via JHE FHIR |
| `_mock_path.sql`                      | (three CIs, mock data)          | 6h      | `MAX(constant)` formulas + GROUP BY over `ssot__Individual__dlm` — proves the code path without a live JHE instance (this is what's currently activated) |

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
- Next iteration: replace the mock CIs with real JHE/DBDP wearable math
  (stand up JHE per `docs/JHE_SETUP_RUNBOOK.md`, point a Data Stream at it).
