# Agentforce provider-action runbook

How to make the live `Pause_Health_Intake_Agent` answer "find me a menopause
specialist" by calling the Pause provider directory, instead of deflecting with
generic advice.

## Why the agent deflects today

The live agent is a generic intake-only Service Agent. It has **no action**
wired to the Pause provider graph, so when a patient asks to find a provider it
has nothing to invoke and either returns the no-match fallback or answers from
general world knowledge. The capability exists and is public —
`GET https://pause-health.ai/api/mulesoft/providers` (the NPPES-derived
directory from `provider_ingest`, or the live MuleSoft Experience API when
`MULESOFT_PROVIDERS_BASE_URL` is set) — it's just not connected to Agentforce.

This runbook wires it via **External Services + a Named Credential + a new
agent topic**. No Apex required (the endpoint is a public, no-auth GET).

## What you'll build

```
Named Credential (Pause_Provider_API → https://pause-health.ai)
        │
        ▼
External Service (from pause-provider-directory.oas.yaml)
        │  generates invocable action: findMenopauseProviders
        ▼
Agent topic "Find a Provider"  →  references the action
        │
        ▼
Pause_Health_Intake_Agent  (deactivate → deploy → activate)
```

Repo artifacts (already authored):
- OpenAPI spec: `salesforce/external-services/pause-provider-directory.oas.yaml`
- Named Credential: `salesforce/named-credentials/Pause_Provider_API.namedCredential-meta.xml`

---

## Step 1 — Named Credential

Goal: a callable base URL for the provider endpoint.

**Option A — deploy the repo metadata (legacy, no-auth, simplest):**

`salesforce/` is now a real Salesforce DX project (Phase 18b), so deploy the
Named Credential (and the rest of the tracked metadata) straight from there:

```bash
cd salesforce
./deploy.sh trailsignup
```

The Named Credential lives at
`salesforce/force-app/main/default/namedCredentials/Pause_Provider_API.namedCredential-meta.xml`;
`deploy.sh` deploys the members in `salesforce/manifest/package.xml`. See
`salesforce/README.md` for the full layout, the retrieve path, and gotchas.

**Option B — create it in the UI** (Setup → Named Credentials → New):
- Label / Name: `Pause Provider API` / `Pause_Provider_API`
- URL: `https://pause-health.ai`
- Identity Type: Anonymous · Authentication Protocol: No Authentication
- Generate Authorization Header: unchecked

**Option C — new External Credential model** (if your org blocks legacy no-auth
Named Credentials): create an External Credential `Pause_Provider_API_Cred`
with Authentication Protocol = **Custom** and a Named Principal with no
parameters, then a Named Credential `Pause_Provider_API` (URL
`https://pause-health.ai`) referencing it, with "Generate Authorization Header"
off. Grant the agent's running user access to the External Credential principal
via a permission set.

Verify the host is reachable:

```bash
curl -s "https://pause-health.ai/api/mulesoft/providers?zip=92614&menopause=true&limit=3" | jq '.total, .providers[].name'
```

---

## Step 2 — Register the External Service

Setup → **External Services** → New → **From API Specification**.

- Service Name: `PauseProviderDirectory`
- Named Credential: `Pause_Provider_API` (from Step 1)
- Service Schema: **Upload from local** →
  `salesforce/external-services/pause-provider-directory.oas.yaml`
- Save. Salesforce parses the spec and generates one invocable operation:
  **`findMenopauseProviders`** with inputs `zip` / `menopause` / `limit` and a
  structured output (`total`, `returned`, `providers[]`).

If the parser complains, it's almost always an unsupported OpenAPI feature —
the spec is deliberately lean (OpenAPI 3.0, primitive types, no `$ref`,
`oneOf`, `nullable`, or auth blocks) to avoid this. Don't re-add those.

---

## Step 3 — Add a "Find a Provider" topic + action to the agent

Setup → **Agentforce Agents** → `Pause_Health_Intake_Agent` → open in the
builder. (Deactivate first if the builder requires it — see Step 5.)

1. **New Topic**
   - Label: `Find a Provider`
   - Classification description: *"The patient wants to find, locate, or be
     referred to a menopause specialist, MSCP-credentialed clinician, OB/GYN,
     or endocrinologist — including questions like 'which healthcare
     professional', 'find a provider near me', or 'who should I see'."*
   - Scope: *"Help the patient find a menopause-credentialed provider using the
     Pause provider directory. Do not give generic 'see your PCP' advice when
     this topic applies."*

2. **Add Action → API (External Service)** → select
   `PauseProviderDirectory.findMenopauseProviders`.
   - Input `menopause`: set a **fixed value `true`** (always prefer
     MSCP-credentialed clinicians).
   - Input `limit`: fixed value `3`.
   - Input `zip`: map from a conversation variable the agent collects (see
     Step 4). Mark optional — the action works without it (returns top
     national matches).

3. **Topic instructions** (paste):

   > When the patient asks to find or be referred to a provider, first ask for
   > their 5-digit ZIP code if you don't already have it, then call
   > findMenopauseProviders with that zip and menopause=true. Present up to
   > three providers by name, specialty, city/state, and whether they offer
   > telehealth or are accepting new patients. If no ZIP is given, call the
   > action without it and say these are top menopause specialists nationally.
   > Never invent providers — only return what the action gives you. If the
   > action returns none, point the patient to The Menopause Society directory.

4. **Example utterances** for the topic classifier: "which healthcare
   professional?", "find a provider that specializes in menopause", "who should
   I see for menopause?", "is there a menopause specialist near 92614?", "find
   me an OB/GYN".

---

## Step 4 — Getting the patient's ZIP to the action

The embedded V2 SDK's `prechatAPI` is a no-op in this org (see
`docs/PHASE_3_RUNBOOK.md`), so the per-patient dossier — including the ZIP we
now capture at intake — is **not** handed to the agent in-band. Until that's
resolved, the agent should **ask the patient for their ZIP** in the topic
instructions (Step 3 already does this). The geo-narrowing then works from the
patient's typed answer. The action is fully functional without a ZIP too; it
just returns top national matches.

(If/when the Flow path populates a `MessagingSession` field with the ZIP, map
that to the `zip` input instead of asking.)

---

## Step 5 — Test, then activate

1. **Builder preview / "Conversation Preview":** type "find a provider near
   92614". Confirm the agent calls `findMenopauseProviders` (you'll see the
   action invocation) and names real providers (e.g. the 926-prefix MSCP
   clinicians).
2. **Activate:** Agentforce requires deactivate → save → **activate** to push
   topic/action changes live (same cycle as `docs/PHASE_3_RUNBOOK.md`).
3. **Live embed:** reload `/demo/intake`, open the chat, ask the same question.
   It should now return local specialists instead of "reach out to your PCP."

> **Gotcha — test in a *fresh* session after activating.** The embedded chat
> persists its conversation in browser storage and pins it to the agent version
> that was active when the session *started*. A session opened before (or during)
> activation will keep deflecting even though V<n> is live, and a plain page
> reload often resumes it. To confirm the live behavior, open an **incognito
> window** (or use the chat's **⋮ → End Chat**, then hard-reload) so a brand-new
> MIAW session binds to the newly activated version. Builder Preview always runs
> the draft/active version directly, so "works in Preview, deflects live" is
> almost always this stale session — not a permissions problem.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| External Service won't parse the spec | An unsupported OpenAPI feature was added | Keep the spec lean (no `$ref`/`oneOf`/`nullable`/auth); re-upload the repo copy |
| Action returns 401/403 | Named Credential has auth turned on, or pointed at the gated MuleSoft URL | For the public endpoint use No Authentication; for MuleSoft add the JWT there |
| Agent still deflects | Topic not activated, or classifier didn't match | Re-activate; add more example utterances; tighten the classification description |
| Works in Builder Preview but live embed deflects | Cached pre-activation MIAW session pinned to the old version | Start a fresh session — incognito window, or chat ⋮ → End Chat then hard-reload. Not a permissions issue. |
| Action runs but agent invents providers | Instructions not enforced | Re-paste the "Never invent providers — only return what the action gives you" instruction |
| No local results for a ZIP | That ZIP prefix has no provider in the directory | Expected with the demo fixture; run `provider_ingest` against the national NPPES file for full coverage |
| Agent never has the ZIP | prechat is a no-op (known) | Agent asks the patient for it (Step 4) |

---

## Appendix — paste-ready agent copy

Drop these verbatim into Agent Builder when creating the topic in Step 3.

**Topic label**

```
Find a Provider
```

**Classification description** (when the topic should fire)

```
The patient wants to find, locate, or be referred to a menopause specialist,
MSCP-credentialed clinician, OB/GYN, or endocrinologist — including questions
like "which healthcare professional", "find a provider near me", "who should I
see for menopause", or "is there a specialist near <ZIP>".
```

**Scope**

```
Help the patient find a menopause-credentialed provider using the Pause
provider directory via the findMenopauseProviders action. Do not give generic
"see your primary care physician" advice when this topic applies.
```

**Instructions**

```
1. If you do not already have the patient's 5-digit ZIP code, ask for it once.
2. Call findMenopauseProviders with that zip, menopause=true, and limit=3. If
   the patient declines or has no ZIP, call it without zip and tell them these
   are top menopause specialists nationally.
3. Present up to three results. For each provider, state the name, specialty,
   and city/state, then note whether they offer telehealth and whether they are
   accepting new patients — for example: "Dr. Priya Nair, MD, MSCP —
   Obstetrics & Gynecology in Irvine, CA. Offers telehealth and is accepting
   new patients."
4. Only return providers the action gives you. Never invent or guess a provider,
   NPI, or contact detail.
5. If the action returns no providers, say you couldn't find a local match and
   point the patient to The Menopause Society provider directory at
   menopause.org.
```

**Example utterances** (for the topic classifier)

```
which healthcare professional?
find a provider that specializes in menopause
who should I see for menopause?
is there a menopause specialist near 92614?
find me an OB/GYN who handles menopause
can you refer me to someone?
```

**Action input mapping**

| Input | Value |
| --- | --- |
| `menopause` | fixed `true` |
| `limit` | fixed `3` |
| `zip` | conversation variable (patient-provided), optional |

---

## Auto-passing the ZIP (skip the agent's ZIP question)

By default the agent asks the patient for their ZIP (Step 4) because the
embed's prechat couldn't transmit it. **As of 2026-06-14 the V2 SDK prechat
bug is fixed** — `embeddedservice_bootstrap.prechatAPI` now validates field
names against the deployment's registered list and transmits valid ones
(probe: `setHiddenPrechatFields({ Patient_Id: "x" })` is accepted;
`{ Patient_Zip: "x" }` errors only because it isn't registered yet). So we can
hand the ZIP in-band and the agent skips the question.

The app side is already wired: `/api/intake/prechat-context` emits a
`Patient_Zip` field, and `intake-patient-stage.tsx` passes
`{ Patient_Zip: <persona ZIP> }` as a hidden prechat field. Until `Patient_Zip`
is registered + mapped on the org, the SDK drops it and the agent falls back to
asking (graceful). Register it the same way the dormant dossier fields were
(see `docs/PHASE_3_RUNBOOK.md` Phase 18a/b for the exact metadata shapes):

1. **Prechat field** — add `Patient_Zip` as a *hidden* prechat field on the
   `Pause_Health_Intake` Embedded Service deployment's prechat form. This is the
   registration that makes `validatePrechatField` accept it (without it you get
   the "invalid field name Patient_Zip" console error).
2. **Channel customParameter** — add `<customParameters>` `Patient_Zip` (with its
   `<actionParameterMappings>`) to the `Messaging_for_In_App_Web` channel,
   mirroring the existing dossier params.
3. **MessagingSession field** — create `Pause_Patient_Zip__c` (Text, 5–10) on
   MessagingSession; grant FLS via the `Pause_Health_Intake_Prechat_Dossier`
   permission set (the same PS the EinsteinServiceAgent + Automated Process users
   already hold).
4. **Routing Flow** — in `Pause_Intake_Prechat_Router`, add input variable
   `Patient_Zip` and a record-update that writes it to
   `MessagingSession.Pause_Patient_Zip__c`.
5. **Agent context variable** — add a bot context variable `Pause_Patient_Zip`
   mapped to `MessagingSession.Pause_Patient_Zip__c`, so the agent can read
   `$Context.Pause_Patient_Zip`.
6. **Map it to the action** — in the **Find a Provider** subagent, set the
   `findMenopauseProviders` action's **`zip` input** to **`$Context.Pause_Patient_Zip`**
   (instead of agent-populated). Update the reasoning instructions so it only
   asks for ZIP when that context variable is empty:

   > If `$Context.Pause_Patient_Zip` has a value, use it as the zip and do NOT
   > ask the patient for their ZIP. Only ask for a ZIP if it is empty.

   Then **Commit Version → Activate**.

**Verify:**
- Re-run the console probe — `setHiddenPrechatFields({ Patient_Zip: "92614" })`
  should no longer log "invalid field name."
- Fresh incognito session on `/demo/intake` (any persona has a ZIP): ask
  "find a provider that specializes in menopause" *without* giving a ZIP — the
  agent should return local providers straight away instead of asking for the
  ZIP first.

### Metadata snippets (copy-paste)

**1. MessagingSession field** — version-controlled at
`salesforce/force-app/main/default/objects/MessagingSession/fields/Pause_Patient_Zip__c.field-meta.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Pause_Patient_Zip__c</fullName>
    <label>Pause Patient Zip</label>
    <type>Text</type>
    <length>10</length>
    <required>false</required>
</CustomField>
```

```bash
cd salesforce && ./deploy.sh trailsignup
```

**2. Permission set FLS** — add to `Pause_Health_Intake_Prechat_Dossier.permissionset-meta.xml`
(mirrors the existing `Pause_*__c` field permissions):

```xml
<fieldPermissions>
    <field>MessagingSession.Pause_Patient_Zip__c</field>
    <editable>true</editable>
    <readable>true</readable>
</fieldPermissions>
```

**3. Routing Flow** — in `Pause_Intake_Prechat_Router.flow-meta.xml`, add the
input variable and an assignment onto the existing MessagingSession update
(mirror an existing `Pause_*` field on that `recordUpdate`):

```xml
<variables>
    <name>Patient_Zip</name>
    <dataType>String</dataType>
    <isCollection>false</isCollection>
    <isInput>true</isInput>
    <isOutput>false</isOutput>
</variables>
```

```xml
<!-- inside the existing <recordUpdates> that writes MessagingSession.Pause_*__c -->
<inputAssignments>
    <field>Pause_Patient_Zip__c</field>
    <value>
        <elementReference>Patient_Zip</elementReference>
    </value>
</inputAssignments>
```

**4. Channel customParameter** — in the `Messaging_for_In_App_Web` channel
metadata, add a `Patient_Zip` parameter by copying an existing dossier param
block and renaming (exact element shape varies by API version — mirror a
known-good `Patient_Id` block rather than hand-writing):

```xml
<customParameters>
    <name>Patient_Zip</name>
    <!-- copy the <actionParameterMappings>/value shape from the existing
         Patient_Id customParameter on this channel -->
</customParameters>
```

**5. Bot context variable** — in the agent's `*.bot-meta.xml` (or
`GenAiPlannerBundle`), add a context variable mapped to the field (again,
clone an existing `Pause_*` context variable to match your API version):

```xml
<contextVariables>
    <developerName>Pause_Patient_Zip</developerName>
    <label>Pause Patient Zip</label>
    <dataType>Text</dataType>
    <contextVariableMappings>
        <SObjectType>MessagingSession</SObjectType>
        <fieldName>MessagingSession.Pause_Patient_Zip__c</fieldName>
    </contextVariableMappings>
</contextVariables>
```

**6. Prechat field registration** — the Embedded Service deployment's prechat
form (UI: Setup → Embedded Service Deployments → `Pause_Health_Intake` → Chat
Settings → Prechat) — add `Patient_Zip` as a **hidden** field. This is the
registration that makes `validatePrechatField` accept it; without it the SDK
logs "invalid field name Patient_Zip" and drops the value.

> Snippets 3–5 edit existing multi-element metadata whose exact schema tracks
> your org's API version — the safest path is to clone the corresponding
> `Patient_Id` element (you already wired 20 of these in Phase 18a/b) and rename
> to `Patient_Zip`. Snippets 1–2 are self-contained and deploy cleanly.

## When the live MuleSoft API replaces the public endpoint

Repoint the Named Credential `endpoint` at the gateway/CloudHub base and add the
bearer/JWT auth there (the gateway already enforces Auth0 JWT + rate limiting).
The External Service, action, topic, and agent need no change — same contract,
same operation. Set `MULESOFT_PROVIDERS_BASE_URL` on the Next app so the public
`/api/mulesoft/providers` also proxies live, keeping both paths shape-identical.
