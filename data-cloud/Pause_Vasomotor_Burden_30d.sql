-- Pause_Vasomotor_Burden_30d — Calculated Insight (Data Cloud)
--
-- Phase 2 (real-data path). Composite vasomotor burden over the patient's
-- 30-day window, aggregating the hot-flash / night-sweat events that
-- pause_ingest detects (pause_ingest.features_vasomotor.detect_vasomotor_event)
-- and pushes via the Ingestion API into Pause_Wearable_Feature__dlm.
-- Replaces the MAX(constant) mock in data-cloud/_mock_path.sql.
--
-- Source rows: observation_type__c IN ('hot_flash','night_sweat'),
-- value_num__c = event severity (1-3). The push owns the 30-day window, so
-- NO SQL date filter is needed.
--
-- Score definition (must match pause_ingest.features_vasomotor.vasomotor_burden):
--   burden_score_0_100 = SUM(severity) / 30 * 100   (the worker caps at 100;
--   the cohort generator never approaches the cap, so the CI omits the cap.)
--
-- Activation: Developer Name MUST be exactly `Pause_Vasomotor_Burden_30d`
-- (engine appends __cio). Save → Activate → refresh every 6 hours.
--
-- Output columns are frontend-load-bearing: data-cloud.ts reads
-- burden_score_0_100__c and flash_count_30d__c keyed by unified_id__c.
--
-- Verify after activation:
--   GET /api/v1/insight/calculated-insights/Pause_Vasomotor_Burden_30d__cio
--       ?filters=[unified_id__c=<contact-id>]

SELECT
  Pause_Wearable_Feature__dlm.unified_id__c                                AS unified_id__c,
  SUM(Pause_Wearable_Feature__dlm.value_num__c) / 30.0 * 100               AS burden_score_0_100__c,
  COUNT(Pause_Wearable_Feature__dlm.value_num__c)                          AS flash_count_30d__c
FROM Pause_Wearable_Feature__dlm
WHERE Pause_Wearable_Feature__dlm.observation_type__c IN ('hot_flash', 'night_sweat')
GROUP BY Pause_Wearable_Feature__dlm.unified_id__c
