-- Pause_Vasomotor_Burden_30d — Calculated Insight (Data Cloud)
--
-- Phase 2 of the Data 360 grounding pipeline. Composite burden score
-- combining wearable thermoregulation events (hot flashes / night
-- sweats from skin temperature + HR signatures) with intake-reported
-- events. Sourced from the DBDP wearable feature pipeline.
--
-- Activation: Data Cloud → Calculated Insights → New → Developer Name
-- must be exactly `Pause_Vasomotor_Burden_30d` (matches the constant in
-- frontend/lib/salesforce/data-cloud.ts).
--
-- Refresh: every 6 hours (Activate → Schedule).
--
-- Verify after activation:
--   SELECT * FROM Pause_Vasomotor_Burden_30d
--   WHERE ssot__Id__c = '<contact-id>' LIMIT 5
--
-- Score interpretation: 0-100, where 0 = no events in 30d and 100 =
-- one severity-1 event per day for 30 days. Caller in data-cloud.ts
-- reads `burden_score_0_100` as the primary metric and
-- `flash_count_30d` for the human-readable description.

SELECT
  ssot__Id__c,
  SUM(vasomotor_event_severity) / 30.0 * 100   AS burden_score_0_100,
  COUNT(*)                                      AS flash_count_30d
FROM ssot__Observation__dlm
WHERE observation_type IN ('hot_flash', 'night_sweat')
  AND effectiveDateTime >= DATE_ADD(CURRENT_DATE, -30, 'DAY')
GROUP BY ssot__Id__c
