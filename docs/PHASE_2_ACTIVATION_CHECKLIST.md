# Phase 2 — Data Cloud Activation Checklist

**Goal:** Flip `/api/data-360/.../grounding` from Phase 1 (intake-only
baselines) to Phase 2 (real Calculated Insights for HRV / vasomotor /
sleep) on the `trailsignup` Salesforce org.

**Audience:** A human with Salesforce Setup access and ~3–5 hours.
**Reference:** This is a checklist. The narrative + failure modes
live in [`docs/MULESOFT_PHASE_2_DATA_CLOUD.md`](./MULESOFT_PHASE_2_DATA_CLOUD.md).

**Status as of 2026-06-10:**

- Code: READY (`frontend/lib/salesforce/data-cloud.ts`, reviewed clean)
- Env: `SF_DC_TENANT_URL` slot reserved, not set
- Org: `trailsignup` returns `NOT_FOUND` on `/services/data/v66.0/ssot/queryjobs`
  → **Data Cloud tenant not provisioned**. This is the only blocker.

---

## Pre-flight (5 min) — done already

- [x] Phase 1 working: `SF_INSTANCE_URL`, `SF_CLIENT_ID`, `SF_CLIENT_SECRET`
      set in `frontend/.env.local`
- [x] Connected App exists (`pause-prototype-cloudhub` or equivalent)
      with `api`, `refresh_token`, `offline_access` scopes
- [x] CI SQL files version-controlled in `data-cloud/*.sql`
- [x] `frontend/lib/salesforce/data-cloud.ts` audited — no contract drift
- [x] Caller in `frontend/lib/salesforce/grounding.ts` guards with
      `isDataCloudConfigured()` so a missing env var degrades silently

## Step 0 — Verify org state (1 min)

Re-run the runbook's verification probe:

```bash
sf api request rest "/services/data/v66.0/ssot/queryjobs" \
  --method POST \
  --body '{"sql":"SELECT 1"}' \
  --target-org trailsignup
```

- [ ] **Expected after provisioning:** `{ "id": "...", "status": "pending" }`
- [ ] **Last observed (2026-06-10):** `NOT_FOUND` → go to Step 1

## Step 1 — Provision Data Cloud on trailsignup (10 min + wait)

- [ ] Open trailsignup org → Setup → quick-find "Data Cloud" → Get Started
- [ ] Request the Data Cloud trial add-on
- [ ] Wait for the provisioning email (can take 5–30 minutes on SDOs)
- [ ] Re-run Step 0 — should now return a job ID, not `NOT_FOUND`

If the trial add-on isn't offered on `trailsignup`, take Option B from
the runbook: stand up a fresh org via
`https://www.salesforce.com/form/signup/data-cloud-trial/` and re-do
Phase 1 (Connected App + creds) on that org. Document the alias swap
in the env file.

## Step 2 — Grant DC scopes to the Connected App (5 min)

- [ ] Setup → External Client Apps → `pause-prototype-cloudhub` → Edit Policies
- [ ] Add OAuth Scopes:
  - [ ] `cdp_query_api`   (required for `/api/v1/query`)
  - [ ] `cdp_ingest_api`  (not used today; add now to avoid a re-grant later)
- [ ] Save. Existing access tokens keep working — no re-grant needed.
      The new scopes appear on the next token refresh (≤ 2h) or
      immediately if you restart the Next.js dev server (which forces
      a fresh token via the client_credentials flow in `auth.ts`).

## Step 3 — Find the tenant URL (2 min)

- [ ] Setup → Data Cloud → Settings → **API Tenant URL**
- [ ] Copy the value — pattern: `https://<15-char-orgId>.c360a.salesforce.com`
- [ ] Smoke-test reachability:
  ```bash
  curl -I https://<your-15-char-orgId>.c360a.salesforce.com
  ```
  Expect a 200-range response (not a connection error).

## Step 4 — Create the Data Model Object (30–90 min)

- [ ] Decide DMO strategy:
  - [ ] Option A — Real: stand up JupyterHealth, Data Stream points at it
  - [ ] Option B — Mock CI path: skip the DMO, author CIs against `Contact`
        (use `data-cloud/_mock_path.sql`); proves the end-to-end pipeline
        without real wearable data
- [ ] If Option A: Data Cloud → Data Streams → New → API/File → name it
      `JupyterHealth_FHIR_Observations`, set polling interval to 1h
- [ ] Wire the FHIR `Patient.id` to the `UnifiedIndividual` primary key
      so `ssot__Id__c` resolves to the Health Cloud `Contact.Id` used by
      Phase 1

## Step 5 — Author + activate the 3 CIs (30 min)

For **each** of the three CIs:

- [ ] Data Cloud → Calculated Insights → New
- [ ] Developer Name (exact match required — referenced as constants in
      `frontend/lib/salesforce/data-cloud.ts`):
  - [ ] `Pause_HRV_RMSSD_30d`        ← paste `data-cloud/Pause_HRV_RMSSD_30d.sql`
  - [ ] `Pause_Vasomotor_Burden_30d` ← paste `data-cloud/Pause_Vasomotor_Burden_30d.sql`
  - [ ] `Pause_Sleep_Disruption_7d`  ← paste `data-cloud/Pause_Sleep_Disruption_7d.sql`
- [ ] If using the Mock CI path: paste from `data-cloud/_mock_path.sql`
      (three queries, one per CI — the Developer Names stay the same)
- [ ] Save → **Activate** → schedule refresh every 6 hours
- [ ] Verify each CI returns rows:
      `SELECT * FROM Pause_HRV_RMSSD_30d WHERE ssot__Id__c = '<contact-id>' LIMIT 5`

## Step 6 — Wire the env var (1 min)

- [ ] Append to `frontend/.env.local`:
      ```
      SF_DC_TENANT_URL=https://<your-15-char-orgId>.c360a.salesforce.com
      ```
- [ ] Restart Next.js (`pnpm dev` / `npm run dev` / Vercel preview redeploy)
- [ ] For Vercel production: add the same var via `vercel env add` or the
      project dashboard (Production + Preview envs)

## Step 7 — End-to-end smoke (5 min)

```bash
# 7a. Provenance flips from Phase 1 → Phase 2
curl -s "http://localhost:3000/api/data-360/patient/pause-demo-patient-001/grounding" \
  | jq '.grounding.groundingProvenance.federatedQuery'
# Expected: "Phase 2: SOQL (Health Cloud) + Data Cloud Calculated Insights (HRV/vasomotor/sleep)"

# 7b. Wearable insights show real source windows
curl -s "http://localhost:3000/api/data-360/patient/pause-demo-patient-001/grounding" \
  | jq '[.grounding.calculatedInsights[] | {name, value, sourceWindow}]'
# Expected: HRV/vasomotor rows have sourceWindow "30d", sleep has "7d"
# (NOT "intake-only" — that's the Phase 1 fallback)

# 7c. Source attribution credits Data Cloud
curl -s "http://localhost:3000/api/data-360/patient/pause-demo-patient-001/grounding" \
  | jq '[.grounding.calculatedInsights[] | {name, federatedFrom}]'
# Expected: each row's federatedFrom contains "dbdp-wearable-features"
```

- [ ] 7a passes
- [ ] 7b passes
- [ ] 7c passes

## Step 8 — Roadmap + UI updates (5 min)

After Step 7 is green:

- [ ] `frontend/app/proposal/data-360/page.tsx`: bump the
      "Calculated insights — wearable / EHR" row from `designed` to
      `prototype` (per runbook's "What activates automatically" section)
- [ ] `frontend/app/roadmap/page.tsx`: move the Phase 2 item from `Next`
      to `Now` (or to a "Shipped" timeline entry) — see how the MuleSoft
      iterations 1-7 update was done at `981c031` / `c70407f` for the
      same pattern
- [ ] `frontend/app/changelog/page.tsx`: add a "Phase 2 Data Cloud
      grounding activated" entry
- [ ] Commit and push

## Failure modes — quick triage

| Symptom                                     | Likely cause                  | Fix                                                                  |
|---------------------------------------------|-------------------------------|----------------------------------------------------------------------|
| Step 7a still shows Phase 1 string          | `SF_DC_TENANT_URL` unset      | Re-check `.env.local`, restart Next.js                               |
| 7b shows `sourceWindow: "intake-only"`      | DC tenant URL 404             | `curl -I` the tenant URL — wrong host or DC not provisioned          |
| 7b shows mostly nulls                       | CI scope missing              | Add `cdp_query_api` to Connected App (Step 2)                        |
| 7b shows one row null, others fine          | That CI not Activated         | Data Cloud → CIs → Activate the offending one                        |
| 7b shows all rows null                      | `ssot__Id__c` mismatch        | UnifiedIndividual primary key doesn't equal Health Cloud `Contact.Id`; update DMO mapping or change filter in `getWearableInsights` |
| Care Router rationale doesn't mention HRV   | Grounding works but agent prompt stale | Restart the Care Router runtime / clear any prompt cache             |

---

**End of checklist.** When all boxes are ticked, Phase 2 is shipped.
Update `mulesoft/` README, frontend `proposal/data-360` Prototype-vs-
Production table, and `data-cloud/README.md` status snapshot.
