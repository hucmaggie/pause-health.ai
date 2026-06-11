-- Mock CI path — proves the Phase 2 code path end-to-end without real
-- wearable data, against the actual ssot__Individual__dlm on the
-- trailsignup org.
--
-- WHY THIS WORKS (verified 2026-06-10 against the live org):
--   - ssot__Individual__dlm has 1168 records (populated by the SDO
--     scaffold's standard identity resolution).
--   - All six Pause demo personas (Anika Patel, Brianna Okafor,
--     Carmen Diaz, Deepa Krishnan, Elena Rossi, Fatima Khan) resolved
--     into Individual with their original Contact.Id as ssot__Id__c.
--   - data-cloud.ts already filters on ssot__Id__c — code path unchanged.
--
-- WHY NOT Contact_Home__dll:
--   - The Contact_Home Data Stream failed first ingestion on
--     2026-06-10 with status=Failure and 0 records processed.
--     (Diagnosis deferred — see docs/PHASE_2_ACTIVATION_CHECKLIST.md.)
--   - ssot__Individual__dlm already has the data we need, so we
--     route around the broken stream.
--
-- AUTHORING: paste each query below into Data Cloud → Calculated
-- Insights → New with the corresponding Developer Name. Activate
-- each CI with a 6-hour refresh schedule.

-- The WHERE clause matches FirstName+LastName pairs exactly, not as
-- IN cross-products, so the two extra SDO-scaffold Carmens (Lux and
-- Garcia) are correctly excluded. Identical predicate used in all
-- three CIs.

-- =============================================================
-- CI 1: Pause_HRV_RMSSD_30d (mock)
-- Developer Name MUST be exactly: Pause_HRV_RMSSD_30d
-- =============================================================
SELECT
  ssot__Id__c                                AS ssot__Id__c,
  38.2                                       AS hrv_rmssd_ms,
  -0.3                                       AS z_score,
  30                                         AS window_days
FROM ssot__Individual__dlm
WHERE (ssot__FirstName__c = 'Anika'   AND ssot__LastName__c = 'Patel')
   OR (ssot__FirstName__c = 'Brianna' AND ssot__LastName__c = 'Okafor')
   OR (ssot__FirstName__c = 'Carmen'  AND ssot__LastName__c = 'Diaz')
   OR (ssot__FirstName__c = 'Deepa'   AND ssot__LastName__c = 'Krishnan')
   OR (ssot__FirstName__c = 'Elena'   AND ssot__LastName__c = 'Rossi')
   OR (ssot__FirstName__c = 'Fatima'  AND ssot__LastName__c = 'Khan');

-- =============================================================
-- CI 2: Pause_Vasomotor_Burden_30d (mock)
-- Developer Name MUST be exactly: Pause_Vasomotor_Burden_30d
-- =============================================================
SELECT
  ssot__Id__c                                AS ssot__Id__c,
  47.5                                       AS burden_score_0_100,
  14                                         AS flash_count_30d
FROM ssot__Individual__dlm
WHERE (ssot__FirstName__c = 'Anika'   AND ssot__LastName__c = 'Patel')
   OR (ssot__FirstName__c = 'Brianna' AND ssot__LastName__c = 'Okafor')
   OR (ssot__FirstName__c = 'Carmen'  AND ssot__LastName__c = 'Diaz')
   OR (ssot__FirstName__c = 'Deepa'   AND ssot__LastName__c = 'Krishnan')
   OR (ssot__FirstName__c = 'Elena'   AND ssot__LastName__c = 'Rossi')
   OR (ssot__FirstName__c = 'Fatima'  AND ssot__LastName__c = 'Khan');

-- =============================================================
-- CI 3: Pause_Sleep_Disruption_7d (mock)
-- Developer Name MUST be exactly: Pause_Sleep_Disruption_7d
-- =============================================================
SELECT
  ssot__Id__c                                AS ssot__Id__c,
  0.43                                       AS disruption_index_0_1,
  3                                          AS disrupted_nights
FROM ssot__Individual__dlm
WHERE (ssot__FirstName__c = 'Anika'   AND ssot__LastName__c = 'Patel')
   OR (ssot__FirstName__c = 'Brianna' AND ssot__LastName__c = 'Okafor')
   OR (ssot__FirstName__c = 'Carmen'  AND ssot__LastName__c = 'Diaz')
   OR (ssot__FirstName__c = 'Deepa'   AND ssot__LastName__c = 'Krishnan')
   OR (ssot__FirstName__c = 'Elena'   AND ssot__LastName__c = 'Rossi')
   OR (ssot__FirstName__c = 'Fatima'  AND ssot__LastName__c = 'Khan');

-- =============================================================
-- Verified persona → ssot__Id__c mapping (2026-06-10 snapshot)
-- (Informational; the CIs above don't hardcode these IDs.)
-- =============================================================
--   anika-patel       → 003Hp00003b9bdqIAA
--   brianna-okafor    → 003Hp00003b9behIAA
--   carmen-diaz       → 003Hp00003b9bemIAA
--   deepa-krishnan    → 003Hp00003b9berIAA
--   elena-rossi       → 003Hp00003b9bewIAA
--   fatima-khan       → 003Hp00003b9bf1IAA
