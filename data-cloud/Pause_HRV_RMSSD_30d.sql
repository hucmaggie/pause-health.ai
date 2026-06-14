-- Pause_HRV_RMSSD_30d — Calculated Insight (Data Cloud)
--
-- Phase 2 (real-data path). Aggregates the DBDP/FLIRT HRV RMSSD features
-- that pause_ingest pushes into Data Cloud via the Ingestion API
-- (data-cloud/Pause_Wearable_Feature.dlo-schema.json → the
-- Pause_Wearable_Feature__dlm DMO). Replaces the MAX(constant) mock in
-- data-cloud/_mock_path.sql with a genuine average over the patient's
-- 30-day window.
--
-- Source rows: observation_type__c = 'hrv_rmssd', value_num__c = daily
-- RMSSD in milliseconds (computed by pause_ingest.features.
-- hrv_time_domain_fallback). The push owns the 30-day window (30 slot-stable
-- rows per patient), so NO SQL date filter is needed — see the runbook.
--
-- Activation: Data Cloud → Calculated Insights → New. Developer Name MUST be
-- exactly `Pause_HRV_RMSSD_30d` (the engine appends __cio; the frontend
-- constant in frontend/lib/salesforce/data-cloud.ts is the __cio form).
-- Save → Activate → schedule refresh every 6 hours.
--
-- Output columns are frontend-load-bearing and MUST match the mock exactly
-- (data-cloud.ts reads hrv_rmssd_ms__c / z_score__c / window_days__c, keyed
-- by the unified_id__c dimension). The z-score denominator (42 ms mean,
-- 12 ms SD) is the approximate normative RMSSD for perimenopausal women;
-- override with cohort-specific values when available.
--
-- DC CI validator rules already learned (session 3): output columns must end
-- in __c, the GROUP BY dimension alias must be unified_id__c (NOT
-- ssot__Id__c — the inner __ is rejected), columns must be table.column, and
-- at least one aggregation is required.
--
-- Verify after activation (Data Explorer or the Insight API):
--   GET /api/v1/insight/calculated-insights/Pause_HRV_RMSSD_30d__cio
--       ?filters=[unified_id__c=<contact-id>]

SELECT
  Pause_Wearable_Feature__dlm.unified_id__c                                AS unified_id__c,
  AVG(Pause_Wearable_Feature__dlm.value_num__c)                            AS hrv_rmssd_ms__c,
  (AVG(Pause_Wearable_Feature__dlm.value_num__c) - 42.0) / 12.0            AS z_score__c,
  COUNT(Pause_Wearable_Feature__dlm.value_num__c)                          AS window_days__c
FROM Pause_Wearable_Feature__dlm
WHERE Pause_Wearable_Feature__dlm.observation_type__c = 'hrv_rmssd'
GROUP BY Pause_Wearable_Feature__dlm.unified_id__c
