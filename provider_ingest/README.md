# provider_ingest

CMS NPPES → Pause menopause provider directory. The Provider-graph Phase 1
ingest: stream the National Plan and Provider Enumeration System (NPPES) bulk
file, filter to menopause-relevant NUCC taxonomies, overlay the MSCP credential
list, compute a `graphScore`, and emit the `ProviderRecord` dataset the
frontend serves behind the frozen `/api/mulesoft/providers` Experience-API
contract.

The whole point is to put **real NPPES-derived rows behind an unchanged
contract**. The `ProviderRecord` dataclass here is field-for-field identical to
the TypeScript type in `frontend/lib/mulesoft-mocks.ts` and the OpenAPI
`Provider` schema in `mulesoft/pause-provider-experience-api.oas3.yaml`.

## What's real vs. synthetic

| Piece | State |
| --- | --- |
| NPPES streaming + taxonomy filter + normalization | **Real** — runs against the real npidata_pfile schema |
| NUCC taxonomy code set + relevance weights | **Real** — actual NUCC codes (`taxonomy.py`) |
| `graphScore` composition | **Real** — deterministic, explainable (`score.py`) |
| Committed demo dataset | Pipeline over a **synthetic** NPPES-format fixture (real schema + codes) |
| MSCP credential list | **Synthetic** — production swaps in The Menopause Society directory / a licensed feed |
| `acceptingNewPatients` / `telehealth` | **Derived** from NPI — NPPES has no such field |

## Layout

```
provider_ingest/
  taxonomy.py   curated NUCC menopause taxonomy codes + relevance weights
  records.py    ProviderRecord dataclass (mirrors the TS/OAS contract)
  mscp.py       MSCP (Menopause Society Certified Practitioner) overlay
  score.py      graphScore composition
  nppes.py      streaming NPPES reader / filter / normalizer
  build.py      pipeline orchestration + JSON writer (+ CLI)
examples/
  regen_demo_directory.py   regenerate the committed demo dataset from the fixture
  fixtures/                 NPPES-format sample CSV + synthetic MSCP NPI list
tests/                      taxonomy / score / nppes / build
```

## Quickstart

```bash
python3.13 -m venv .venv
./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -m pytest -q          # 25 tests
./.venv/bin/ruff check .

# Regenerate the committed demo dataset (fixture → frontend JSON):
PYTHONPATH=. ./.venv/bin/python examples/regen_demo_directory.py
```

## Running against the real NPPES file

Download the monthly NPPES Data Dissemination file from CMS
(<https://download.cms.gov/nppes/NPI_Files.html>), unzip the
`npidata_pfile_*.csv`, then:

```bash
pause-provider-build \
  --nppes /path/to/npidata_pfile_YYYYMMDD-YYYYMMDD.csv \
  --mscp  /path/to/mscp_npis.json \
  --out   ../frontend/lib/provider-directory.generated.json \
  --limit 5000
```

The reader streams the file row-by-row (constant memory), so the ~10 GB dump is
fine. Output is sorted by `graphScore` descending; `--limit` caps to the top-N.
No contract change is needed — the frontend loads the same JSON path.

Full org-side context and verification steps:
`docs/PROVIDER_GRAPH_PHASE_1_RUNBOOK.md`.
