# Phase 3 Runbook: Author a Pause-Health-owned Agentforce Embedded Messaging Deployment

**Status: SHIPPED — 2026-06-02 21:46 PT. Pivoted personalization to
visible Pre-Brief Panel on 2026-06-04 (see Phase 18c below).**

The Pause-Health-owned Agentforce Embedded Messaging deployment is now live
end-to-end. A real Salesforce Agentforce Service Agent
(`Pause_Health_Intake_Agent`) responds to messages from `pause-health.ai/demo/intake`
through a Salesforce-hosted chat panel embedded into the Next.js app on Vercel.

Personalization (hidden-prechat handoff of a Data 360 patient dossier to
the agent) was attempted in Phase 18a/b and discovered to be blocked by
an empty-Proxy `prechatAPI` in the Embedded Messaging V2 SDK. The
working pivot in Phase 18c surfaces the same dossier as a visible
Pre-Brief Panel above the chat. The full hidden-prechat metadata stack
is left in place in the org so the moment Salesforce fixes the V2 SDK
binding the in-band handoff lights up.

Verified end-to-end at 21:46 PT 2026-06-02: opened `pause-health.ai/demo/intake`
on production Vercel, clicked the chat launcher, sent "hello", agent joined
("Pause Health Intake Agent joined") and replied ("Hi, I'm an AI service
assistant. How can I help you?"). Footer reads "Powered by Agentforce from
salesforce." Console errors were limited to harmless `commcsp` placeholder
warnings inherited from the org-wide CSP policy.

The body of this runbook below is preserved as historical record of the
two-session investigation that led to the live deployment, including the
specific blockers we hit and how each one was resolved.

## What ended up shipping (final state at 21:46 PT 2026-06-02)

| Component | Value | Notes |
|---|---|---|
| Embedded Service Deployment | `Pause_Health_Intake` (Id `04IHp0000011V2VMAU`) | DeploymentType=Web, DeploymentFeature=EmbeddedMessaging, ClientVersion=WebV2, AreGuestUsersAllowed=true, IsEnabled=true |
| Experience site | `ESW_Pause_Health_Intake_17804555025671` (Id `0DMHp0000019wJoOAI`) | UrlPathPrefix=`ESWPauseHealthIntake1780455502567`, Status=Active, frame-ancestors=`pause-health.ai *.pause-health.ai` |
| Agent | `Pause_Health_Intake_Agent` (BotDefinitionId `0XxHp0000014tiuKAA`) | Type=Service Agent, Version 1=Active, two subagents (Escalation + Menopause Symptom Intake), 7 instructions including red-flag escalation |
| Messaging Channel | `Messaging_for_In_App_Web` (Id `0MjHp00000118PqKAI`) | Type=EmbeddedMessaging, IsActive=true, PlatformType=Enhanced |
| Channel routing | Omni-Channel Routing → Routing Type **Agentforce Service Agent** → Pause Health Intake Agent | The key fix: was previously set to Omni-Flow → `HLS - Route to Bot` which targeted the wrong (legacy SDO) bot |
| Org CORS allowlist | `CorsWhitelistEntry` records `https_pause_health_ai` and `https_pause_health_ai_wild` | Cover `https://pause-health.ai` and `https://*.pause-health.ai` |
| Trusted URLs (CSP) | `Pause_Health_AI_Production` + `Pause_Health_AI_Wildcard` | All 6 CSP directives ticked, Context=All |
| Frontend env vars | Four `NEXT_PUBLIC_AGENTFORCE_*` in Vercel Production + Preview + Dev | Mirror `frontend/.env.local` |

## Root-cause summary (the two surprises we hit)

1. **`clientVersion: WebV1` stuck on the deployment.** The Salesforce UI
   created the deployment as V2 (`DeploymentFeature=EmbeddedMessaging`) but
   the underlying `EmbeddedServiceConfig.clientVersion` field defaulted to
   `WebV1` and was not writable via Tooling API v60. **Fix:** use Tooling
   API v65 to PATCH `Metadata.clientVersion = WebV2` (older versions don't
   expose the field at all). Then republish the deployment for SCRT2 to
   pick up the change.

2. **The MessagingChannel routed conversations to the wrong bot.** The
   org's `Messaging_for_In_App_Web` channel inherited an Omni-Channel
   Routing config pointing at the legacy `HLS - Route to Bot` Omni-Flow
   from the SDO sample. This caused the chat panel to open, fetch config,
   then sit forever with `RPC failed to connect: Error: RPC connection
   timeout` inside the iframe (the iframe couldn't reach an active bot).
   **Fix:** Setup → Messaging Settings → Messaging for In App & Web → edit
   Omni-Channel Routing → set **Routing Type** to `Agentforce Service
   Agent` → pick `Pause_Health_Intake_Agent` → Save. Routes incoming
   conversations directly to our agent, bypassing the broken legacy flow.

## Phase 18a follow-up: hidden-prechat patient context (2026-06-02 → 2026-06-03)

After the base Phase 3 deployment shipped, we added pre-resolved patient
context so the live Agentforce Service Agent walks into every
conversation already knowing who the patient is. Phase 18a turned out
to be a two-session effort with one major architectural discovery
between the sessions.

### Final architecture (post-discovery, 2026-06-03)

The Salesforce-documented path for getting hidden-prechat fields into an
Agentforce Service Agent is a **5-component data pipeline**, not the
"add a few Parameter Mappings" UI step described in the initial Phase
18a docs. The discovery: **Salesforce only accepts custom Parameter
Mappings on Messaging Channels whose session handler is a Flow.** When
the channel routes directly to an Agentforce Service Agent (which is
what Phase 18 set up to bypass the legacy SDO bot), the channel
silently refuses every custom parameter. The fix is to put a Flow
between the channel and the agent, have the Flow write each inbound
value onto a custom field on `MessagingSession`, then expose those
fields to the agent as `$Context.<Field>` variables.

End-to-end data flow:

```
[Browser /demo/intake]
  └─ persona picker selected
       └─ GET /api/intake/prechat-context?personaId=<id>
            └─ returns ~20 short string fields (each <=255 chars)
  └─ <AgentforceEmbed/> re-keys on personaId, remounts SDK
       └─ onEmbeddedMessagingReady event
            └─ embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields(fields)

[Salesforce SCRT2 / Messaging for Web channel]
  └─ Channel: Messaging_for_In_App_Web
       └─ <customParameters> (20x, one per dossier field, maxLength=255)
       └─ <sessionHandlerType>Flow</sessionHandlerType>
       └─ <sessionHandlerFlow>Pause_Intake_Prechat_Router</sessionHandlerFlow>
            └─ values flow into the Flow as String input variables

[Salesforce Routing Flow: Pause_Intake_Prechat_Router]
  └─ 20 input variables (Patient_Id, Age_Band, Vasomotor_Score, ...)
  └─ <recordUpdates> writes each variable onto MessagingSession.Pause_<Name>__c
  └─ <actionCalls actionName=routeWork>
       └─ routingType=Copilot, copilotId=Pause_Health_Intake_Agent

[Agentforce Service Agent: Pause_Health_Intake_Agent]
  └─ 19 <contextVariables> blocks (5 standard + 14 dossier)
       └─ each maps MessagingSession.Pause_<Name>__c -> $Context.Pause_<Name>
       └─ includeInPrompt=true, so the LLM sees them on session start
  └─ Menopause_Symptom_Intake topic has two new sortOrder=0 instructions:
       └─ instruction_0_dossier: enumerates every $Context.Pause_<Name>
            and tells the LLM these values are authoritative
       └─ instruction_0_personalize: tells the LLM not to re-ask for
            anything already in the dossier
```

### Key architectural constraints we hit and how we handled them

| # | Constraint | Source | Resolution |
|---|---|---|---|
| 1 | Parameter mappings only allowed on Flow-handled channels | Metadata API deploy error | Build the `Pause_Intake_Prechat_Router` Flow, switch `sessionHandlerType` from `AgentforceServiceAgent` to `Flow` |
| 2 | `customParameter.maxLength` capped at 255, with truncation | Metadata API deploy error + Salesforce docs | Clamp every value <=255 in `/api/intake/prechat-context`; drop `Patient_Context_JSON` entirely (1.4KB would truncate to 252 bytes of JSON header) |
| 3 | A Bot can have at most 20 `contextVariables` total | Metadata API deploy error | Bot has 5 standard ones; we kept 14 of our 20 dossier fields as ctx variables (dropped 6 metadata-ish ones: Identity_Confidence, Identity_Sources, Identity_Ruleset, Cohort_Size, Grounding_Insights_Count, Patient_Context_JSON). The Flow still writes all 20 to MessagingSession; the dropped 6 are queryable by Apex actions but not surfaced as `$Context` |
| 4 | Cannot deploy GenAiPlannerBundle changes while agent is Active | Metadata API deploy error | Use `sf agent deactivate` -> deploy -> `sf agent activate` cycle |
| 5 | Salesforce `Status` field on `BotVersion` not REST-writable | Tooling API error | Use `sf agent deactivate` / `sf agent activate` CLI commands (they wrap the proprietary API) |

### Hidden prechat field schema (final, post-truncation handling)

All values are strings clamped to <=255 chars by `clampForChannel()`.

| Field | Example | Channel? | MessagingSession? | $Context? | Notes |
|---|---|---|---|---|---|
| `_firstName` | `Anika` | std | n/a | std | Salesforce-standard, auto-accepted |
| `_lastName` | `Patel` | std | n/a | std | Salesforce-standard, auto-accepted |
| `Patient_Id` | `003Hp00003b9bdqIAA` | ✓ | `Pause_Patient_Id__c` | `Pause_Patient_Id` | Real Salesforce Contact.Id when SF is configured |
| `Identity_Confidence` | `0.94` | ✓ | `Pause_Identity_Confidence__c` | (dropped) | Provenance — Apex-queryable |
| `Identity_Sources` | `epic-health-cloud, agentforce-intake-history` | ✓ | `Pause_Identity_Sources__c` | (dropped) | Provenance |
| `Identity_Ruleset` | `pause-phase1-healthcloud-contact-match-v1` | ✓ | `Pause_Identity_Ruleset__c` | (dropped) | Provenance |
| `Age_Band` | `45-49` | ✓ | `Pause_Age_Band__c` | `Pause_Age_Band` | |
| `Cycle_Status` | `Perimenopausal` | ✓ | `Pause_Cycle_Status__c` | `Pause_Cycle_Status` | |
| `Primary_Symptom` | `Hot flashes` | ✓ | `Pause_Primary_Symptom__c` | `Pause_Primary_Symptom` | |
| `Vasomotor_Score` | `7` | ✓ | `Pause_Vasomotor_Score__c` | `Pause_Vasomotor_Score` | 0-10 |
| `Sleep_Score` | `4` | ✓ | `Pause_Sleep_Score__c` | `Pause_Sleep_Score` | 0-10 |
| `Mood_Score` | `3` | ✓ | `Pause_Mood_Score__c` | `Pause_Mood_Score` | 0-10 |
| `Care_Program_Status` | `Enrolled` | ✓ | `Pause_Care_Program_Status__c` | `Pause_Care_Program_Status` | From real CareProgramEnrollee |
| `Care_Plan_Status` | `Active` | ✓ | `Pause_Care_Plan_Status__c` | `Pause_Care_Plan_Status` | From real CarePlan |
| `Days_Since_Last_Contact` | `1` | ✓ | `Pause_Days_Since_Last_Contact__c` | `Pause_Days_Since_Last_Contact` | From most-recent Case.LastModifiedDate |
| `Cohort_Name` | `Pause Demo Menopause Cohort · 45-49 · primary Hot flashes` | ✓ | `Pause_Cohort_Name__c` | `Pause_Cohort_Name` | |
| `Cohort_Size` | `6` | ✓ | `Pause_Cohort_Size__c` | (dropped) | Apex-queryable |
| `Patient_Percentile` | `70` | ✓ | `Pause_Patient_Percentile__c` | `Pause_Patient_Percentile` | |
| `Grounding_Source` | `real` | ✓ | `Pause_Grounding_Source__c` | `Pause_Grounding_Source` | `real` \| `mock` |
| `Grounding_Insights_Count` | `5` | ✓ | `Pause_Grounding_Insights_Count__c` | (dropped) | Apex-queryable |
| `Demo_Note` | `Pre-resolved Pause-Health demo patient…` | ✓ | `Pause_Demo_Note__c` | `Pause_Demo_Note` | Clamped to 255 chars |
| `Patient_Context_JSON` | (full dossier) | ✗ | ✗ | ✗ | Available only via `/api/intake/prechat-context` (1.4KB; doesn't fit in 255-char channel field). Future: surface via a custom Apex action when the agent asks for it |

### Files / metadata artifacts owned by Pause-Health

| Artifact | Salesforce type | Source of truth |
|---|---|---|
| `MessagingSession.Pause_Patient_Zip__c` | CustomField | ✅ `salesforce/force-app/main/default/objects/MessagingSession/fields/` |
| `Pause_Health_Intake_Prechat_Dossier` permission set (FLS) | PermissionSet | ✅ `salesforce/force-app/main/default/permissionsets/` |
| `Pause_Intake_Prechat_Router` routing flow | Flow / RoutingFlow | ✅ `salesforce/force-app/main/default/flows/` |
| `Messaging_for_In_App_Web` channel | MessagingChannel | ✅ `salesforce/force-app/main/default/messagingChannels/` (custom-params + flow handler) |
| `Pause_Provider_API` named credential | NamedCredential | ✅ `salesforce/force-app/main/default/namedCredentials/` |
| ~20 other custom fields on `MessagingSession` | CustomField | ⏳ org-managed; `salesforce/retrieve.sh` (was `/tmp/sf-md-fields/…`) |
| `Pause_Health_Intake_Agent` Bot (contextVariables) | Bot | ⏳ org-managed (Agent Builder); `salesforce/retrieve.sh` |
| `Pause_Health_Intake_Agent` GenAiPlannerBundle (topic instructions) | GenAiPlannerBundle | ⏳ org-managed (Agent Builder); `salesforce/retrieve.sh` |

**Phase 18b — DONE.** The deployable metadata is now version-controlled under
`salesforce/` (a real SFDX project: `sfdx-project.json` + `force-app/` +
`manifest/` + `deploy.sh`/`retrieve.sh` + `README.md`), replacing the retired
`.sf-deploy/` scaffold and the `/tmp` retrieves. The remaining ~20 dossier
fields and the Agent (Bot/GenAiPlannerBundle) are still org-managed; one
`salesforce/retrieve.sh` run on an SF-reachable network pulls them in. See
[`salesforce/README.md`](../salesforce/README.md).

### Verifying end-to-end

1. Visit `/demo/intake` on production.
2. Pick a persona via "View as".
3. Open the Agentforce launcher and ask "Who am I?". The agent should
   greet you by first name and acknowledge your reported primary
   symptom + vasomotor/sleep/mood scores.
4. Ask "What symptoms have I reported?". The agent should NOT re-ask;
   it should restate the values from the dossier.
5. To inspect the agent's view of the dossier directly:
   ```bash
   curl -s "https://pause-health-ai.vercel.app/api/intake/prechat-context?personaId=anika-patel" | jq .prechatFields
   ```

### Re-using this pattern in real customer deployments

The picker disappears, `personaId` is replaced by the patient's real
authenticated identity (patient-portal SSO), and the route signature
stays as-is:

```
GET /api/intake/prechat-context?patientId=<real-fhir-id>
```

The grounding pipeline already supports both real Salesforce Contact
IDs and synthetic demo IDs (see `lib/salesforce/grounding.ts:
getGroundingContextFromOrg`). Everything downstream — the channel
schema, the Flow, the MessagingSession fields, the agent's
`$Context.Pause_*` references — is identical.

## Phase 18c: dead end on hidden-prechat — pivot to visible Pre-Brief Panel (2026-06-04)

**Status: SHIPPED PIVOT — visible Pre-Brief Panel renders above the
chat on `/demo/intake`. Phase 18a/b Salesforce metadata is left in
place but is dormant.**

After Phase 18a/b deployed the full 5-component data pipeline
(channel customParameters → routing Flow → `MessagingSession.Pause_*__c`
fields → bot `contextVariables` → topic instructions) end-to-end,
verification failed: `MessagingSession.Pause_*__c` was always null on
every conversation, no matter what we did.

A two-evening debug session walked the data through every link and
landed on a definitive root cause inside the Embedded Messaging V2
SDK itself. The full investigation is preserved here so the next
person who tries this doesn't have to repeat it.

### Root cause: `prechatAPI` is an empty no-op Proxy on V2 deployments

The Salesforce Embedded Messaging V2 SDK (`bootstrap.min.js` served
from the deployment's Experience site) ships
`window.embeddedservice_bootstrap.prechatAPI` as a JavaScript Proxy
whose target is `{}`. The Proxy's `get` trap returns a function that
returns `true` for every method lookup, regardless of arguments.

Reproduced live on `pause-health.ai/demo/intake` on 2026-06-04
21:14 PT (Chrome incognito, V2 deployment, post-Publish):

```
> window.embeddedservice_bootstrap.prechatAPI
< Proxy(Object) {} 
  [[Handler]]: Object — get: f (s,o), set: f (n,s,o)
  [[Target]]: Object — [[Prototype]]: Object — [[IsRevoked]]: false

> window.embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields({Patient_Id: "test123"})
< true
```

`bootstrap.min.js` for this deployment contains 25 mentions of
"prechat" and 5 mentions of "setHiddenPrechatFields" — i.e. it's the
real SDK, not a stub — but it contains **zero references to any of
our 19 custom field names** (`Patient_Id`, `Age_Band`,
`Primary_Symptom`, etc.). The SDK clearly fetches the allowed-field
list from somewhere at runtime; that fetch isn't returning our
fields, so the SDK falls back to the empty Proxy.

The user-visible symptom: `setHiddenPrechatFields(...)` returns
`true` without throwing, our React `setPrechatStatus("applied")`
fires, the UI prints "21 hidden prechat fields handed to Salesforce"
— and not a single byte actually goes out over the wire to SCRT2.
The routing Flow fires (we have ApexLogs proving this), but every
input variable comes in null, so its `recordUpdates` element writes
nothing to `MessagingSession.Pause_*__c`. End-to-end null pipeline.

### Everything we tried that didn't fix it (so the next person knows)

1. ✅ Verified `MessagingChannel` has 20 `<customParameters>` with
   `<actionParameterMappings>` (one per dossier field).
2. ✅ Verified channel `<sessionHandlerType>` is `Flow` pointing at
   `Pause_Intake_Prechat_Router` (not the agent directly).
3. ✅ Verified the Flow's 20 input variables exactly match the
   channel parameter names, are marked `isInput=true`, and have an
   `availableForInput` access.
4. ✅ Verified the 20 `MessagingSession.Pause_*__c` custom fields
   exist with matching API names.
5. ✅ Created `Pause_Health_Intake_Prechat_Dossier` PermissionSet
   granting FLS to those 20 fields. Assigned it to the **Automated
   Process** user (Flow's run-as user), the **EinsteinServiceAgent**
   user (bot's run-as user), and the current admin user.
6. ✅ Verified Bot has 19 `<contextVariables>` mapping
   `MessagingSession.Pause_*__c` to `$Context.Pause_*`. Bot is Active.
7. ✅ Added `<embeddedServiceForms>` block to the
   `EmbeddedServiceConfig` declaring 2 visible standard fields
   (`_FirstName`, `_LastName`) and 19 hidden custom fields. Every
   hidden field has `<isHidden>true</isHidden>`,
   `<displayOrder>-1</displayOrder>`,
   `<messagingChannelParameterType>Custom</messagingChannelParameterType>`.
   Verified via `sf project retrieve start --metadata
   EmbeddedServiceConfig:Pause_Health_Intake` that the block is in
   the live org.
8. ✅ Clicked **Publish** in Setup → Embedded Service Deployments →
   Pause Health Intake → Publish (deployment timestamp 6/4/2026
   9:53:39 PM EDT, Version 260.14.22).
9. ✅ Verified bootstrap.min.js is served fresh from
   `https://trailsignup-c2d761a3b89bf2.my.site.com/ESWPauseHealthIntake1780455502567/assets/js/bootstrap.min.js`
   (200 OK, 29.5 KB, `Cache-Control: public, max-age=60`).
10. ✅ Verified Vercel app calls
    `embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields(fields)`
    inside the `onEmbeddedMessagingReady` handler.

After all 10 boxes are ticked, the prechatAPI is still the empty
Proxy and `MessagingSession.Pause_*__c` is still null on every new
session.

### What the Flow ApexLog looks like (for sanity-check by the next person)

For a session created at `21:46:08 UTC` from the live site:

```
21:46:09.0 FLOW_CREATE_INTERVIEW_END   Pause Intake Prechat Router
21:46:09.5 FLOW_START_INTERVIEW_BEGIN  Pause Intake Prechat Router
21:46:09.5 FLOW_VALUE_ASSIGNMENT       recordId      = 0MwHp000002LZ1J
21:46:09.5 FLOW_VALUE_ASSIGNMENT       input_record  = {Id=..., Status=Waiting, ..., Pause_Patient_Id__c=null, Pause_Age_Band__c=null, ...}
21:46:09.5 FLOW_START_INTERVIEW_END    (0.5ms — no work happened)
21:46:09.5 FLOW_INTERVIEW_FINISHED     Pause Intake Prechat Router
```

The complete absence of `FLOW_VALUE_ASSIGNMENT` lines for any of the
20 dossier input variables is the smoking gun: those variables were
never set, so the `recordUpdates` element had nothing to write.

### The pivot we shipped: visible Pre-Brief Panel

Rather than ship a feature that quietly does nothing (the
"Resolved. Identity: real. 21 prechat fields handed to Salesforce…"
label was technically a lie — `setHiddenPrechatFields` returned
`true`, but nothing crossed the wire), `/demo/intake` now renders
the same `/api/intake/prechat-context` payload as a **visible
dossier card** above the Agentforce chat:

- `components/pre-brief-panel.tsx` (new): renders the full dossier
  with sections for Intake Scores, Care State, Cohort Context, and
  Identity Resolution. Two badges at the top declare
  `Identity: real|mock` and `Grounding: real|mock`.
- `components/intake-patient-stage.tsx` (updated): wires
  `<PreBriefPanel/>` between the persona picker and
  `<AgentforceEmbed/>`. Passes `prechatFields={null}` to the
  embed so the empty-Proxy code path is dormant.
- `components/agentforce-embed.tsx` (updated): doc comment now
  documents the empty-Proxy behavior; the
  `setHiddenPrechatFields` call path is still present so the
  feature lights up automatically if Salesforce ever fixes the V2
  prechatAPI binding.

The agent itself is unchanged: it still walks a generic menopause
intake. The personalization lives in the surrounding UI, where it
is honest, inspectable, and not gated on undocumented Salesforce
SDK internals.

### What was left in place in the Salesforce org (intentionally)

| Artifact | Why kept |
|---|---|
| 20 `Pause_*__c` custom fields on `MessagingSession` | Harmless when empty; ready for the day prechatAPI binding works |
| `Pause_Health_Intake_Prechat_Dossier` PermissionSet | Same |
| `Pause_Intake_Prechat_Router` Flow (Active) | Same; runs in <30ms with empty inputs |
| Channel `Messaging_for_In_App_Web` with 20 `<customParameters>` + Flow handler | Same |
| Bot 19 `<contextVariables>` mapping `Pause_*__c` → `$Context.Pause_*` | Same |
| `embeddedServiceForms` block in EmbeddedServiceConfig | Same |

If/when Salesforce fixes the V2 SDK's prechatAPI:

1. Flip `prechatFields={null}` back to
   `prechatFields={fetchState.fields}` in
   `intake-patient-stage.tsx`.
2. Browser sends prechat fields → SCRT2 dispatches them to the
   Flow → Flow writes them to `MessagingSession.Pause_*__c` → agent
   sees `$Context.Pause_*` and personalizes in-band.
3. Update the `PreBriefPanel` copy to read "What the agent also
   sees as Conversation Variables" instead of being the *only*
   place the dossier surfaces.

The dormant infrastructure stays earning its keep as a regression
test: if a future SDK upgrade fixes the binding, the next live
session will populate `MessagingSession.Pause_Patient_Id__c` and
we'll know within one chat.

### Confirming the empty-Proxy state on any live deployment

Quick sanity check in DevTools Console on the live page:

```javascript
allow pasting
window.embeddedservice_bootstrap.prechatAPI
// If this prints `Proxy(Object) {}` with no methods on the target,
// the V2 SDK has degraded to the empty-Proxy fallback and any
// setHiddenPrechatFields(...) call will silently do nothing.
```

If that ever prints a real object with explicit `setHiddenPrechatFields`
and `removeHiddenPrechatFields` methods (not Proxy-stubs), the binding
is working and Phase 18b can be re-enabled.

## Original 2026-06-02 deferral notes (preserved for context)

**Original Status at 2026-06-02 end of first session:** integration is fully
wired and the SDO sample deployment in the org was successfully published
as V2 with public bootstrap. However, the SDO sample deployment cannot be
embedded on an external origin because of two Salesforce-side restrictions
documented below. This runbook captures what needs to happen in a
dedicated 2-4 hour session to lift those restrictions by authoring a
Pause-Health-owned deployment. *(That second session happened the same day
and shipped the live deployment.)*

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

## Phase 18d: auto-pass the intake ZIP to the provider lookup (2026-06-14)

Goal: stop the "Find a Provider" subagent from asking the patient for
their ZIP. The intake page already knows the selected persona's ZIP, so
hand it to the agent in-band and have the action read it from context.

### The unblock: the V2 `prechatAPI` no-op is fixed

The Phase 18c dead end (the `prechatAPI` Proxy was an empty no-op that
silently swallowed `setHiddenPrechatFields`) no longer reproduces. On the
current SDK, calling

```js
window.embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields({ Patient_Zip: "92614" })
```

now **validates** the field name and throws
`setHiddenPrechatFields called with an invalid field name Patient_Zip`
when the field isn't registered — i.e. it's a real implementation again,
not a Proxy. That error is the signal that the binding works; the fix is
to register `Patient_Zip` on the Salesforce side so the call is accepted.

So Phase 18c's "leave `prechatFields={null}`" pivot is reverted for this
one field: the embed now passes `{ Patient_Zip: selectedPersona.patientZip }`
(see `frontend/components/agentforce-embed.tsx` and
`frontend/app/api/intake/prechat-context/route.ts`, which adds
`Patient_Zip: persona.patientZip` to the fields payload).

### CLI-scriptable half — DEPLOYED to `trailsignup` (5/5, Deploy ID `0AfHp00003ocxqYKAQ`)

Originally deployed from a throwaway `.sf-deploy/` scaffold; that scaffold is now
retired and the metadata is version-controlled under `salesforce/` (Phase 18b).
Redeploy with:

```bash
cd ~/Projects/pause-health.ai/salesforce
./deploy.sh trailsignup
```

| Component | Type | Change |
| --- | --- | --- |
| `MessagingSession.Pause_Patient_Zip__c` | CustomField | **Created** — Text(16) field that holds the inbound ZIP on the session |
| `Pause_Intake_Prechat_Router` | Flow | **Changed** — new `Patient_Zip` input variable, assigned onto `MessagingSession.Pause_Patient_Zip__c` |
| `Messaging_for_In_App_Web` | MessagingChannel | **Changed** — added the `Patient_Zip` customParameter (maxLength 16, mapped to action param `Patient_Zip`) |
| `Pause_Health_Intake_Prechat_Dossier` | PermissionSet | **Changed** — FLS (read/edit) on `Pause_Patient_Zip__c` |
| `Pause_Provider_API` | NamedCredential | **Changed** — re-confirmed (provider-lookup callout) |

**Gotcha — MessagingChannel attachment validation.** The first deploy
failed 4/5 on the channel with `The field value for Allowed file types
can't be null or empty if Allow Inbound Files is enabled. (225:21)`. The
`MessagingChannel` metadata type has **no element** for "allowed file
types" (see the `EmbeddedConfig` spec — only `authMode`,
`isAttachmentUploadEnabled`, `isSaveTranscriptEnabled`, the two JWT
expiries, and `messagingAuthorizations`). The allowed-file-types list
lives in org-side Messaging Settings and can't ride along in the channel
metadata, so any deploy with `isAttachmentUploadEnabled>true` fails this
validation. Fix: set `isAttachmentUploadEnabled>false` in the deploy copy
(the intake/provider flow never uses attachments). To restore inbound
uploads, re-enable via **Setup → Messaging Settings → Messaging for In
App & Web → Allow file attachments** and pick the file types there.

### Org-side UI half — three remaining steps (NOT scriptable)

1. **Register the hidden prechat field.**
   Setup → **Embedded Service Deployments** → `Pause_Health_Intake` →
   edit the prechat config → add a **hidden** field named exactly
   `Patient_Zip`. This is what makes the SDK accept the value the embed
   sends instead of throwing "invalid field name".

2. **Add the bot context variable.**
   Agent Builder → the agent → **Variables / Connections** → add context
   variable `Pause_Patient_Zip`, source `MessagingSession.Pause_Patient_Zip__c`.

3. **Map the action input.**
   Agent Builder → **Find a Provider** subagent → the `findMenopauseProviders`
   action → set the `zip` input to `{!$Context.Pause_Patient_Zip}` instead
   of asking the patient, and update the instruction to "use the patient's
   ZIP from context; only ask if it's blank." Re-activate the agent
   afterward.

   **Design decision (2026-06-14): hard-bind the `zip` input, never ask.**
   We briefly tried setting `zip` to *Agent Populated* with a "use the
   variable, else ask" instruction so a blank-context session could fall back
   to a typed ZIP. It backfired: the LLM doesn't reliably *see* a context
   variable's value unless it's injected, so it asked for the ZIP **even when
   `Pause_Patient_Zip` was populated** (verified: session had `92614` but the
   agent still asked) — defeating the whole "no ZIP question" goal. Reverted
   to binding `zip` directly to the `Pause Patient Zip` variable, which feeds
   the value to the action deterministically without the LLM needing to see
   it. Trade-off: a typed ZIP can't override a blank context (acceptable — the
   demo personas always carry a ZIP and prechat usually delivers). To avoid
   mislabeling national fallback results as local, the instructions present
   providers neutrally rather than claiming "near you."

   Reasoning-instructions copy that ships:

   > You help the patient find menopause-focused providers.
   >
   > - Immediately call the PauseProviderDirectory action with menopause=true
   >   and limit=3. The zip is supplied automatically from the patient's intake
   >   context — never ask the patient for a ZIP code.
   > - Present up to three providers returned by the action only. For each,
   >   state the name, specialty, and city/state, then note whether they offer
   >   telehealth and whether they're accepting new patients — for example:
   >   "Dr. Priya Nair, MD, MSCP — Obstetrics & Gynecology in Irvine, CA.
   >   Offers telehealth and is accepting new patients."
   > - Introduce them simply as menopause specialists that match the patient's
   >   profile. Do not say they are "near you" or describe distance. Offer to
   >   share more detail about any of them.
   > - Never invent or guess a provider, NPI, or contact detail. Only return
   >   providers the action gives you.
   > - If the action returns no providers, say you couldn't find a match and
   >   point the patient to The Menopause Society directory at menopause.org.

   Builder notes (current Agent Authoring experience): the field shows up
   under **Variables → Messaging Session → Excluded Fields** at first; you
   must **Include** it (only works in a *draft* version, not the active one).
   Once included it appears in the flat Variables list as `Pause Patient Zip`
   with Source = Messaging Session. The reasoning-instructions text box can
   refuse clicks — the right-side **Agentforce assistant** can edit the
   instructions for you if the inline editor is stuck.

### ⚠️ THE STEP THAT ACTUALLY MADE IT WORK: re-Publish the deployment

Everything above can be perfectly configured and the ZIP will **still arrive
blank** until you **re-Publish the Embedded Service Deployment**. After adding
`Patient_Zip` to the hidden prechat fields, Setup → **Embedded Service
Deployments** → `Pause_Health_Intake` shows a **Publish** button and a stale
"Published on" date — the live embed keeps using the *last published* config,
which predates the new hidden field.

The trap: `setHiddenPrechatFields({ Patient_Zip })` reports **"applied"** (no
throw) even before publishing, because the SDK recognizes the channel variable
name from the deployed customParameter. But the value is only sent as a routing
attribute — and therefore only reaches the Flow input — once the deployment is
**published** and the **~5–15 min CDN propagation** completes. A test 3 minutes
after publishing still came back blank; a test ~10 minutes after came back with
`Pause_Patient_Zip__c = 92614`.

So the real closing sequence is: Save hidden field → **Publish** → confirm the
"Published on" date flips to today → wait 10–15 min → test in a brand-new
incognito session (the conversation must be *created* after propagation, since
hidden fields only attach at conversation creation, not on resume).

### Verified working (2026-06-14, live trailsignup embed)

Persona Anika Patel (`92614`) → "find a provider that specializes in menopause"
→ no ZIP question → Dr. Helen Okafor DO MSCP (Newport Beach) + Dr. Priya Anand
MD FACOG MSCP (Irvine), both `926`-prefix, no national fallback. SOQL confirmed
`MessagingSession.Pause_Patient_Zip__c = 92614` on the session.

### Verify

Open `/demo/intake` in a **fresh/incognito** session (live embeds cache
the pre-activation session), pick a persona, and ask "find a provider
that specializes in menopause." The embed sends `Patient_Zip` → the Flow
stamps it on the session → the bot reads it from context → the lookup
runs with no ZIP question. End-to-end flow:

```
selected persona.patientZip
  └─ agentforce-embed → prechatAPI.setHiddenPrechatFields({ Patient_Zip })
       └─ MessagingChannel customParameter Patient_Zip
            └─ Pause_Intake_Prechat_Router Flow → MessagingSession.Pause_Patient_Zip__c
                 └─ Bot context var $Context.Pause_Patient_Zip
                      └─ findMenopauseProviders action zip input
```
