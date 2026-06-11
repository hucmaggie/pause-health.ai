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
| `_mock_path.sql`                      | (three CIs, mock data)          | 6h      | Static formulas against `Contact` records — proves the code path without a live JHE instance |

The Developer Names are **load-bearing** — they're referenced as constants in:

- `frontend/lib/salesforce/data-cloud.ts` (`CI_HRV_RMSSD_30D`, `CI_VASOMOTOR_BURDEN_30D`, `CI_SLEEP_DISRUPTION_7D`)

If you rename them in Data Cloud you must also update those constants
(and vice-versa). The end-to-end activation runbook lives in
`docs/MULESOFT_PHASE_2_DATA_CLOUD.md`; the quick-flip activation
checklist lives in `docs/PHASE_2_ACTIVATION_CHECKLIST.md`.

## Status snapshot (as of 2026-06-10)

- Code: ready (`frontend/lib/salesforce/data-cloud.ts`)
- Env: `SF_DC_TENANT_URL` slot reserved in `frontend/.env.example`,
  not set in `frontend/.env.local`
- Org: `trailsignup` org confirmed `NOT_FOUND` on
  `/services/data/v66.0/ssot/queryjobs` — **no DC tenant provisioned**
- Unblock-step: `Setup → Data Cloud → Get Started` in the trailsignup
  org (or stand up a dedicated DC trial org and wire fresh credentials)
