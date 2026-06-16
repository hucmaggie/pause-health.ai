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
  `npidata_pfile` (9.6M rows) merged with the demo fixture: **2,015 providers**,
  of which **15 are menopause-certified** — the 7 demo personas plus **8 real
  practitioners who self-report MSCP/NCMP in NPPES**. (One additional certified
  practitioner — a NP — Gerontology — was surfaced when the curated taxonomy
  set was broadened in Phase 2; she had been filtered out before despite
  carrying MSCP because her primary NUCC code wasn't in the curated set.)
  The remaining 2,000 are real menopause-relevant providers spread across
  **930 ZIP-3 prefixes** (all 50 states + DC) for general (`menopause=false`)
  directory breadth. That spread comes from the **`--coverage`** selection
  (default-on in the refresh script): the non-certified `--limit` budget is
  round-robined across ZIP-3 prefixes — one provider per prefix before any prefix
  gets a second — instead of taking the global top-N by `graphScore`. Same
  2,000-row budget, but distinct-prefix coverage nearly doubled (532 → 930), so
  far more ZIPs get a local result for browsing / the relevant-local fallback.
  Certified rows are always kept regardless (`--keep-all-certified`), so the
  agent's `menopause=true` coverage is unchanged. Set `COVERAGE=0` to fall back
  to the old global top-N. (930 is the honest US count: `normalize_row` drops
  providers without a usable 5-digit US ZIP — foreign practice addresses,
  APO/FPO, truncated/garbage postals — which otherwise inflated the raw prefix
  count to 1,055 with non-placeable rows.)
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
> ordering.

> **Service-line signals.** Beyond the binary `menopauseCertified` flag, the
> pipeline detects service-line signals from the public NPPES record (see
> `provider_ingest/signals.py`) and stamps them onto every provider as
> `serviceSignals: string[]`. Tokens include `facog` (Fellow ACOG —
> board-certified OB/GYN), `faafp` (board-certified family physician), `face`
> (board-certified endocrinologist), `whnp` (Women's Health NP),
> `cnm` (Certified Nurse-Midwife), and `multi-taxonomy` (provider lists ≥2
> menopause-relevant NUCC codes). Each signal contributes a small +2%
> graphScore bump capped at +5% total — bounded so a non-certified provider
> with all signals still falls behind a certified provider at the same
> baseline. In the June 2026 run, **435 of 2,014 (22%) providers carry at
> least one signal** (primarily `multi-taxonomy`, with WHNP/CNM/FACOG/FAAFP
> rounding it out), so the relevant-local tier now sub-ranks honestly: a
> board-certified OB/GYN with FACOG outranks a generalist with the same
> taxonomy. The agent (MCP `find_menopause_providers` tool) is told to render
> the strongest signal in plain English (e.g. "board-certified OB/GYN" for
> `facog`) when matchType=relevant-local.

> **Sanction filtering.** Every directory candidate is checked against three
> public-domain disciplinary feeds (see `provider_ingest/sanctions.py`):
>
> - **CA — Medi-Cal Suspended & Ineligible List** (CHHS, NPI-keyed): a
>   free CSV refreshed monthly at data.chhs.ca.gov. NPIs that appear are
>   dropped from the directory.
> - **NY — Professional Medical Conduct Board Actions** (data.ny.gov
>   ebmi-8ctw, 17,950+ rows since 1990, license-number-keyed): the dataset
>   doesn't carry NPIs, so the build cross-walks `(NY, license_num)`
>   against each NPPES candidate's own `Provider License Number_<i>`
>   columns and drops the matches.
> - **TX — Texas Medical Board All-Licenses** (data.texas.gov tm3v-pfq9,
>   ~507K rows, license-number-keyed): the full TX licensee registry with
>   `Disciplinary Status` and `License Status` columns. We use an
>   *allowlist* of active-sanction values (e.g. SUSPENDED BY BOARD, REVOKED,
>   UNDER BOARD ORDER, AUTOMATIC LICENSURE CANCELLED) — `!= NONE` would
>   drop providers whose orders have been CLEARED or COMPLAINT DISMISSED,
>   so we only filter on the explicitly-active dispositions. Cross-walk
>   mechanics identical to NY.
>
> All three filters run during the same single NPPES pass — no second walk
> over the 9.6M-row file. Survivors carry `licenseStatus: "active"`.
> Per-source counts ride on the sidecar metadata
> (`provenance.dataset.sanctionedFilteredBySource`). The committed June
> 2026 run dropped **588** via CA + **849** via NY + **283** via TX (1,720
> total) before sort/limit, verified end-to-end. Refresh: download
> `suspended-ineligible-list-*.csv` (CHHS), `ny_opmc-*.csv` (data.ny.gov),
> and `tx_tmb_all_licenses-*.csv` (data.texas.gov) into the same directory
> as the NPPES zip — the harness auto-detects the latest of each. New
> states land additively behind the same overlay class.

### State data landscape (why CA / NY / TX, why not the others)

We surveyed disciplinary-data publication for 11+ states; **structured public
access is rarer than the demand suggests**. Skip-list and the reason each is
out:

- **FL** — Florida Department of Health's Practitioner Profile bulk file
  (`data-download.mqa.flhealthsource.gov`) is gated behind Azure AD B2C
  auth; the legacy public URL `mqadatadownload.azurewebsites.net` is
  NXDOMAIN. The Practitioner Profile Search lookup at
  `mqa-internet.doh.state.fl.us` is per-license HTML only. No
  Socrata/CKAN mirror.
- **NJ** — NJ DCA disciplinary actions are PDFs (one per action) on the
  Consumer Affairs page; no structured feed.
- **IL, MA, WA, OH, MI, VA** — federated Socrata search returned no
  practitioner-disciplinary datasets; state-board pages are HTML-only or
  PDF-only.
- **OR** — Oregon Medical Board has a Socrata feed, but it's
  *aggregated counts by license type and status* (`ifun-evx5`), not
  per-licensee data.

Unblockers (when a partner brings them):
- A licensed feed (Verisys, ProviderTrust, etc.) covering all 50 states.
- Paid Azure AD B2C account at FL DOH for the FL bulk file.
- A scraper for the NJ DCA + IL IDFPR HTML pages (we don't ship one
  today — too brittle and pulls per-action context that's a poor fit
  for `(state, license_num)` overlays).

CA + NY + TX is large by license count (CA ~140K licensed physicians, NY
~110K, TX ~70K — together about half of US physicians).

> **Insurance acceptance — synthetic, real-shaped.** Every provider also
> carries `insuranceAccepted: string[]` (canonical tokens: medicare,
> medicaid, aetna, bcbs, uhc, cigna, humana, kaiser). There is no public,
> free, structured payer/in-network feed; a real implementation needs a
> paid data partnership (Ribbon Health, Turquoise) or per-payer contracts.
> Today the field is **derived deterministically from a SHA-256 hash of
> the NPI** in `provider_ingest/insurance.py` — calibrated so the
> population distribution roughly matches real participation rates
> (Medicare ~85%, Kaiser ~20%; ~3.8 plans per provider on average). The
> shape is real (the API contract, the `?insurance=` filter UX, the
> `Care Router` patientInsurance plumbing, the agent framing) and a real
> feed can drop in later without any downstream change. Every Experience
> API response calls this out under `provenance.sources` so consumers can
> see the synthetic provenance. The steps below reproduce or refresh this
> run.

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

The committed harness handles the streaming + FIFO + invocation in one
command. From the repo root:

```bash
./provider_ingest/scripts/refresh_national.sh
# Or to see what it would do without invoking the build:
./provider_ingest/scripts/refresh_national.sh --dry-run
```

It auto-discovers the latest `NPPES_Data_Dissemination_*.zip` under
`~/Documents/Personal/Pause-Health.ai/`, picks the `npidata_pfile_*.csv`
member, streams it straight out of the zip through a FIFO (no extraction),
and writes both the generated array (`frontend/lib/provider-directory.generated.json`)
and the sidecar metadata (`frontend/lib/provider-directory.generated.meta.json`)
that records `generatedAt`, `sourceDate` (the NPPES zip's mtime — what the
directory actually reflects), input paths, and per-build counts. Override
defaults via `NPPES_ZIP=/path/to/zip`, `NPPES_OUT=/path/to/out.json`, or
`NPPES_LIMIT=N`.

If you'd rather invoke the underlying build directly (e.g. against an
already-extracted CSV):

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
  --coverage \
  --limit 2000 \
  --source-date 2026-06-15T00:00:00+00:00
rm -f "$FIFO"
```

(`pause-provider-build` always writes a `<out>.meta.json` sidecar; pass
`--meta /custom/path.json` to override.) If you've already extracted the
CSV, just pass its path to the first `--nppes` and the source-date defaults
to the file's mtime.

- **Pass `--nppes` twice — national file FIRST, demo fixture LAST.** Inputs are
  merged and de-duplicated by NPI; on collision the **later-listed input wins**, so
  the demo fixture (listed last) always wins and the six personas keep resolving to
  their curated local certified providers (green demo), even if a persona's
  real-format NPI also exists nationally.
- **`--keep-all-certified` is the important flag.** The agent queries
  `menopause=true`, so a plain `--limit` (top-N by `graphScore`) could crowd
  certified providers out behind higher-scoring non-certified ones. With this flag
  every certified provider is kept and `--limit` caps only the non-certified
  breadth. The committed run is `--limit 2000` → 2,015 rows, **~1.1 MB**
  (imported server-side by the API route, not shipped to the browser).
- **`--coverage` spreads the non-certified budget geographically.** Without it,
  the 2,000 non-certified slots go to the global top-N by `graphScore`, which
  piles into a handful of dense metros (532 ZIP-3 prefixes). With it, the budget
  is round-robined across ZIP-3 buckets — one provider per prefix before any
  prefix gets a second — so the same 2,000 rows cover **930 prefixes** (all 50
  states + DC). The refresh script passes it by default (`COVERAGE=0` to opt
  out). It only touches non-certified selection; certified rows are always kept.
- **US-ZIP gate.** `normalize_row` keeps only providers with a usable 5-digit US
  ZIP. NPPES carries foreign practice addresses (Canadian/UK postals), APO/FPO
  military codes, and truncated/garbage postals that can never be local to a US
  patient ZIP; dropping them keeps the directory placeable and the ZIP-3 metric
  honest (without the gate the June 2026 run reported 1,055 "prefixes", 125 of
  them foreign/garbage; 930 is the real US count).
- The reader streams row-by-row (constant memory) and parses only the ~40 columns
  it needs, so the full 9.6M-row file runs in **~1m50s** (not the ~30 min a naive
  `DictReader` over all ~330 columns would take).
- Output is sorted by `graphScore` descending. Keep the non-certified `--limit`
  modest so the frontend bundle stays lean — the directory is filtered
  server-side per query, not paginated client-side.

It prints e.g. `Wrote 2015 providers (15 MSCP-certified) from … → …`. The
June 2026 run yielded exactly that: 15 certified (7 demo + 8 real self-reported)
and 2,000 real non-certified rows spread (via `--coverage`) across 930 ZIP-3
prefixes (all 50 states + DC).

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

- **State license verification — broader coverage** — Phase 2 (CA Medi-Cal
  S&I + NY OPMC + TX TMB filters landed; FL/NJ/IL/MA/WA/OH/MI/VA/OR all
  surveyed but lack structured public bulk access — see "State data
  landscape" above; new states land additively behind the same overlay
  class as they publish).
- **Clinic-site service-mention detection** — Phase 2 (NPPES-resident
  credential + multi-taxonomy signals landed; clinic-site scraping is the
  next layer).
- **Real insurance / in-network match** — synthetic shape landed (filter UX,
  contract, agent framing); ground-truth coverage needs a paid data
  partnership.
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
