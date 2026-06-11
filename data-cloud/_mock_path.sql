-- Mock CI path — proves the Phase 2 code path without real wearable data.
--
-- USE THIS when:
--   - Data Cloud tenant is provisioned and the Connected App has
--     cdp_query_api scope, BUT
--   - You don't have a live JupyterHealth instance feeding FHIR
--     Observations into the ssot__Observation__dlm DMO yet.
--
-- Authoring: create THREE Calculated Insights in Data Cloud with the
-- Developer Names below, each using one of the three queries here.
-- The static values let the grounding pipeline activate end-to-end so
-- the source-attribution UI shows federatedFrom: ["dbdp-wearable-
-- features", "jupyterhealth-fhir"] correctly. The numeric values are
-- representative of a perimenopausal patient with moderate symptoms.
--
-- Once a real JHE instance is wired, replace these CI bodies with
-- the live queries in:
--   Pause_HRV_RMSSD_30d.sql
--   Pause_Vasomotor_Burden_30d.sql
--   Pause_Sleep_Disruption_7d.sql
-- — the Developer Names don't change, only the query bodies, so no
-- code changes are needed in data-cloud.ts.
--
-- Prereq: the seeded Contact records carry Title = 'Pause Demo Patient'
-- (see pause_ingest seed scripts). Adjust the WHERE clause if your
-- demo dataset uses a different marker.

-- =============================================================
-- CI 1: Pause_HRV_RMSSD_30d (mock)
-- =============================================================
SELECT
  Id   AS ssot__Id__c,
  38.2 AS hrv_rmssd_ms,
  -0.3 AS z_score,
  30   AS window_days
FROM Contact
WHERE Title = 'Pause Demo Patient';

-- =============================================================
-- CI 2: Pause_Vasomotor_Burden_30d (mock)
-- =============================================================
SELECT
  Id   AS ssot__Id__c,
  47.5 AS burden_score_0_100,
  14   AS flash_count_30d
FROM Contact
WHERE Title = 'Pause Demo Patient';

-- =============================================================
-- CI 3: Pause_Sleep_Disruption_7d (mock)
-- =============================================================
SELECT
  Id    AS ssot__Id__c,
  0.43  AS disruption_index_0_1,
  3     AS disrupted_nights
FROM Contact
WHERE Title = 'Pause Demo Patient';
