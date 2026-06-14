-- Pause_Sleep_Disruption_7d — Calculated Insight (Data Cloud)
--
-- Phase 2 (real-data path). Counts nights in the patient's 7-night window
-- whose sleep efficiency fell below 0.80 — the menopause-related
-- sleep-disruption proxy the Care Router routes on. Aggregates the nightly
-- sleep-efficiency features pause_ingest computes
-- (pause_ingest.features_sleep.sleep_efficiency_from_stages) and pushes via
-- the Ingestion API into Pause_Wearable_Feature__dlm. Replaces the
-- MAX(constant) mock in data-cloud/_mock_path.sql.
--
-- Source rows: observation_type__c = 'sleep_session', value_num__c = nightly
-- sleep-efficiency fraction (0-1). The push owns the 7-night window (7
-- slot-stable rows per patient), so NO SQL date filter is needed — the
-- shorter window vs. the 30-day CIs is enforced by how many sleep_session
-- rows the worker emits.
--
-- Disruption index (must match pause_ingest.features_sleep.sleep_disruption_index):
--   disruption_index_0_1 = disrupted_nights / 7
--
-- Activation: Developer Name MUST be exactly `Pause_Sleep_Disruption_7d`
-- (engine appends __cio). Save → Activate → refresh every 6 hours.
--
-- Output columns are frontend-load-bearing: data-cloud.ts reads
-- disruption_index_0_1__c and disrupted_nights__c keyed by unified_id__c.
--
-- Verify after activation:
--   GET /api/v1/insight/calculated-insights/Pause_Sleep_Disruption_7d__cio
--       ?filters=[unified_id__c=<contact-id>]

SELECT
  Pause_Wearable_Feature__dlm.unified_id__c                                                       AS unified_id__c,
  SUM(CASE WHEN Pause_Wearable_Feature__dlm.value_num__c < 0.80 THEN 1 ELSE 0 END) / 7.0          AS disruption_index_0_1__c,
  SUM(CASE WHEN Pause_Wearable_Feature__dlm.value_num__c < 0.80 THEN 1 ELSE 0 END)                AS disrupted_nights__c
FROM Pause_Wearable_Feature__dlm
WHERE Pause_Wearable_Feature__dlm.observation_type__c = 'sleep_session'
GROUP BY Pause_Wearable_Feature__dlm.unified_id__c
