-- Pause_HRV_RMSSD_30d — Calculated Insight (Data Cloud)
--
-- Phase 2 of the Data 360 grounding pipeline. Layers a real HRV signal
-- on top of the Phase 1 Health Cloud SOQL grounding, sourced from the
-- DBDP wearable feature pipeline via JupyterHealth FHIR Observations.
--
-- Activation: Data Cloud → Calculated Insights → New → Developer Name
-- must be exactly `Pause_HRV_RMSSD_30d` (matches the constant in
-- frontend/lib/salesforce/data-cloud.ts).
--
-- Refresh: every 6 hours (Activate → Schedule).
--
-- Verify after activation:
--   SELECT * FROM Pause_HRV_RMSSD_30d
--   WHERE ssot__Id__c = '<contact-id>' LIMIT 5
--
-- The z-score denominator (42ms mean, 12ms SD) is the approximate
-- normative RMSSD for perimenopausal women. Override with cohort-
-- specific values when available. Caller in data-cloud.ts reads
-- `z_score` as the primary metric and `hrv_rmssd_ms` for the
-- human-readable description.

SELECT
  ssot__Id__c,
  AVG(hrv_rmssd_ms)                            AS hrv_rmssd_ms,
  (AVG(hrv_rmssd_ms) - 42.0) / 12.0           AS z_score,
  COUNT(*)                                     AS window_days
FROM ssot__Observation__dlm
WHERE observation_type = 'hrv_rmssd'
  AND effectiveDateTime >= DATE_ADD(CURRENT_DATE, -30, 'DAY')
GROUP BY ssot__Id__c
