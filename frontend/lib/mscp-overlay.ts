/**
 * The curated MSCP (Menopause Society Certified Practitioner) overlay NPIs.
 *
 * NPPES does not carry the MSCP credential, so `menopauseCertified` comes from
 * two honest sources unioned in the ingest pipeline
 * (`provider_ingest/provider_ingest/nppes.py`):
 *   1. this curated overlay — NPIs known to hold MSCP, joined by NPI, and
 *   2. a self-reported MSCP/NCMP token in the provider's NPPES credential text.
 *
 * The pipeline appends an "MSCP" badge to overlay-certified providers, which
 * erases the overlay-vs-self-report distinction in the credentials array. So
 * the frontend reconstructs `credentialSource` from overlay membership: a
 * certified provider whose NPI is in this set is curated-overlay; any other
 * certified provider earned the flag by self-reporting in NPPES. (Once a
 * future refresh writes `credentialSource` into the record directly, that
 * value is preferred — see `deriveCredentialSource` in mulesoft-mocks.ts.)
 *
 * This set is the single source of truth on the frontend and is pinned in
 * lockstep with `provider_ingest/examples/fixtures/mscp_npis.json` by
 * `mscp-overlay.test.ts`, so the two cannot drift.
 */
export const MSCP_OVERLAY_NPIS: ReadonlySet<string> = new Set([
  "1730155570",
  "1457390021",
  "1306188891",
  "1922450088",
  "1134567890",
  "1356789012",
  "1467890123"
]);
