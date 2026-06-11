-- Pause_Sleep_Disruption_7d — Calculated Insight (Data Cloud)
--
-- Phase 2 of the Data 360 grounding pipeline. Counts nights in the
-- last 7 days where sleep efficiency dropped below 0.80 — a proxy
-- for menopause-related sleep disruption. Sourced from Oura sleep
-- staging via JupyterHealth FHIR Observations.
--
-- Activation: Data Cloud → Calculated Insights → New → Developer Name
-- must be exactly `Pause_Sleep_Disruption_7d` (matches the constant in
-- frontend/lib/salesforce/data-cloud.ts).
--
-- Refresh: every 6 hours (Activate → Schedule). Shorter window than the
-- HRV/vasomotor 30d CIs because sleep disruption is more volatile and
-- the Care Router uses the most recent week for routing decisions.
--
-- Verify after activation:
--   SELECT * FROM Pause_Sleep_Disruption_7d
--   WHERE ssot__Id__c = '<contact-id>' LIMIT 5
--
-- Score interpretation: 0.0-1.0 fraction (≈ disrupted_nights / 7).
-- Caller in data-cloud.ts reads `disruption_index_0_1` as the primary
-- metric and `disrupted_nights` for the human-readable description.

SELECT
  ssot__Id__c,
  SUM(CASE WHEN sleep_efficiency < 0.80 THEN 1 ELSE 0 END) / 7.0  AS disruption_index_0_1,
  SUM(CASE WHEN sleep_efficiency < 0.80 THEN 1 ELSE 0 END)         AS disrupted_nights
FROM ssot__Observation__dlm
WHERE observation_type = 'sleep_session'
  AND effectiveDateTime >= DATE_ADD(CURRENT_DATE, -7, 'DAY')
GROUP BY ssot__Id__c
