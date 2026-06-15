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
  `graphScore`, **stamps `latitude`/`longitude` from the bundled Census 2020
  ZCTA gazetteer**, and writes the generated JSON.
- `queryProviderDirectory()` loads that JSON (falling back to the hand-curated
  rows only if it's empty).
- **The committed dataset is a real national run** of the CMS June 2026
  `npidata_pfile` (8.5M rows) merged with the demo fixture: **2,014 providers**,
  of which **14 are menopause-certified** — the 7 demo personas plus **7 real
  practitioners who self-report MSCP/NCMP in NPPES** (CA, IA, ID, MN, NC×2, NJ).
  The remaining 2,000 are real menopause-relevant providers across 55 states /
  534 ZIP-3 prefixes for general (`menopause=false`) directory breadth.
- `provenance.sources` on every response reports
  `"CMS NPPES (taxonomy-filtered via provider_ingest)"` +
  `"Self-reported MSCP/NCMP credentials + curated overlay"`.

> **Honest coverage note.** Self-reported MSCP/NCMP is *rare* in NPPES (≈7
> nationally), so the agent's `menopause=true` queries still have sparse real
> certified coverage outside the demo metros. This is a data-availability ceiling,
> not a pipeline limit — the licensed Menopause Society feed (Step 2) is the path
> to dense certified coverage. To keep the agent useful everywhere in the meantime,
> the Experience API does **graceful fallback** (`?fallback=true`, default-on; see
> the `matchType` field): no local certified provider → nearby menopause-relevant
> (non-certified) clinicians → national telehealth-capable certified specialists,
> each tier labeled so the agent presents it honestly.

> **Distance ranking.** The Experience API also ranks providers by Haversine
> distance from the patient's ZIP centroid (Census 2020 ZCTA gazetteer, public
> domain). When the patient ZIP resolves to a centroid AND at least one in-tier
> provider has its own centroid, every returned row carries a `distanceMiles`
> field (rounded to 0.1 mi) and rows sort distance-asc / `graphScore`-desc;
> otherwise the directory keeps the previous score-only ranking. The
> `sort: "distance" | "score"` field on the response reports which ranking
> applied. The matchType tier ladder is unchanged — distance is a within-tier
> sort, so certified-local still wins over relevant-local even when the latter
> is geographically closer. Pass `?distance=false` to force the score-only
> ordering. The steps below reproduce or refresh this run.

---

## Step 0 — Prerequisites

- Python 3.12+ (the pipeline is pure standard library; no heavy deps).
- ~10 GB free disk for the NPPES dump.

```bash
cd provider_ingest
python3.13 -m venv .venv
./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -m pytest -q      # expect 33 passed
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

You don't need to unzip the 11.5 GB CSV — stream it straight out of the
dissemination zip through a FIFO:

```bash
cd provider_ingest
FIFO=$(mktemp -u); mkfifo "$FIFO"
unzip -p ~/Downloads/NPPES_Data_Dissemination_*.zip 'npidata_pfile_*[0-9].csv' > "$FIFO" &
pause-provider-build \
  --nppes "$FIFO" \
  --nppes examples/fixtures/nppes_sample.csv \
  --mscp  examples/fixtures/mscp_npis.json \
  --out   ../frontend/lib/provider-directory.generated.json \
  --keep-all-certified \
  --limit 2000
rm -f "$FIFO"
```

(If you've already extracted the CSV, just pass its path to the first `--nppes`.)

- **Pass `--nppes` twice — national file FIRST, demo fixture LAST.** Inputs are
  merged and de-duplicated by NPI; on collision the **later-listed input wins**, so
  the demo fixture (listed last) always wins and the six personas keep resolving to
  their curated local certified providers (green demo), even if a persona's
  real-format NPI also exists nationally.
- **`--keep-all-certified` is the important flag.** The agent queries
  `menopause=true`, so a plain `--limit` (top-N by `graphScore`) could crowd
  certified providers out behind higher-scoring non-certified ones. With this flag
  every certified provider is kept and `--limit` caps only the non-certified
  breadth. The committed run is `--limit 2000` → 2,014 rows, **654 KB**.
- The reader streams row-by-row (constant memory) and parses only the ~40 columns
  it needs, so the full 8.5M-row file runs in **~1m45s** (not the ~30 min a naive
  `DictReader` over all ~330 columns would take).
- Output is sorted by `graphScore` descending. Keep the non-certified `--limit`
  modest so the frontend bundle stays lean — the directory is filtered
  server-side per query, not paginated client-side.

It prints e.g. `Wrote 2014 providers (14 MSCP-certified) from … → …`. The
June 2026 run yielded exactly that: 14 certified (7 demo + 7 real self-reported)
and 2,000 real non-certified rows across 55 states.

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
- **Insurance match** — Phase 2 (distance ranking landed; insurance is the next
  filter on top of it).
- **Closed-loop outcomes scoring** — Phase 3, after the first ~1,000 referrals.
- **Real MSCP feed** — gated on the Menopause Society partnership; synthetic
  overlay today.

---

## Refreshing the bundled ZIP centroids (rare)

The Census ZCTA boundaries are updated on a multi-year cadence; we don't expect
to redo this often. When a new gazetteer drops:

```bash
curl -sSL -o /tmp/zcta.zip \
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip"
unzip -d /tmp /tmp/zcta.zip
pause-provider-centroids --gazetteer /tmp/2020_Gaz_zcta_national.txt
cp provider_ingest/provider_ingest/data/zip_centroids.json \
   frontend/lib/zip-centroids.generated.json
```

Then re-run Step 3 (the directory build) so the lat/lng on every provider
reflects the new centroid table. Both files are checked in — the regenerator is
a one-liner only when the source data actually changes.
