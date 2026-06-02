# Pause-Health.ai monorepo

This repository hosts five things:

- **`frontend/`** — Next.js marketing site, investor brief, and clickable
  prototype for [Pause-Health.ai](https://pause-health.ai). Deployed to
  Vercel. Also serves the mocked MuleSoft Experience APIs under
  `/api/mulesoft/*` and the MCP descriptor at `/.well-known/mcp.json`. See
  `frontend/README.md`.
- **`pause_ingest/`** — Python wearable ingest worker. Normalizes vendor JSON
  through [omh-shim](https://github.com/jupyterhealth/omh-shim), computes
  clinical features via the
  [Digital Biomarker Discovery Pipeline](https://www.dbdp.org/code-repository)
  (FLIRT + a Kubios-validated HRV reference port), and uploads the result to
  a [JupyterHealth Exchange](https://github.com/jupyterhealth/jupyterhealth-exchange)
  instance as FHIR R5 Observations. See `pause_ingest/README.md`.
- **`mulesoft/`** — Reference MuleSoft Anypoint artifacts (Mule 4 Process
  API flow + DataWeave 2.0 transform) showing the three-tier API-Led
  Connectivity pattern Pause uses to integrate JupyterHealth, DBDP, and
  consumer wearables in a customer's Anypoint Platform. See
  `mulesoft/README.md`. Live mocked Experience APIs are served by the
  Next.js frontend at `/api/mulesoft/health`,
  `/api/mulesoft/patient/{id}/timeline`,
  `/api/mulesoft/patient/{id}/intake`, and `/api/mulesoft/providers`.
- **`mcp/`** — [Model Context Protocol](https://modelcontextprotocol.io/)
  server (`@pause-health/mcp`) that exposes the MuleSoft Experience APIs as
  four tools (`get_patient_timeline`, `get_patient_intake`,
  `find_menopause_providers`, `experience_api_health`) for Claude Desktop,
  Cursor, the Salesforce Agentforce Service Agent, and any MCP-compliant
  client. Today fronts the mocks; in production fronts a customer's
  Anypoint Experience tier via `PAUSE_MCP_BASE_URL`. See `mcp/README.md`.
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
- [`docs/mulesoft-integration.md`](docs/mulesoft-integration.md) —
  three-tier MuleSoft architecture (System / Process / Experience APIs),
  named flows, DataWeave transforms, deployment options (CloudHub 2.0 vs
  Runtime Fabric), phased plan, and reference artifact catalog.

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
- `/proposal/agentforce` — Patient intake on Salesforce Agentforce Service
  Agent, with graceful Pause-branded fallback when no org is configured.
- `/proposal/mulesoft` — Integration plane on MuleSoft Anypoint, with a
  live mocked Experience API at `/api/mulesoft/health`.
- `/proposal/mcp` — Pause as a tool surface for AI agents. MCP server
  registration snippets for Claude Desktop, Cursor, and Agentforce.
- `/proposal/agent-fabric` — Multi-agent control plane. Four agents
  (Agentforce intake, Anthropic Claude Care Router, Pause MCP server,
  MuleSoft Process API) wired through Google A2A + MCP, orchestrated
  and governed by a MuleSoft Agent Fabric mock. Live console at
  `/demo/agent-fabric`.
- `/proposal/data-360` — Salesforce Data 360 grounding layer. Phase 1
  is LIVE: when `SF_INSTANCE_URL` / `SF_CLIENT_ID` / `SF_CLIENT_SECRET`
  are configured, the Care Router grounds on real Salesforce Health
  Cloud objects (Contact + CareProgramEnrollee + CarePlan + Case) from
  a connected dev org via OAuth Client Credentials Flow. The Agent
  Fabric console shows a "LIVE" badge on every span served by the org.
  When env vars are unset, the deterministic mock takes over so
  previews/CI run with zero credentials. Phase 2 (Data Cloud unified
  profile + wearable / EHR federation) is documented but not wired.

## Local development

```bash
# Frontend (and the mocked MuleSoft Experience APIs + MCP descriptor)
cd frontend
npm install
npm run dev                # http://localhost:3000

# Python ingest worker
cd pause_ingest
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q                  # 20 tests covering convert + features + Empatica stub

# MCP server (wraps the mocked Experience APIs)
cd mcp
npm install                # also runs `npm run build`
PAUSE_MCP_BASE_URL=http://localhost:3000 node scripts/smoke.mjs
# Then register in Claude Desktop / Cursor / Agentforce -- see mcp/README.md.
```

## Optional: Wire the prototype to a real Salesforce org

Without any Salesforce credentials the prototype runs end-to-end against
deterministic mocks. To switch the Care Router's grounding onto a real
Salesforce Health Cloud org (the Phase 1 "Data 360 grounding" path
described in `/proposal/data-360`):

```bash
# 1. Install + authorize the Salesforce CLI
npm install -g @salesforce/cli
sf org login web --alias your-dev-org --set-default
sf config set target-org=your-dev-org --global

# 2. Create an External Client App in Setup with Client Credentials Flow
#    enabled, then a Policy with Run-As user pre-authorized via permission
#    set. Capture the Consumer Key and Secret.

# 3. Drop credentials into frontend/.env.local (gitignored):
#    SF_INSTANCE_URL=https://your-domain.my.salesforce.com
#    SF_CLIENT_ID=3MVG...
#    SF_CLIENT_SECRET=...

# 4. Verify auth round-trip:
cd frontend
node scripts/salesforce-smoke.mjs

# 5. Seed the menopause-specific Health Cloud cohort:
node scripts/salesforce-seed.mjs
# Optional cleanup later:
# node scripts/salesforce-seed.mjs --cleanup

# 6. Verify grounding queries:
node scripts/grounding-smoke.mjs

# 7. Start the dev server and watch the Agent Fabric console for
#    LIVE-badged spans:
npm run dev
# Open http://localhost:3000/demo/agent-fabric and trigger a test intake.
```

The seeder creates 1 CareProgram + 6 patient personas (each with
Account / Contact / CareProgramEnrollee / Case / CarePlan), all tagged
`Pause Demo` for easy identification and cleanup. The Care Router uses
intake hints (preferredName, ageBand) to match a seeded persona and
grounds its routing decision on that persona's real org data.

If the org becomes unreachable or any SOQL query fails, callers
degrade silently to the mocked grounding path so the prototype never
appears broken to a visitor. The Agent Fabric console reports
`source=real` vs `source=mock` per span.

### Deploying real-org grounding to Vercel (deliberate non-default)

The three `SF_*` env vars are intentionally **not** set in Vercel's
project environment. As a result, every preview deploy and the
production site at `pause-health.ai` run the deterministic mock path.
This is by design — the connected dev org is a Trailhead Playground,
and pointing public traffic at it would exhaust its API limits and
generate unbounded demo records.

To enable real-org grounding on a Vercel deploy (e.g. for a scheduled
investor demo):

```bash
# Add the three vars in: Vercel dashboard → project → Settings →
# Environment Variables. Scope them to "Production" (or "Preview" for a
# specific PR demo). Then trigger a redeploy.
#
# After the demo, REMOVE the env vars (or rotate the Client Secret in
# Salesforce Setup) and redeploy to return to mock-only behavior.
```

The recommended posture for any non-trivial demo: spin up a clean
Salesforce dev org per-customer (or per-investor-session), seed it
with that customer's pilot cohort using
`frontend/scripts/salesforce-seed.mjs`, and rotate credentials between
sessions. The first paying customer's deployment uses their own
Salesforce org and their own env vars — Pause never co-mingles
customer data in a single org.

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