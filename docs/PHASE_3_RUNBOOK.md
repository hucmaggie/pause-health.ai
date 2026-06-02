# Phase 3 Runbook: Author a Pause-Health-owned Agentforce Embedded Messaging Deployment

**Goal:** Replace the scripted intake at `/demo/intake` with a real, live
Salesforce Agentforce Embedded Messaging widget that loads on
`http://localhost:3000` and `https://pause-health.ai`.

**Status at 2026-06-02 end-of-session:** integration is fully wired and the
SDO sample deployment in the org was successfully published as V2 with
public bootstrap. However, the SDO sample deployment cannot be embedded on
an external origin because of two Salesforce-side restrictions documented
below. This runbook captures what needs to happen in a dedicated 2-4 hour
session to lift those restrictions by authoring a Pause-Health-owned
deployment.

## Why the SDO sample doesn't work for our prototype

DevTools Console diagnostics from 2026-06-02 (verified on `localhost:3000`
with all four `NEXT_PUBLIC_AGENTFORCE_*` env vars set to the SDO sample):

```
Access to fetch at 'https://trailsignup-c2d761a3b89bf2.my.salesforce-scrt.com/embeddedservice/v_…/config?orgId=00DHp00000L08KK&esConfigName=SDO_Messaging_for_Web&language=en_US'
from origin 'http://localhost:3000'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header
is present on the requested resource.

Framing 'https://trailsignup-c2d761a3b89bf2.my.salesforce.com/' violates
the following Content Security Policy directive:
"frame-ancestors ng-org-17107710635251.my.site.com *.ng-org-17107710635251.my.site.com ..."
The request has been blocked.

Error initializing app: Error: Error loading configuration settings
```

Two independent issues:

1. **CORS on the SCRT2 runtime config endpoint.** The
   `*.my.salesforce-scrt.com/embeddedservice/config` URL must include
   `Access-Control-Allow-Origin: http://localhost:3000` in its response
   headers. Salesforce derives this allowlist from the Experience site's
   own CORS configuration, NOT from the org-level `CorsWhitelistEntry`
   records (we already added `http://localhost:3000` there and it did
   not help).
2. **Frame-ancestors CSP on the Experience site.** The SDO sample's
   commcsp policy hardcodes `frame-ancestors` to a different org's
   domain (`ng-org-17107710635251.my.site.com`). Even if we fix CORS,
   the iframe cannot be embedded on our origin.

Both restrictions are configured per-deployment / per-site. The SDO
deployment is locked because Salesforce ships it for SDO-internal
demo use. Authoring our own deployment lets us configure both freely.

## What "works" today regardless

Even with the SDO restrictions in place, the integration plumbing has
been validated end-to-end and committed to the repo:

- `lib/agentforce.ts` reads and validates the four `NEXT_PUBLIC_AGENTFORCE_*`
  env vars; returns null when any is missing
- `components/agentforce-embed.tsx` injects the bootstrap script,
  initialises `embeddedservice_bootstrap` in floating mode, and renders
  a compact callout pointing visitors to the floating launcher
- `components/agentforce-fallback.tsx` (existing) renders a
  Pause-branded scripted intake when env vars are unset
- `/demo/intake` page conditionally renders one or the other
- `globals.css` defines `.agentforce-launcher-callout` for the compact
  CTA and `#embedded-messaging { z-index: 9999 }` to keep the launcher
  above our toast-region

When a Pause-Health-owned deployment exists and the four env vars are
re-pointed at it, no code changes are needed.

## Runbook: author a Pause-Health-owned deployment

**Time estimate:** 2-4 hours. Most of the time is waiting for Salesforce
CDN asset propagation between Publish clicks (~5-15 min each, often
requires hard-reload + cache-buster URL params to verify).

**Prerequisites:** completed Phase 1 (already done; commits on `main`).
A `trailsignup` org alias in `sf` CLI. The same Permission Set assignments
the SDO sample deployment uses (probably `Service Cloud User` + an
`Embedded Messaging` perm set).

### Step 1: Build (or pick) the Agent (~30-60 min)

Easier path: clone the existing `SDO_Service_Agentforce_Service_Agent`
BotDefinition into a new `Pause_Health_Intake_Agent`.

1. Setup -> Quick Find -> "Agent Builder" -> Open
2. New Agent -> "From Template" -> pick "Service Agent" template
3. Name: `Pause Health Intake Agent` (API name: `Pause_Health_Intake_Agent`)
4. Topics: add 3-4 healthcare topics specifically:
   - "Menopause symptom intake" (action: collect symptom data, route to clinician)
   - "Vasomotor symptoms" (action: assess severity, route based on rubric)
   - "Mental health red flag" (action: immediate escalation pathway)
   - "General menopause Q&A" (action: respond from grounded knowledge)
5. Knowledge: link to a Knowledge Article or skip for v1
6. Save -> Activate

Hardest part: writing good topic instructions. For v1, copying the SDO
Service Agent's instructions verbatim and just changing references from
"customer service" to "menopause care intake" is acceptable.

### Step 2: Create an Embedded Service Deployment (~30-45 min)

1. Setup -> "Embedded Service Deployments" -> New Deployment
2. Type: **Messaging for In-App and Web** (this is the V2 / EmbeddedMessaging
   type, NOT the legacy Chat for Web)
3. Name: `Pause Health Intake`
4. API Name: `Pause_Health_Intake`
5. Messaging Channel: select the existing `Messaging_for_In_App_Web` channel
   we already have (DeveloperName: `Messaging_for_In_App_Web`, IsActive: true)
   OR create a new dedicated channel `Pause_Health_Messaging`
6. Routing: assign to the `Pause_Health_Intake_Agent` from Step 1
7. Save

The save will create:
- A new `EmbeddedServiceConfig` record
- A new auto-generated Experience Cloud site (`ESW_Pause_Health_Intake_*`)
- A new auto-generated `EmbeddedServiceDetail` row

**Verify checkpoint:** before continuing, query

```bash
sf data query --use-tooling-api \
  --query "SELECT DeveloperName, MasterLabel, DeploymentType, DeploymentFeature, AreGuestUsersAllowed, IsEnabled FROM EmbeddedServiceConfig WHERE DeveloperName = 'Pause_Health_Intake'" \
  --target-org trailsignup
```

Expected: 1 row, `DeploymentType=Web`, `DeploymentFeature=EmbeddedMessaging`,
`IsEnabled=true`. Note: `AreGuestUsersAllowed` is likely `false` by default.

### Step 3: Allow guest users (~2 min, API-driven)

Same Tooling API trick we used for the SDO sample on 2026-06-02:

```bash
# Pull the current Metadata blob
sf data query --use-tooling-api \
  --query "SELECT Id, Metadata FROM EmbeddedServiceConfig WHERE DeveloperName = 'Pause_Health_Intake'" \
  --target-org trailsignup --json > /tmp/cfg.json

# Use Node to flip areGuestUsersAllowed -> true and PATCH it back
# (see scripts/salesforce-embedded-config.mjs if it exists; otherwise inline)
```

Or via Setup UI: Edit deployment -> Permitted Users / Guest User Access ->
allow.

### Step 4: Configure Experience site CORS + CSP (~45-90 min, UI clickthrough)

This is the time-consuming part and the part that genuinely needs to be
done in the Setup UI (no public API).

Setup -> All Sites -> find the auto-created `ESW_Pause_Health_Intake_*`
Experience Cloud site -> Builder

In Experience Builder:

1. Settings (gear icon) -> **Security & Privacy** -> Content Security Policy
   -> set Level to **"Trusted Sites Only (Recommended)"** (NOT Strict)
2. Add **Trusted Sites for Frames** (this is the `frame-ancestors` CSP):
   - `http://localhost:3000`
   - `https://pause-health.ai`
   - `https://pause-health-ai.vercel.app`
   - `https://*.vercel.app` (for preview deploys)
3. Settings -> CORS -> add the same four origins
4. Publish the site

**Important:** Publishing the Experience site is SEPARATE from publishing
the Embedded Service Deployment. You'll do both.

### Step 5: Publish the Embedded Service Deployment (~5 min + 5-15 min propagation)

Setup -> Embedded Service Deployments -> Pause_Health_Intake -> Publish

Wait 5-15 min, then verify the bootstrap is public:

```bash
# Replace <auto_id> with the actual ESW site path
curl -sL -o /dev/null -w "HTTP %{http_code}  bytes=%{size_download}\n" \
  "https://trailsignup-c2d761a3b89bf2.my.site.com/ESWPauseHealthIntake<auto_id>/assets/js/bootstrap.min.js"
```

Expected: `HTTP 200  bytes=~30000` (real JavaScript). If 401, wait
another 5 min and retry; if persistent, re-check the guest user allow
step.

### Step 6: Wire env vars and verify (~10 min)

Update `frontend/.env.local`:

```
NEXT_PUBLIC_AGENTFORCE_ORG_ID=00DHp00000L08KK
NEXT_PUBLIC_AGENTFORCE_DEPLOYMENT_NAME=Pause_Health_Intake
NEXT_PUBLIC_AGENTFORCE_SITE_URL=https://trailsignup-c2d761a3b89bf2.my.site.com/ESWPauseHealthIntake<auto_id>
NEXT_PUBLIC_AGENTFORCE_SCRT2_URL=https://trailsignup-c2d761a3b89bf2.my.salesforce-scrt.com
```

Restart `npm run dev`. Visit `http://localhost:3000/demo/intake`. Expected:

- The "Pause Intake Assistant" card shows "LIVE AGENT" badge and the
  compact callout "The live agent is ready. Click the chat launcher
  in the bottom-right corner..."
- A circular Salesforce chat launcher appears in the bottom-right of the
  viewport
- Clicking the launcher opens a chat panel
- Typing a message triggers a real agent response from `Pause_Health_Intake_Agent`

If still no launcher: open DevTools Console. Specifically look for:

- Any `CORS policy` error -> Step 4 CORS config didn't apply; re-check
- Any `frame-ancestors` CSP error -> Step 4 Trusted Sites for Frames
  didn't include the origin you're testing from
- Any `Error loading configuration settings` -> SCRT2 endpoint still
  blocked; this is the SDO-sample-equivalent failure mode and means
  Salesforce hasn't propagated the new site's CORS yet (wait 15-30 min)

### Step 7: (Optional) Context handoff (~45 min)

Once the basic widget works, you can pre-fill the chat session with
intake form context (preferredName, ageBand, primarySymptom) via
`embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields()` from
our React component. Skip for first ship.

### Step 8: Deploy to Vercel (~15 min)

Add the same four `NEXT_PUBLIC_AGENTFORCE_*` env vars in Vercel project
settings (Production, Preview, Development). Trigger a redeploy. Verify
on `https://pause-health.ai/demo/intake`.

## Rollback

To force the prototype back to the scripted fallback, comment out (or
leave unset) any of the four `NEXT_PUBLIC_AGENTFORCE_*` env vars. The
`lib/agentforce.getAgentforceConfig()` function returns null when any
is missing, and `/demo/intake` renders `<AgentforceFallback />` instead.
No code changes required.

## What was learned in the 2026-06-02 session (won't need to redo)

- The org has Agentforce enabled with 30 pre-authored BotDefinitions
  including 11 healthcare ExternalCopilot agents
- `Messaging_for_In_App_Web` MessagingChannel exists and is active
  (Enhanced platform, EmbeddedMessaging type)
- The Tooling API correctly PATCHes `EmbeddedServiceConfig.Metadata.areGuestUsersAllowed`
- Org-level `CorsWhitelistEntry` does NOT govern Experience site CORS
  (this was a wrong turn in the 2026-06-02 session — site-level CORS is
  in Experience Builder Settings, NOT Setup)
- V1 -> V2 deployment conversion creates a NEW Experience site under a
  different URL prefix (drop the `vforce` suffix)
- Modern Agentforce bootstrap is at `/assets/js/bootstrap.min.js` (not
  the legacy `/embeddedservice/5.0/esw.min.js`)
- Salesforce CDN cache for new deployments is ~5-15 min; always
  cache-bust with `?_cb=$(date +%s)` when verifying
- Zscaler does NOT block `*.my.site.com` or `*.my.salesforce-scrt.com`
  but DOES block per-tenant CDP hostnames (irrelevant for Phase 3, only
  matters for Phase 2 Data Cloud)
