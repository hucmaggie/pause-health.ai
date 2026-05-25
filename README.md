# Pause-Health.ai monorepo

This repository hosts three things:

- **`frontend/`** — Next.js marketing site, investor brief, and clickable
  prototype for [Pause-Health.ai](https://pause-health.ai). Deployed to
  Vercel. See `frontend/README.md`.
- **`pause_ingest/`** — Python wearable ingest worker. Normalizes vendor JSON
  through [omh-shim](https://github.com/jupyterhealth/omh-shim), computes
  clinical features via the
  [Digital Biomarker Discovery Pipeline](https://www.dbdp.org/code-repository)
  (FLIRT + a Kubios-validated HRV reference port), and uploads the result to
  a [JupyterHealth Exchange](https://github.com/jupyterhealth/jupyterhealth-exchange)
  instance as FHIR R5 Observations. See `pause_ingest/README.md`.
- **Legacy Northstar Shipping Cost API** (this file, below). The FastAPI
  service is still functional and was the original substrate the repo was
  created on; it remains here as a historical artifact while the
  Pause-Health platform is being built out in parallel.

## Design docs

- [`docs/jupyterhealth-integration.md`](docs/jupyterhealth-integration.md) —
  end-to-end design for the JupyterHealth + DBDP data plane, with an
  architecture diagram, wearable data types we surface, the feature
  engineering layer, a phased plan, and known gaps (e.g. `devicely` /
  Empatica E4 deferred to Phase 2 due to Python 3.13 incompatibility).

## Investor brief

The full investor surface lives under `/proposal` on the deployed frontend.
Deep-dive sections (each a routed page):

- `/proposal/customers` — Health system and payer ICPs, buying committee.
- `/proposal/insights` — Provider and patient interview synthesis.
- `/proposal/data` — Menopause data inventory and strategy.
- `/proposal/competition` — Landscape and positioning.
- `/proposal/strategy` — Digital strategy and competitive moats.
- `/proposal/technology` — Stack, AI approach, safety stance.
- `/proposal/integration` — JupyterHealth FHIR substrate.
- `/proposal/dbdp` — DBDP feature engineering layer.
- `/proposal/menopause-society` — The Menopause Society / MSCP strategy
  (referral, partnership runway, explicit ToS guardrails).
- `/proposal/provider-graph` — A defensible menopause provider graph built
  from CMS NPPES and state board data (no scraping of restricted sources).

## Local development

```bash
# Frontend
cd frontend
npm install
npm run dev                # http://localhost:3000

# Python ingest worker
cd pause_ingest
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q                  # 20 tests covering convert + features + Empatica stub
```

See each subdirectory's README for full setup and configuration details.

---

# Northstar Shipping Cost API (ZIP-based)

FastAPI service that calculates shipping costs using Knowledge Article 1 rules and distance derived from US ZIP codes.
- **Simplified API**: Only requires destination ZIP, returns total cost
- **Smart defaults**: Uses sensible defaults for package dimensions and shipping options
- **Endpoint**: `POST /quote-by-zip`

## Features

- ✅ **Minimal input**: Only destination ZIP required
- ✅ **Smart defaults**: 1kg package, ground shipping, standard dimensions
- ✅ **Flexible**: Override any parameter when needed
- ✅ **Simple response**: Returns only the total shipping cost
- ✅ **Production ready**: Deployed on Render with health checks

## Quick Start

### 1) Open in Cursor
- **File → Open Folder…** and select this project folder.
- If prompted, let Cursor create a virtual environment.

### 2) Create & activate a venv (recommended)
**macOS/Linux**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

**Windows (PowerShell)**
```powershell
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
```

### 3) Configure API Key (Optional but Recommended)
The application can use ZipCodeAPI.com for real-time ZIP code geocoding. This enables support for **any valid US ZIP code**, not just the ~90 hardcoded ones.

**Get a free API key:**
1. Sign up at https://www.zipcodeapi.com/
2. Free tier: 10 requests/hour (sufficient for development)
3. Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```
4. Edit `.env` and add your API key:
   ```
   ZIPCODEAPI_KEY=your_actual_api_key_here
   ```

**Without an API key:** The app still works! It uses a three-tier fallback system:
- First checks in-memory cache
- Falls back to hardcoded ZIP database (~90 major cities)
- Final fallback to state-based approximations

### 4) Install dependencies
```bash
pip install -r requirements.txt
```

### 5) Run the API (hot reload)
```bash
uvicorn app:app --reload --port 8000
```

- Swagger UI: http://localhost:8000/docs
- OpenAPI JSON: http://localhost:8000/openapi.json

## Frontend (Salesforce-Inspired Marketing Site)

The repo now includes a standalone Next.js frontend in `frontend/` with a Salesforce-inspired (original) homepage design.

### Frontend prerequisites
- Node.js 18.18+ (or 20+ recommended)
- npm 9+

### Install frontend dependencies
```bash
cd frontend
npm install
```

### Run frontend (hot reload)
```bash
cd frontend
npm run dev
```

- Frontend URL: http://localhost:3000

### Run backend + frontend together
Use two terminals:

**Terminal A (API)**
```bash
uvicorn app:app --reload --port 8000
```

**Terminal B (Frontend)**
```bash
cd frontend
npm run dev
```

This keeps the existing FastAPI API intact while letting you build and iterate on the marketing UI separately.

## API Usage

### Minimal Request (Recommended)
```bash
curl -X POST "http://localhost:8000/quote-by-zip" \
  -H "Content-Type: application/json" \
  -d '{"dest_zip": "30301"}'
```

**Response:**
```json
{"total_usd": 1.28}
```

### Custom Request (Optional)
```bash
curl -X POST "http://localhost:8000/quote-by-zip" \
  -H "Content-Type: application/json" \
  -d '{
    "dest_zip": "30301",
    "weight_kg": 5.0,
    "length_cm": 40,
    "width_cm": 30,
    "height_cm": 20,
    "mode": "express"
  }'
```

## Request Parameters

| Parameter | Required | Default | Description |
|-----------|----------|--------|-------------|
| `dest_zip` | ✅ Yes | - | Destination ZIP code |
| `origin_zip` | ❌ No | "90001" | Origin ZIP (defaults to LA) |
| `weight_kg` | ❌ No | 1.0 | Package weight in kg |
| `length_cm` | ❌ No | 30.0 | Package length in cm |
| `width_cm` | ❌ No | 20.0 | Package width in cm |
| `height_cm` | ❌ No | 10.0 | Package height in cm |
| `mode` | ❌ No | "ground" | Shipping mode: "ground", "air", "express" |
| `fuel_surcharge_pct` | ❌ No | 12.0 | Fuel surcharge percentage |
| `regional_surcharge_pct` | ❌ No | 3.0 | Regional surcharge percentage |
| `enterprise_rate_card` | ❌ No | false | Apply enterprise discount |

## Response Format

```json
{
  "total_usd": 1.28
}
```

## Supported ZIP Codes

### With API Key (ZipCodeAPI.com)
**Supports ANY valid US ZIP code** dynamically via real-time geocoding.

### Without API Key
Falls back to hardcoded database with ~90 major US cities, including:
- `90001` - Los Angeles, CA (default origin)
- `30301` - Atlanta, GA
- `10001` - New York, NY
- `60601` - Chicago, IL
- `73301` - Austin, TX
- `94105` - San Francisco, CA
- And ~84 more major metropolitan areas

Unknown ZIPs use state-based approximations as final fallback.

## Testing

### Run tests
```bash
pytest -q
```

### Test with requests.http
If you use the REST Client extension, open `requests.http` and click **Send Request** above a request.

## Deployment

### Deploy to Render (one-click)
1. Push this folder to GitHub
2. In Render: New → Web Service → "Build & deploy from a Git repository"
3. Select the repo; Render will detect `render.yaml`
4. **Add environment variable** (optional but recommended):
   - In Render dashboard → Environment → Add: `ZIPCODEAPI_KEY` = your API key
5. First deploy gives you an HTTPS URL (e.g., https://northstar-shipping-zip-api.onrender.com)

### Test deployed API
```bash
# Health check
curl https://your-app-name.onrender.com/health

# Shipping quote
curl -X POST "https://your-app-name.onrender.com/quote-by-zip" \
  -H "Content-Type: application/json" \
  -d '{"dest_zip": "30301"}'
```

## Development Tips

### Common Cursor tips
- Use **Run/Debug** to launch `uvicorn` with breakpoints
- Press **⌘⇧P** (macOS) / **Ctrl+Shift+P** (Windows) → *Python: Select Interpreter* → choose `.venv`
- Use **Chat (CMD+L)** in Cursor to refactor functions or add tests

### Geocoding Architecture
The app uses a **three-tier ZIP lookup strategy**:
1. **In-memory cache**: Fast lookups for recently used ZIPs
2. **ZipCodeAPI.com**: Real-time geocoding for any US ZIP (requires API key)
3. **Hardcoded ZIP_DB**: ~90 major cities as fallback
4. **State-based approximation**: Final fallback for unknown ZIPs

### Customization
- **Already integrated**: ZipCodeAPI.com for dynamic ZIP geocoding (just add API key)
- Alternative: Replace `geocode_zip_via_api()` function to use your internal geocoding service
- Plug enterprise discounts into your real rate-card service
- Adjust DIM divisor and per-mode rates to match KA1 precisely

### Production notes
- Add logging, request IDs, and validation guards
- Containerize with a `Dockerfile` and run behind a reverse proxy (e.g., Nginx, API Gateway)
- CI/CD: include unit tests and contract tests for pricing logic

## GitHub Actions: test & auto-deploy to Render

This repo includes `.github/workflows/render-deploy.yml` which:
1. Installs deps
2. Runs `pytest`
3. If tests pass, triggers a Render deploy via a **Deploy Hook URL**

**Setup once:**
- In Render, open your service → **Settings** → **Deploy Hooks** → create a hook for the `main` branch
- Copy the URL and add it to your GitHub repo as an Actions secret named **RENDER_DEPLOY_HOOK_URL**
  - GitHub → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*

On every push to `main`, tests run and (if green) a deploy is triggered automatically.