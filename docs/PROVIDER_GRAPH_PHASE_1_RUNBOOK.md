# Provider Graph Phase 1 — NPPES ingest runbook

How to take the Provider-graph from "pipeline over a synthetic fixture" to
"real CMS NPPES data behind the live contract." Phase 1 needs **no Salesforce
or Data Cloud wiring** — the provider directory is served by the Experience-API
contract (`/api/mulesoft/providers` + the MCP `find_menopause_providers` tool),
and the data behind it is a JSON file the frontend loads. This runbook is the
data-side procedure.

Companion code: `provider_ingest/` (pipeline) and
`frontend/lib/provider-directory.generated.json` (the dataset the frontend
loads). The frozen contract is `ProviderRecord` in
`frontend/lib/mulesoft-mocks.ts` / `mulesoft/pause-provider-experience-api.oas3.yaml`.

---

## What ships today (no action needed)

- `provider_ingest` streams the NPPES bulk schema, filters on the real
  menopause NUCC taxonomy codes, overlays an MSCP credential list, computes a
  `graphScore`, and writes the generated JSON.
- `queryProviderDirectory()` loads that JSON (falling back to the hand-curated
  rows only if it's empty). The committed dataset is the pipeline run over
  `provider_ingest/examples/fixtures/nppes_sample.csv` — real schema + real
  NUCC codes, synthetic rows.
- `provenance.sources` on every response reports
  `"CMS NPPES (taxonomy-filtered via provider_ingest)"` + `"MSCP credential overlay"`.

The steps below swap the synthetic fixture for the real national file.

---

## Step 0 — Prerequisites

- Python 3.12+ (the pipeline is pure standard library; no heavy deps).
- ~10 GB free disk for the NPPES dump.

```bash
cd provider_ingest
python3.13 -m venv .venv
./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -m pytest -q      # expect 25 passed
```

---

## Step 1 — Download the NPPES bulk file

CMS publishes the NPPES Data Dissemination file monthly (public domain):
<https://download.cms.gov/nppes/NPI_Files.html>

Download the **full replacement monthly file**, unzip it, and note the path to
`npidata_pfile_YYYYMMDD-YYYYMMDD.csv` (the weekly incremental files use the same
schema if you prefer a smaller download to test the pipeline).

---

## Step 2 — Assemble the MSCP credential list

NPPES does **not** carry the MSCP (Menopause Society Certified Practitioner)
credential — it's maintained by The Menopause Society, separate from the NPI
registry. The overlay is a JSON list of NPIs:

```json
{ "npis": ["1730155570", "1457390021"] }
```

Sources, in order of preference:

1. A licensed/partnered feed from The Menopause Society (see
   `/proposal/menopause-society` for the partnership path).
2. The public "Find a Menopause Practitioner" directory — **note their terms
   of use prohibit scraping/republishing**; only use under an agreement.
3. The synthetic demo list at
   `provider_ingest/examples/fixtures/mscp_npis.json` (what ships today).

The join in `mscp.py` is identical regardless of provenance. Omit `--mscp`
entirely to build with no certification overlay.

**Plus: self-reported credentials in NPPES (no overlay needed).** Independent of
the overlay, the pipeline also marks a provider `menopauseCertified` when they
self-report **MSCP** (or its former name **NCMP**) in the NPPES "Provider
Credential Text" field (`nppes.py` → `_has_menopause_credential`). This is an
honest signal from the public registry — not a fabricated certification — so a
national run yields real certified coverage for the providers who list it, even
before a licensed feed lands. Coverage is necessarily **partial** (many
certified practitioners don't record it in NPPES), and the tokens are specific
enough that false positives are rare. The licensed Menopause Society feed
remains the authoritative source; the two are unioned.

---

## Step 3 — Run the pipeline

```bash
cd provider_ingest
pause-provider-build \
  --nppes /path/to/npidata_pfile_YYYYMMDD-YYYYMMDD.csv \
  --nppes examples/fixtures/nppes_sample.csv \
  --mscp  examples/fixtures/mscp_npis.json \
  --out   ../frontend/lib/provider-directory.generated.json \
  --limit 5000
```

- **Pass `--nppes` twice** (national file **and** the bundled demo fixture). Inputs
  are merged and de-duplicated by NPI, so the six demo personas keep resolving to
  their curated local certified providers (green demo) while the national file
  adds real coverage for every other ZIP. Real NPPES NPIs never collide with the
  synthetic demo NPIs.
- The reader streams row-by-row (constant memory), so the full file is fine.
- Output is sorted by `graphScore` descending; `--limit N` keeps the top-N.
  Keep the committed/bundled dataset modest (a few thousand rows at most) so the
  frontend bundle stays lean — the directory is filtered server-side per query,
  not paginated client-side.
- Expect roughly tens of thousands of survivors nationally before `--limit`
  (the menopause taxonomy filter cuts the ~8.5M-row file by ~100×). `menopause=true`
  queries then return real providers who are on the MSCP overlay **or** self-report
  MSCP/NCMP in NPPES — no contract or agent change required.

It prints e.g. `Wrote 5000 providers (1234 MSCP-certified) from … → …`.

---

## Step 4 — Verify behind the contract

Type-check and run the directory's tests, then exercise the endpoint:

```bash
cd frontend
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run lib/mulesoft/providers.test.ts

# Local dev server, then:
curl -s "http://localhost:3000/api/mulesoft/providers?zip=92614&menopause=true&limit=5" | jq
```

Checklist:

- [ ] `total` / `returned` reflect the new dataset (not 5).
- [ ] `provenance.sources` includes `"CMS NPPES (taxonomy-filtered via provider_ingest)"`.
- [ ] `providers` are sorted by `graphScore` descending.
- [ ] `menopause=true` returns only `menopauseCertified` rows.
- [ ] The `zip` prefix filter narrows results as expected.

---

## Step 5 (optional) — Serve via the live MuleSoft runtime

To answer from a deployed Mule app instead of the in-process loader, point the
prefer-real client at it:

```bash
# .env.local / Vercel env
MULESOFT_PROVIDERS_BASE_URL=https://<your-mule-host>
```

`getProvidersPreferReal()` then calls `GET {base}/providers?...` and degrades to
the generated-JSON directory on any failure (non-2xx, network, bad shape). The
live Mule DataWeave twin in `mulesoft/.../health-flow.xml` must be updated to
serve the NPPES-derived rows to keep the two paths shape-identical.

---

## Failure triage

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `0 providers` written | Wrong file (header file, not data file), or all rows filtered | Confirm it's `npidata_pfile_*.csv`; check a known OB/GYN NPI survives `normalize_row` |
| All `menopauseCertified: false` | MSCP list not passed or NPIs don't intersect | Pass `--mscp`; confirm the list holds 10-digit NPIs as strings |
| Frontend still shows 5 rows | Generated JSON empty/missing → fell back | Re-run the build; confirm `frontend/lib/provider-directory.generated.json` is non-empty |
| `tsc` error on the JSON import | Shape drift from `ProviderRecord` | The dataclass in `records.py` must match the TS type field-for-field |
| Huge frontend bundle | No `--limit` on a national run | Re-run with `--limit` (top-N by graphScore) |
| Provider missing expected specialty | Taxonomy not in the curated set | Add the NUCC code to `MENOPAUSE_TAXONOMIES` in `taxonomy.py` |

---

## What Phase 1 deliberately does **not** do

- **State license verification / disciplinary gating** — Phase 2.
- **Clinic-site service-mention detection** — Phase 2.
- **Distance ranking + insurance match** — Phase 2 (today: ZIP-prefix filter +
  graphScore only).
- **Closed-loop outcomes scoring** — Phase 3, after the first ~1,000 referrals.
- **Real MSCP feed** — gated on the Menopause Society partnership; synthetic
  overlay today.
