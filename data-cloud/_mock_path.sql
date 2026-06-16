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
--   - data-cloud.ts filters on the unified_id__c dimension (aliased
--     below from the Individual's ssot__Id__c) and reads the __c-suffixed
--     measure columns — both the mock and the real CI files emit that
--     identical output contract, so the code path is unchanged.
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
--
-- DC CI validator rules (learned in session 3 — these MUST hold or the
-- SQL Authoring UI rejects the query; kept in lockstep with the real CI
-- files in this folder and with frontend/lib/salesforce/data-cloud.ts):
--   - At least one measure must use an aggregation function. The mock
--     values are constants, so MAX(<constant>) is a semantic no-op that
--     satisfies the validator ("A Calculated Insight must contain at
--     least one measure with an aggregation function").
--   - Output columns MUST end in __c.
--   - The GROUP BY dimension alias MUST be unified_id__c. The natural
--     alias ssot__Id__c is rejected (the inner __ trips the validator),
--     so we alias the Individual's ssot__Id__c to unified_id__c — which
--     is also exactly what getWearableInsights() filters on:
--     [unified_id__c=<contact-id>].
--   - Column references must be fully qualified (table.column).

-- =============================================================
-- CI 1: Pause_HRV_RMSSD_30d (mock)
-- Developer Name MUST be exactly: Pause_HRV_RMSSD_30d
-- =============================================================
SELECT
  ssot__Individual__dlm.ssot__Id__c          AS unified_id__c,
  MAX(38.2)                                  AS hrv_rmssd_ms__c,
  MAX(-0.3)                                  AS z_score__c,
  MAX(30)                                    AS window_days__c
FROM ssot__Individual__dlm
WHERE (ssot__Individual__dlm.ssot__FirstName__c = 'Anika'   AND ssot__Individual__dlm.ssot__LastName__c = 'Patel')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Brianna' AND ssot__Individual__dlm.ssot__LastName__c = 'Okafor')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Carmen'  AND ssot__Individual__dlm.ssot__LastName__c = 'Diaz')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Deepa'   AND ssot__Individual__dlm.ssot__LastName__c = 'Krishnan')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Elena'   AND ssot__Individual__dlm.ssot__LastName__c = 'Rossi')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Fatima'  AND ssot__Individual__dlm.ssot__LastName__c = 'Khan')
GROUP BY ssot__Individual__dlm.ssot__Id__c;

-- =============================================================
-- CI 2: Pause_Vasomotor_Burden_30d (mock)
-- Developer Name MUST be exactly: Pause_Vasomotor_Burden_30d
-- =============================================================
SELECT
  ssot__Individual__dlm.ssot__Id__c          AS unified_id__c,
  MAX(47.5)                                  AS burden_score_0_100__c,
  MAX(14)                                    AS flash_count_30d__c
FROM ssot__Individual__dlm
WHERE (ssot__Individual__dlm.ssot__FirstName__c = 'Anika'   AND ssot__Individual__dlm.ssot__LastName__c = 'Patel')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Brianna' AND ssot__Individual__dlm.ssot__LastName__c = 'Okafor')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Carmen'  AND ssot__Individual__dlm.ssot__LastName__c = 'Diaz')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Deepa'   AND ssot__Individual__dlm.ssot__LastName__c = 'Krishnan')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Elena'   AND ssot__Individual__dlm.ssot__LastName__c = 'Rossi')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Fatima'  AND ssot__Individual__dlm.ssot__LastName__c = 'Khan')
GROUP BY ssot__Individual__dlm.ssot__Id__c;

-- =============================================================
-- CI 3: Pause_Sleep_Disruption_7d (mock)
-- Developer Name MUST be exactly: Pause_Sleep_Disruption_7d
-- =============================================================
SELECT
  ssot__Individual__dlm.ssot__Id__c          AS unified_id__c,
  MAX(0.43)                                  AS disruption_index_0_1__c,
  MAX(3)                                     AS disrupted_nights__c
FROM ssot__Individual__dlm
WHERE (ssot__Individual__dlm.ssot__FirstName__c = 'Anika'   AND ssot__Individual__dlm.ssot__LastName__c = 'Patel')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Brianna' AND ssot__Individual__dlm.ssot__LastName__c = 'Okafor')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Carmen'  AND ssot__Individual__dlm.ssot__LastName__c = 'Diaz')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Deepa'   AND ssot__Individual__dlm.ssot__LastName__c = 'Krishnan')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Elena'   AND ssot__Individual__dlm.ssot__LastName__c = 'Rossi')
   OR (ssot__Individual__dlm.ssot__FirstName__c = 'Fatima'  AND ssot__Individual__dlm.ssot__LastName__c = 'Khan')
GROUP BY ssot__Individual__dlm.ssot__Id__c;

-- =============================================================
-- Verified persona → unified_id__c mapping (2026-06-10 snapshot)
-- The dimension is the Individual's ssot__Id__c, surfaced to the
-- Insight API as unified_id__c. (Informational; the CIs above don't
-- hardcode these IDs.)
-- =============================================================
--   anika-patel       → 003Hp00003b9bdqIAA
--   brianna-okafor    → 003Hp00003b9behIAA
--   carmen-diaz       → 003Hp00003b9bemIAA
--   deepa-krishnan    → 003Hp00003b9berIAA
--   elena-rossi       → 003Hp00003b9bewIAA
--   fatima-khan       → 003Hp00003b9bf1IAA
