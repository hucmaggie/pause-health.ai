# Phase 2 Hardening — Real Wearable Features via the Data Cloud Ingestion API

**Goal:** replace the mock `MAX(constant)` Calculated Insights with real,
per-patient values computed by the DBDP feature pipeline — without standing up
a publicly-reachable JupyterHealth instance. `pause_ingest` computes the
features and **pushes** them straight into a Data Cloud **Ingestion API**
connector; the three Calculated Insights then aggregate the pushed rows.

**Audience:** someone with Salesforce Data Cloud Setup access + the
`pause_ingest` Python env. Budget ~1–2 hours (most of it is the one-time DLO/DMO
wiring).

**Status:** code SHIPPED (this repo); org-side wiring is the remaining work.
The frontend read path is unchanged — the real CIs emit the exact same output
columns as the mock, so nothing in `frontend/` changes.

---

## The architecture (what changed)

```
pause_ingest                         Salesforce Data Cloud                 frontend
────────────                         ─────────────────────                 ────────
features.py (HRV, real)
features_sleep.py (real)   ──push──►  Ingestion API connector
features_vasomotor.py (real)          └─ Pause_Wearable DLO
cohort.py (per-persona)                  └─ mapped → Pause_Wearable_Feature__dlm (DMO)
data_cloud.py (a360 + POST)                 └─ 3 Calculated Insights ──read──► data-cloud.ts
examples/data_cloud_push.py                    (HRV / vasomotor / sleep)        (UNCHANGED)
```

The feature **math** is real (same Kubios-validated HRV code, real
sleep-efficiency and vasomotor-burden logic). The demo patients are fictional,
so their **inputs** are synthesized deterministically from each persona's
clinical profile — see the honesty note in `pause_ingest/pause_ingest/cohort.py`.
On a real customer org, swap `cohort.py` for the real per-patient feature
stream; everything downstream is identical.

---

## What the worker produces

`python -m examples.data_cloud_push --dry-run` (no creds needed) prints the
exact payload. One flat object per row (schema:
`data-cloud/Pause_Wearable_Feature.dlo-schema.json`):

| field | type | meaning |
|---|---|---|
| `record_id` | string | idempotency key, slot-stable (e.g. `003…:hrv_rmssd:d07`) |
| `unified_id` | string | Health Cloud `Contact.Id` → CI `unified_id__c` |
| `observation_type` | string | `hrv_rmssd` \| `sleep_session` \| `hot_flash` \| `night_sweat` |
| `effective_date` | date-time | ISO-8601 w/ offset (informational) |
| `value_num` | number | RMSSD ms / sleep-efficiency 0-1 / event severity 1-3 |
| `source` | string | provenance tag |

For the six-persona demo that's **282 rows**: 180 HRV (6 × 30d), 42 sleep
(6 × 7 nights), 60 vasomotor events. The push **owns the window** (slot-stable
ids upsert in place), which is why the CIs need **no SQL date filter**.

---

## Step 1 — Grant the Connected App the ingest scope (5 min)

The read path already has `cdp_query_api`. Add the write scope:

- Setup → External Client Apps → `pause-prototype-cloudhub` → Edit Policies →
  OAuth Scopes → add **`cdp_ingest_api`**. Save.

(New scope appears on the next token mint; the worker mints fresh each run.)

## Step 2 — Create the Ingestion API data stream (20–30 min)

1. Data Cloud → **Data Streams** → New → **Ingestion API**.
2. Create a new Ingestion API **source** named **`Pause_Wearable`**
   (this is `SF_DC_INGEST_CONNECTOR`).
3. Upload the schema file `data-cloud/Pause_Wearable_Feature.dlo-schema.json`.
   It defines one object, **`wearable_feature`** (this is `SF_DC_INGEST_OBJECT`).
4. Set the **primary key** to `record_id` and the **event/record-modified
   field** as appropriate (use `effective_date`). Category: **Profile** or
   **Engagement** is fine; Profile keeps it queryable as current state.
5. Deploy the Data Stream. This creates the **DLO** (`Pause_Wearable_Feature__dll`).

> If the schema upload rejects a field, the most common cause is the
> `format: date-time` on `effective_date` — Data Cloud occasionally wants a
> plain `string`. Drop the `format` line and re-upload; `data_cloud.py` still
> sends a valid ISO string.

## Step 3 — Map the DLO to a DMO (15 min)

1. Data Cloud → **Data Model** → map `Pause_Wearable_Feature__dll` to a new
   **custom DMO** named **`Pause_Wearable_Feature`** (API name
   `Pause_Wearable_Feature__dlm`).
2. Map the fields so the DMO field API names are exactly (the CI SQL depends on
   these — all custom fields get the `__c` suffix automatically):
   - `unified_id` → **`unified_id__c`**
   - `observation_type` → **`observation_type__c`**
   - `value_num` → **`value_num__c`**
   - `effective_date` → **`effective_date__c`**
   - `record_id` → primary key
3. **Identity / relationship:** relate `unified_id__c` to `ssot__Individual__dlm`
   on `ssot__Id__c` if you want the DMO joined into the unified profile. The CIs
   below don't require the join (they group on `unified_id__c` directly), so
   this is optional for activation.

## Step 4 — Push the features (2 min)

```bash
cd pause_ingest
source .venv/bin/activate            # py3.12+ env with `pip install -e ".[dev]"`
cp .env.example .env                 # fill SF_INSTANCE_URL / SF_CLIENT_ID / SF_CLIENT_SECRET
                                     # (SF_DC_INGEST_CONNECTOR/OBJECT default to the names above)

python -m examples.data_cloud_push --dry-run   # sanity-check the payload
python -m examples.data_cloud_push             # live push (expects 202s)
```

Expected tail: `OK — pushed 282 wearable feature records to Pause_Wearable/wearable_feature.`

Confirm rows landed: Data Cloud → Data Explorer → `Pause_Wearable_Feature__dlm`
→ filter `unified_id__c = 003Hp00003b9bdqIAA` (Anika). You should see **51 rows**
(30 HRV + 7 sleep + 14 vasomotor — Anika's vasomotor score is 7 → 7 × 2 events).

## Step 5 — Swap the three CIs from mock → real (15 min)

For each CI, edit its SQL (Data Cloud → Calculated Insights → open → Edit) and
replace the `_mock_path.sql` body with the real definition. **Keep the
Developer Names unchanged** so the `__cio` API names — and therefore the
frontend — don't move:

| Calculated Insight | Replace with |
|---|---|
| `Pause_HRV_RMSSD_30d` | `data-cloud/Pause_HRV_RMSSD_30d.sql` |
| `Pause_Vasomotor_Burden_30d` | `data-cloud/Pause_Vasomotor_Burden_30d.sql` |
| `Pause_Sleep_Disruption_7d` | `data-cloud/Pause_Sleep_Disruption_7d.sql` |

Save → **Activate** → run a manual refresh (or wait for the 6h schedule). The
output columns are identical to the mock (`hrv_rmssd_ms__c`, `z_score__c`,
`window_days__c`, `burden_score_0_100__c`, `flash_count_30d__c`,
`disruption_index_0_1__c`, `disrupted_nights__c`, keyed by `unified_id__c`), so
no frontend change or redeploy is required.

## Step 6 — Verify end to end (5 min)

```bash
# Per-CI (Data 360 Insight API) — values now vary by patient:
curl -s "https://pause-health.ai/api/data-360/patient/anika-patel/grounding" \
  | jq '[.grounding.calculatedInsights[]
         | select(.federatedFrom[]? | contains("dbdp-wearable-features"))
         | {name, value, sourceWindow}]'
```

Sanity checks that prove it's real, not the constant mock:
- **Deepa** (vasomotor 9) has a **lower** HRV z-score than **Carmen** (vasomotor 2).
- **Brianna** (sleep score 8) has **more** disrupted nights than **Carmen** (sleep 3).
- Vasomotor event counts differ per patient (Anika ≈ 14, Carmen ≈ 4).

If every patient shows the same numbers, the mock CIs are still active — re-do
Step 5 for the offending CI.

---

## Failure modes — quick triage

| Symptom | Likely cause | Fix |
|---|---|---|
| `ingest POST failed (401/403)` | `cdp_ingest_api` scope missing | Step 1; re-run (worker mints a fresh token) |
| `token exchange failed (400) <empty body>` | core token not exchangeable for CDP | Connected App not enabled for Data Cloud / wrong instance URL |
| Rows in DLO but CIs still constant | mock SQL still active | Step 5 — edit + re-activate each CI |
| CI validator rejects the SQL | `__c` suffix / `unified_id__c` alias / aggregation rule | already handled in the committed SQL; if the DMO field names differ from Step 3, align them |
| All CI values null after push | DMO field mapping wrong | Step 3 — confirm `observation_type__c` / `value_num__c` are populated in Data Explorer |
| HRV/vasomotor windows look too long over time | history accumulated across many pushes | slot-stable ids prevent this for a fixed cohort; if pushing real daily data, add a `WHERE effective_date__c >= ...` filter to the CIs |

---

## Re-running on a real customer org

1. Replace `pause_ingest/pause_ingest/cohort.py` with the real per-patient
   feature stream (real Oura/Empatica → `features*.py` → `WearableFeatureRecord`).
   Everything in `data_cloud.py` and the CIs stays the same.
2. Map `unified_id` to the customer's real `Contact.Id` (or unified individual key).
3. Repeat Steps 1–6 against their org.

**End of runbook.** When Step 6 is green, the wearable insights are real.
