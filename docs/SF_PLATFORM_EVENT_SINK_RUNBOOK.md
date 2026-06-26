# Salesforce Platform Event Sink — Activation Runbook

**Status (2026-06-24):** sink shipped dormant (`lib/salesforce-platform-event-sink.ts` + the `/api/agent-fabric/sf-sink/config` route + the `recordSpan()` hook in `lib/agent-fabric.ts`). Three required env vars flip status to `prototype`; a fourth verification flag flips it to `shipped`.

This runbook is the procurement-and-activation checklist that turns audit-page **gap #3** (Agent Fabric → Salesforce Platform Event egress) from `designed` to `prototype` to `shipped`. It mirrors the patterns from `HEADLESS_360_RUNBOOK.md` and `AGENTFORCE_VOICE_RUNBOOK.md`.

## What this sink does (and what it deliberately doesn't)

When configured, every Agent Fabric span the Pause prototype records via `recordSpan()` is also POSTed to a custom Salesforce **Platform Event** sObject — `Pause_Agent_Trace__e` by default. A customer-org admin can then subscribe to the event from Flow, Apex, or the Pub/Sub gRPC API and route the records into whatever audit destination they want.

**Honest naming note:** the sink does **not** write into Salesforce's Real-Time Event Monitoring stream. RTEM's event catalog (`LoginEvent`, `ApiEvent`, `LightningUriEvent`, ~50 types) is Salesforce-platform-internal — external apps cannot define a new RTEM event type and cannot POST records into the RTEM stream. The supported partner pattern, per Pub/Sub API's own comparison table, is publishing custom **Platform Events** (sObjects suffixed `__e`).

Authoritative sources:
- https://developer.salesforce.com/docs/platform/pub-sub-api/guide/intro.html — the publish/subscribe table that confirms RTEM is subscribe-only for external clients.
- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_publish_api.htm — "publish events by inserting events in the same way that you insert sObjects."

## Phase 0 — verify the seam is in this checkout

```bash
ls frontend/lib/salesforce-platform-event-sink.ts
ls frontend/app/api/agent-fabric/sf-sink/config/route.ts
grep -q "emitSpanEvent" frontend/lib/agent-fabric.ts && echo "hook present"
```

All three checks must pass. Smoke the API contract:

```bash
cd frontend
npm run dev &
curl -sS http://localhost:3000/api/agent-fabric/sf-sink/config | jq .
# Expected with no env vars set:
# {
#   "meta": { "_source": "designed", "_doc": "..." },
#   "status": "designed",
#   "counters": { "attempted": 0, "succeeded": 0, "failed": 0, "lastError": null }
# }
```

## Phase 1 — procure (Salesforce side)

### 1a. Define the `Pause_Agent_Trace__e` Platform Event

In your Salesforce org: **Setup → Platform Events → New Platform Event**.

- Label: `Pause Agent Trace`
- Plural Label: `Pause Agent Traces`
- Object Name: `Pause_Agent_Trace` (Salesforce appends `__e` automatically)
- Publish Behavior: `Publish After Commit` is fine; switch to `Publish Immediately` if you want sub-second egress.

After saving, define these custom fields. The API names below MUST match exactly — they're hard-coded in `spanToEventPayload()` in `lib/salesforce-platform-event-sink.ts`.

| Field API Name | Type | Length / Precision | Required | Notes |
|---|---|---|---|---|
| `Span_Id__c` | Text | 64 | ✅ | Pause-side span id |
| `Task_Id__c` | Text | 64 | ✅ | Agent Fabric task correlation id |
| `Parent_Span_Id__c` | Text | 64 | — | Optional parent for nested spans |
| `Agent_Id__c` | Text | 80 | ✅ | e.g. `care-router-claude` |
| `Operation__c` | Text | 120 | ✅ | e.g. `a2a.tasks/send`, `mcp.tools/call` |
| `Protocol__c` | Text | 20 | ✅ | One of `a2a`, `mcp`, `rest`, `internal` |
| `Status__c` | Text | 20 | ✅ | One of `ok`, `error`, `in-progress` |
| `Duration_Ms__c` | Number | 10,0 | — | Optional; omitted on instant spans |
| `Started_At__c` | Date/Time | — | ✅ | ISO-8601 wall clock |
| `Attributes_Json__c` | Long Text Area | 32,768 | — | JSON-encoded attribute map (truncated at 30,000 chars by the sink) |

(If you want a different event name, set `SF_PLATFORM_EVENT_API_NAME` in Phase 2. The seam validates that it ends with `__e`.)

### 1b. Create a Connected App for Client Credentials grant

The sink authenticates via **OAuth 2.0 Client Credentials**. Spans fire from server-side API routes that don't have a signed-in user; events are attributed to the Connected App's integration user, then mapped Salesforce-side onto whatever the customer's audit pipeline does.

**Setup → App Manager → New Connected App → New Connected App** (NOT "New External Client App" — that's the PKCE-only flavor used by `HEADLESS_360_RUNBOOK.md`).

- Connected App Name: `Pause Health Platform Event Sink`
- API Name: auto
- Contact Email: an admin
- Enable OAuth Settings: ✅
- Callback URL: `https://login.salesforce.com/services/oauth2/success` (placeholder; Client Credentials doesn't redirect, but Salesforce requires the field)
- Selected OAuth Scopes:
  - `Manage user data via APIs (api)` — required for sObject inserts.
- **Enable Client Credentials Flow** (under the OAuth policies section after first save).
- **Run As**: choose an integration user that has `Create` access on `Pause_Agent_Trace__e` and the API Enabled permission. We strongly recommend a dedicated integration user with no other permissions — least-privilege.
- Save. Salesforce returns a **Consumer Key** and a **Consumer Secret** — these are `client_id` and `client_secret`.

### 1c. (Optional) Subscribe to the event

The sink only **publishes**. The customer admin decides what subscribes:

- **Flow:** Setup → Flows → New Flow → Platform Event-Triggered Flow → select `Pause_Agent_Trace__e`. Common pattern: insert each event as a record in a custom audit sObject for long-term retention.
- **Apex Trigger:** trigger on `Pause_Agent_Trace__e`.
- **Pub/Sub gRPC:** subscribe to `/event/Pause_Agent_Trace__e` from any external consumer.

Subscription is intentionally out of this runbook's scope — the same event can drive many destinations.

## Phase 2 — set the deploy-side env vars

```bash
cd frontend
vercel env add SF_PLATFORM_EVENT_BASE_URL     production   # https://<my-org>.my.salesforce.com
vercel env add SF_PLATFORM_EVENT_CLIENT_ID    production   # Consumer Key
vercel env add SF_PLATFORM_EVENT_CLIENT_SECRET production   # Consumer Secret
# Optional overrides (defaults shown):
vercel env add SF_PLATFORM_EVENT_API_NAME     production   # Pause_Agent_Trace__e
vercel env add SF_PLATFORM_EVENT_API_VERSION  production   # v60.0
```

Trigger a redeploy:

```bash
vercel --prod --yes
```

Verify:

```bash
curl -sS https://pause-health.ai/api/agent-fabric/sf-sink/config | jq .
# Expected:
# {
#   "meta": { "_source": "prototype", "_doc": "..." },
#   "status": "prototype",
#   "eventApiName": "Pause_Agent_Trace__e",
#   "apiVersion": "v60.0",
#   "counters": { "attempted": 0, "succeeded": 0, "failed": 0, "lastError": null }
# }
```

## Phase 3 — end-to-end verification

1. Trigger a Care Router task against production (this is the same `tasks/send` POST the prod-flip docs use):

   ```bash
   curl -sS -X POST https://pause-health.ai/api/agents/care-router/tasks \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": "sink-verify-1",
       "method": "tasks/send",
       "params": {
         "id": "task-sink-verify-1",
         "message": { "role": "user", "parts": [{ "type": "data", "data": { "intake": {
           "preferredName": "Verifier", "ageBand": "45-49", "cycleStatus": "perimenopausal",
           "primarySymptom": "vasomotor", "severity": "moderate",
           "redFlagsAcknowledged": "no", "patientZip": "92614"
         }}}] }
       }
     }'
   ```

2. Re-curl `/api/agent-fabric/sf-sink/config`. Expect `counters.attempted >= 1` and `counters.succeeded == counters.attempted` (assuming the Salesforce-side setup is correct). `lastError` should be `null`.

3. In Salesforce: query the event subscriber's audit table (Flow, Apex trigger, or the Pub/Sub gRPC tap) and confirm the record landed with the expected field values:
   - `Span_Id__c` is a `span-...` Pause id
   - `Task_Id__c` matches `task-sink-verify-1`
   - `Agent_Id__c` is `care-router-claude`
   - `Operation__c` is `a2a.tasks/send`
   - `Status__c` is `ok`
   - `Attributes_Json__c` parses as JSON and contains `pathway`, `acuity`, etc.

4. Record the verified run in `docs/SF_PLATFORM_EVENT_SINK_REAL_RUN_<YYYY-MM-DD>.md` (one paragraph + the curl + the Salesforce-side query result).

5. Flip the verified flag:

   ```bash
   vercel env add SF_PLATFORM_EVENT_VERIFIED production   # true
   vercel --prod --yes
   ```

6. Confirm:

   ```bash
   curl -sS https://pause-health.ai/api/agent-fabric/sf-sink/config | jq .status
   # Expected: "shipped"
   ```

   The audit page's gap #3 pill now reads `shipped`.

## Rollback

Same shape as the other Headless-360 seams — safe at every step:

```bash
vercel env rm SF_PLATFORM_EVENT_BASE_URL      production
vercel env rm SF_PLATFORM_EVENT_CLIENT_ID     production
vercel env rm SF_PLATFORM_EVENT_CLIENT_SECRET production
vercel env rm SF_PLATFORM_EVENT_API_NAME      production   # if set
vercel env rm SF_PLATFORM_EVENT_API_VERSION   production   # if set
vercel env rm SF_PLATFORM_EVENT_VERIFIED      production   # if set
vercel --prod --yes
```

After redeploy, `/api/agent-fabric/sf-sink/config` reports `designed` and `emitSpanEvent()` short-circuits to `"skipped"` for every span. The agent fabric is untouched.

## Failure modes (intentional)

- **Salesforce returns 401.** The cached token has been revoked. The sink wipes its cache so the next emit re-mints a token; it does NOT inline-retry because the caller is fire-and-forget.
- **Salesforce returns 400.** Almost always means a custom-field name mismatch with Phase 1a. Re-check the API names against `spanToEventPayload()`.
- **Network timeout.** The sink swallows the error, bumps `failed`, populates `lastError`, and continues. Spans keep landing in the Pause-side ring buffer; routing decisions don't degrade.

In all three cases, `recordSpan()` returns normally and the Care Router (and every other agent-fabric caller) is unaffected.

## Known unknowns

- **Connected App Client Credentials availability per edition.** Some Salesforce editions disable the Client Credentials flow; if your org doesn't surface the "Enable Client Credentials Flow" toggle, the sink can't run with Client Credentials. Workaround: switch to a JWT Bearer flow (requires private-key handling in the Vercel env and a small change in `fetchToken()`).
- **Pub/Sub API as the alternate publish path.** The sink uses REST sObjects today for simplicity. Pub/Sub gRPC (`api.pubsub.salesforce.com:7443`, Avro-encoded) has lower per-event latency at scale. The seam can be swapped to gRPC without changing the audit-page contract; not urgent for the prototype scale.
- **PII filtering.** Spans currently include `recommendedProviderNames`, `data360UnifiedPatientId`, and other attribute values. The customer org's Shield + Transaction Security policies should be the authoritative filter; if you need a Pause-side scrub before egress, add an attribute-filter step in `spanToEventPayload()`.
