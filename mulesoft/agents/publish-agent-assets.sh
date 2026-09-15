#!/usr/bin/env bash
#
# publish-agent-assets.sh
# -----------------------------------------------------------------------------
# Publishes the generated Pause fabric agent assets (mulesoft/agents/assets/*)
# to Anypoint Exchange so Anypoint Agent Visualizer can discover the network.
#
# SAFETY MODEL — dry-run by DEFAULT. This script makes ZERO network calls unless
# you pass an explicit mode flag:
#
#   (no flag)          Dry-run. Validates every asset, prints the exact publish
#                      commands that WOULD run. No token fetched, no network.
#   --probe            Read-only. Fetches an OAuth token and makes ONE GET to
#                      confirm the credentials work against the org. No writes.
#   --live CONFIRM=yes Actually PUT every asset to Exchange. Requires BOTH the
#                      --live flag AND the CONFIRM=yes env/arg. Refuses otherwise.
#
# Credentials are read from ~/.m2/settings.xml (server id `anypoint-exchange-v2`,
# password field = "<client_id>~?~<client_secret>"). They are NEVER committed and
# NEVER echoed. Confirm they are current before any --live run (they may need
# rotation — see docs/MULESOFT_RUNBOOK.md and memory).
#
# Exchange tombstones versions permanently. Assets are pinned at 1.0.0; a second
# --live run of the same version will 409/tombstone-conflict. Bump the version in
# generate-agent-assets.mjs (ASSET_VERSION) and regenerate before re-publishing.
# -----------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="$HERE/assets"
MANIFEST="$HERE/assets-manifest.json"
SETTINGS="${M2_SETTINGS:-$HOME/.m2/settings.xml}"

GROUP_ID="56707cc3-a0e3-4318-b110-78126aace370"
TOKEN_URL="https://anypoint.mulesoft.com/accounts/api/v2/oauth2/token"
# Exchange Experience API — the path that produces a native type=agent asset.
# (The Maven-v2 jar PUT that published our spec assets yields type=unknown, which
# Agent Visualizer does NOT surface as an agent — verified against the live org.)
EXCHANGE_BASE="https://anypoint.mulesoft.com/exchange/api/v2"
UPLOAD_BASE="${EXCHANGE_BASE}/organizations/${GROUP_ID}/assets/${GROUP_ID}"

MODE="dry-run"
CONFIRM="${CONFIRM:-no}"
LIMIT=0   # 0 = all; N = only the first N assets (for a small first batch)
for arg in "$@"; do
  case "$arg" in
    --probe) MODE="probe" ;;
    --live) MODE="live" ;;
    --limit=*) LIMIT="${arg#--limit=}" ;;
    CONFIRM=*) CONFIRM="${arg#CONFIRM=}" ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done
case "$LIMIT" in ''|*[!0-9]*) echo "--limit must be a non-negative integer" >&2; exit 2 ;; esac

log() { printf '%s\n' "$*"; }
hr() { printf '%s\n' "----------------------------------------------------------------------"; }

# ---- 1. Preflight validation (always, all modes) ---------------------------
[ -d "$ASSETS_DIR" ] || { echo "assets dir missing: $ASSETS_DIR — run generate-agent-assets.mjs first" >&2; exit 1; }
[ -f "$MANIFEST" ]   || { echo "manifest missing: $MANIFEST — run generate-agent-assets.mjs first" >&2; exit 1; }

COUNT=$(node -e 'console.log(require(process.argv[1]).count)' "$MANIFEST")
log "Pause fabric agent assets — Exchange publisher"
hr
log "Mode:        $MODE"
log "Assets:      $COUNT (manifest: mulesoft/agents/assets-manifest.json)"
log "Group ID:    $GROUP_ID"
log "Asset type:  agent (A2A v0.3 card, classifier a2a-card)"
hr

# Validate every asset on disk: the agent card exists and is valid JSON.
MISSING=0
while IFS= read -r id; do
  card="$ASSETS_DIR/$id/src/main/resources/$id-agent.json"
  [ -f "$card" ] || { echo "  MISSING card: $id"; MISSING=$((MISSING+1)); }
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$card" 2>/dev/null \
    || { echo "  BAD JSON: $id"; MISSING=$((MISSING+1)); }
done < <(node -e 'require(process.argv[1]).assets.forEach(a=>console.log(a.id))' "$MANIFEST")

if [ "$MISSING" -ne 0 ]; then
  echo "Preflight FAILED: $MISSING problem(s). Aborting." >&2
  exit 1
fi
log "Preflight OK: all $COUNT assets have a parseable A2A agent card."
hr

# ---- 2. Dry-run: print the plan, make no network calls --------------------
if [ "$MODE" = "dry-run" ]; then
  log "DRY-RUN — the following commands WOULD run under --live (no network is touched now):"
  log ""
  log "  # Fetch OAuth2 token (client_credentials) from settings.xml server 'anypoint-exchange-v2':"
  log "  CRED=\$(grep -A3 anypoint-exchange-v2 $SETTINGS | grep password | sed 's/.*>\\(.*\\)<.*/\\1/')"
  log "  CLIENT_ID=\${CRED%%~?~*}; CLIENT_SECRET=\${CRED##*~?~}"
  log "  TOKEN=\$(curl -s -X POST '$TOKEN_URL' \\"
  log "    -d \"grant_type=client_credentials&client_id=\$CLIENT_ID&client_secret=\$CLIENT_SECRET\" | jq -r .access_token)"
  log ""
  # Show the per-asset POSTs for the first 2 and the last 1 as concrete examples.
  # This is the verified Exchange Experience API shape that yields type=agent.
  node -e '
    const m = require(process.argv[1]);
    const base = process.argv[2];
    const show = [...m.assets.slice(0,2), m.assets[m.assets.length-1]];
    for (const a of show) {
      const card = `mulesoft/agents/assets/${a.id}/src/main/resources/${a.id}-agent.json`;
      console.log(`  # ${a.id}`);
      console.log(`  curl -s -X POST "${base}/${a.artifactId}/${a.version}" \\`);
      console.log(`    -H "Authorization: bearer $TOKEN" -H "x-sync-publication: true" \\`);
      console.log(`    -F "name=<agent name>" -F "type=agent" -F "classifier=a2a-card" \\`);
      console.log(`    -F "files.json=@${card};type=application/json"`);
      console.log("");
    }
    console.log(`  ... (${m.count - 3} more assets, same shape)`);
  ' "$MANIFEST" "$UPLOAD_BASE"
  hr
  log "NETWORK CALLS MADE: 0"
  log ""
  log "ASSET TYPE (verified against the live org): this POST creates a native"
  log "type=agent asset (classifier a2a-card), which Agent Visualizer surfaces as an"
  log "agent. The Maven-v2 jar PUT used for our spec assets yields type=unknown and is"
  log "NOT used here. Each version is pinned at 1.0.0 (Exchange tombstones versions)."
  log ""
  log "Go-live: 1) bash publish-agent-assets.sh --probe   (confirm creds, read-only)"
  log "         2) bash publish-agent-assets.sh --live CONFIRM=yes"
  exit 0
fi

# ---- guard: refuse a live run without CONFIRM=yes BEFORE any network -------
if [ "$MODE" = "live" ] && [ "$CONFIRM" != "yes" ]; then
  echo "REFUSING to publish: --live requires CONFIRM=yes (no network was touched)." >&2
  echo "  bash mulesoft/agents/publish-agent-assets.sh --live CONFIRM=yes" >&2
  exit 3
fi

# ---- shared: load creds (probe + live only) --------------------------------
[ -f "$SETTINGS" ] || { echo "settings.xml not found: $SETTINGS" >&2; exit 1; }
CRED=$(grep -A3 anypoint-exchange-v2 "$SETTINGS" | grep password | sed 's/.*>\(.*\)<.*/\1/')
CLIENT_ID="${CRED%%~\?~*}"
CLIENT_SECRET="${CRED##*~\?~}"
if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ] || [ "$CLIENT_ID" = "$CRED" ]; then
  echo "Could not parse client_id~?~client_secret from $SETTINGS (server anypoint-exchange-v2)." >&2
  exit 1
fi
log "Fetching OAuth2 token (client_credentials)..."
TOKEN=$(curl -s -X POST "$TOKEN_URL" \
  -d "grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).access_token||"")}catch{process.stdout.write("")}})')
if [ -z "$TOKEN" ]; then
  echo "Token fetch FAILED — credentials are likely expired/rotated. Confirm current creds before retrying." >&2
  exit 1
fi
log "Token acquired (credentials are valid)."

# ---- 3. Probe: one read-only GET, no writes --------------------------------
if [ "$MODE" = "probe" ]; then
  log "PROBE — read-only check against the org (no writes):"
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" \
    "https://anypoint.mulesoft.com/exchange/api/v2/assets?organizationId=$GROUP_ID&limit=1")
  log "  GET Exchange assets -> HTTP $STATUS"
  log "NETWORK CALLS MADE: 2 (token + 1 read-only GET). No writes."
  exit 0
fi

# ---- 4. Live publish (requires --live AND CONFIRM=yes) ---------------------
if [ "$MODE" = "live" ]; then
  if [ "$CONFIRM" != "yes" ]; then
    echo "REFUSING to publish: --live requires CONFIRM=yes." >&2
    echo "  bash mulesoft/agents/publish-agent-assets.sh --live CONFIRM=yes" >&2
    exit 3
  fi
  PLANNED=$COUNT
  if [ "$LIMIT" -gt 0 ] && [ "$LIMIT" -lt "$COUNT" ]; then PLANNED=$LIMIT; fi
  log "LIVE PUBLISH — pushing $PLANNED of $COUNT type=agent assets to Exchange (version 1.0.0)."
  [ "$PLANNED" -lt "$COUNT" ] && log "(--limit=$LIMIT: first $PLANNED assets only — a first batch.)"
  log "(Exchange tombstones versions; a repeat of an existing version will conflict.)"
  hr
  OK=0; FAIL=0; SKIP=0; DONE=0
  while IFS= read -r row; do
    if [ "$LIMIT" -gt 0 ] && [ "$DONE" -ge "$LIMIT" ]; then break; fi
    DONE=$((DONE+1))
    id="${row%%|*}"; rest="${row#*|}"; artifactId="${rest%%|*}"; version="${rest##*|}"
    card="$ASSETS_DIR/$id/src/main/resources/$id-agent.json"
    name=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).name)' "$card")
    # Skip if this version already exists (idempotent re-runs; avoids tombstone conflicts).
    exists=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: bearer $TOKEN" \
      "$EXCHANGE_BASE/assets/$GROUP_ID/$artifactId/$version/asset")
    if [ "$exists" = "200" ]; then
      SKIP=$((SKIP+1)); log "  SKIP $id (already published at $version)"; continue
    fi
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$UPLOAD_BASE/$artifactId/$version" \
      -H "Authorization: bearer $TOKEN" -H "x-sync-publication: true" \
      -F "name=$name" -F "type=agent" -F "classifier=a2a-card" \
      -F "files.json=@$card;type=application/json")
    if [[ "$code" =~ ^2 ]]; then
      OK=$((OK+1)); log "  OK   $id (HTTP $code)"
    else
      FAIL=$((FAIL+1)); log "  FAIL $id (HTTP $code)"
    fi
  done < <(node -e 'require(process.argv[1]).assets.forEach(a=>console.log(`${a.id}|${a.artifactId}|${a.version}`))' "$MANIFEST")
  hr
  log "Published OK: $OK   Skipped (already present): $SKIP   Failed: $FAIL   Attempted: $PLANNED / $COUNT"
  log "Reload Anypoint Agent Visualizer and confirm the agents appear."
  [ "$FAIL" -eq 0 ]
fi
